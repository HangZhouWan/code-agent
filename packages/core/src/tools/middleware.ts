/**
 * 工具执行中间件
 *
 * 统一处理：
 * - 权限评估（allow / confirm / deny）
 * - 审批回调
 * - 写操作互斥
 * - before/after hooks
 * - 大输出 artifact 外置
 * - 错误归一化为 ToolResult
 */

import type {
  ToolContext,
  ToolDefinition,
  ToolResult,
  ToolSideEffect,
} from "./base.js";
import { normalizeToolResult } from "./base.js";
import {
  createDefaultPermissionPolicy,
  type PermissionPolicy,
} from "../permissions/policy.js";

export interface ArtifactSink {
  put(content: string, meta: { toolName: string }): Promise<string>;
}

export interface ToolHooks {
  beforeTool?(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<
    | { args?: Record<string, unknown>; skip?: boolean; result?: ToolResult }
    | void
  >;
  afterTool?(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    result: ToolResult,
    ctx: ToolContext,
  ): Promise<ToolResult | void>;
}

export interface ToolExecutionDependencies {
  policy?: PermissionPolicy;
  hooks?: ToolHooks;
  artifactSink?: ArtifactSink;
  inlineLimit?: number;
}

export const DEFAULT_INLINE_LIMIT = 8_000;

export function toolOk(
  content: string,
  metadata?: Record<string, unknown>,
): ToolResult {
  return { ok: true, content, ...(metadata ? { metadata } : {}) };
}

export function toolError(message: string, errorCode: string): ToolResult {
  return { ok: false, content: message, errorCode };
}

function sideEffectOf(tool: ToolDefinition): ToolSideEffect {
  if (tool.sideEffect) return tool.sideEffect;
  return tool.permission === "confirm" ? "mutating" : "none";
}

async function requestApproval(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolContext,
  reason?: string,
): Promise<{ approved: boolean; channel: boolean }> {
  if (ctx.requestApproval) {
    return {
      approved: await ctx.requestApproval({
        toolName: tool.name,
        args,
        ...(ctx.taskId ? { taskId: ctx.taskId } : {}),
        ...(reason ? { reason } : {}),
      }),
      channel: true,
    };
  }
  if (ctx.onConfirmRequired) {
    return {
      approved: await ctx.onConfirmRequired(tool.name, args),
      channel: true,
    };
  }
  return { approved: false, channel: false };
}

async function externalize(
  result: ToolResult,
  tool: ToolDefinition,
  deps: ToolExecutionDependencies,
): Promise<ToolResult> {
  const limit = deps.inlineLimit ?? DEFAULT_INLINE_LIMIT;
  if (
    !result.ok ||
    !deps.artifactSink ||
    result.content.length <= limit
  ) {
    return result;
  }

  const artifactId = await deps.artifactSink.put(result.content, {
    toolName: tool.name,
  });
  const headLength = Math.floor(limit * 0.6);
  const tailLength = Math.floor(limit * 0.3);
  const head = result.content.slice(0, headLength);
  const tail = result.content.slice(-tailLength);
  const omitted = result.content.length - head.length - tail.length;

  return {
    ...result,
    content:
      `${head}\n\n...[truncated ${omitted} chars; total ${result.content.length}; ` +
      `artifact ${artifactId}]...\n\n${tail}`,
    truncated: true,
    artifactId,
    metadata: {
      ...(result.metadata ?? {}),
      artifactId,
      originalLength: result.content.length,
    },
  };
}

/**
 * 执行一个工具；所有异常都转换为 ToolResult，便于模型自我修正。
 */
export async function executeTool(
  tool: ToolDefinition,
  rawArgs: Record<string, unknown>,
  ctx: ToolContext,
  deps: ToolExecutionDependencies = {},
): Promise<ToolResult> {
  if (ctx.signal?.aborted) {
    return toolError("Operation aborted", "ABORTED");
  }

  const policy = deps.policy ?? createDefaultPermissionPolicy();
  const decision = await policy.evaluate(tool, rawArgs, ctx);

  if (decision.level === "deny") {
    return toolError(
      `Tool "${tool.name}" denied: ${decision.reason ?? "permission denied"}`,
      "PERMISSION_DENIED",
    );
  }

  if (decision.level === "confirm") {
    const { approved, channel } = await requestApproval(
      tool,
      rawArgs,
      ctx,
      decision.reason,
    );
    if (!channel) {
      return toolError(
        `Tool "${tool.name}" requires approval, but no approval channel is available`,
        "APPROVAL_REQUIRED",
      );
    }
    if (!approved) {
      return toolError(
        `Tool "${tool.name}" was denied by the user`,
        "APPROVAL_DENIED",
      );
    }
  }

  let args = rawArgs;
  const before = await deps.hooks?.beforeTool?.(tool, args, ctx);
  if (before?.skip) {
    return before.result ?? toolOk("Tool execution skipped by hook");
  }
  if (before?.args) {
    args = before.args;
  }

  let parsed: unknown;
  try {
    parsed = tool.schema.parse(args);
  } catch (error) {
    return toolError(
      `Invalid arguments for "${tool.name}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      "VALIDATION",
    );
  }

  const run = async (): Promise<ToolResult> =>
    normalizeToolResult(
      await tool.execute(parsed as never, ctx),
    );

  let result: ToolResult;
  try {
    const sideEffect = sideEffectOf(tool);
    result =
      sideEffect === "mutating" && ctx.withWriteLock
        ? await ctx.withWriteLock(run)
        : await run();
  } catch (error) {
    if (ctx.signal?.aborted) {
      return toolError("Operation aborted", "ABORTED");
    }
    return toolError(
      error instanceof Error ? error.message : String(error),
      "TOOL_FAILED",
    );
  }

  const after = await deps.hooks?.afterTool?.(
    tool,
    parsed as Record<string, unknown>,
    result,
    ctx,
  );
  if (after) result = after;

  return externalize(result, tool, deps);
}
