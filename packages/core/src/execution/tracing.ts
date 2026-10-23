/**
 * LangSmith tracing 辅助
 *
 * 用 LangChain Runnable 给 agent 任务和工具调用加 span，
 * 让 plan mode 的直接执行路径也能形成完整父子层级。
 * 工具 span 只记录参数摘要和状态，不上报完整文件内容与输出。
 */

import { RunnableLambda } from "@langchain/core/runnables";
import type { ToolContext, ToolResult } from "../tools/base.js";
import type { ToolExecutor } from "./tool-executor.js";

const MAX_ARG_CHARS = 300;

/** 这些参数可能包含大段文件内容，只记录长度 */
const OMITTED_ARG_KEYS = new Set([
  "content",
  "old_string",
  "new_string",
  "patch",
  "text",
  "body",
]);

/**
 * 生成可安全上报的工具参数摘要。
 *
 * 输入：工具原始参数
 * 输出：只保留短字符串、基础类型与数组长度，文件内容类字段替换为长度
 */
export function summarizeArgsForTrace(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (OMITTED_ARG_KEYS.has(key)) {
      summary[key] =
        typeof value === "string" ? `[${value.length} chars]` : "[omitted]";
      continue;
    }
    if (typeof value === "string") {
      summary[key] =
        value.length > MAX_ARG_CHARS
          ? `${value.slice(0, MAX_ARG_CHARS)}...`
          : value;
      continue;
    }
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      summary[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      summary[key] = `[${value.length} items]`;
      continue;
    }
    summary[key] = "[object]";
  }
  return summary;
}

export interface TraceOptions {
  /** LangSmith run 名称 */
  name: string;
  tags: string[];
  metadata: Record<string, unknown>;
  /** trace 输入；用于让会话根 span 展示用户消息起点 */
  input?: unknown;
}

/**
 * 用 RunnableLambda 包裹一次执行，生成独立 span。
 *
 * 输入：trace 配置、实际执行函数、上报用的结果摘要函数
 * 输出：实际执行结果；trace 失败不会影响业务返回
 */
export async function runWithTrace<T>(
  options: TraceOptions,
  fn: () => Promise<T>,
  summarize: (result: T) => Record<string, unknown>,
): Promise<T> {
  let actual: T | undefined;
  let completed = false;

  const runner = RunnableLambda.from(async () => {
    const result = await fn();
    actual = result;
    completed = true;
    return summarize(result);
  }).withConfig({
    runName: options.name,
    tags: options.tags,
    metadata: options.metadata,
  });

  try {
    await runner.invoke(options.input as never);
  } catch (error) {
    // fn 已完成但摘要/trace 处理失败时，仍然返回真实结果
    if (completed) return actual as T;
    throw error;
  }

  if (!completed) {
    throw new Error(`Traced execution "${options.name}" returned no result`);
  }
  return actual as T;
}

/**
 * 包裹一次工具执行，生成 tool:<name> span。
 *
 * 输入：工具执行器、工具调用、工具上下文
 * 输出：原始 ToolResult；span 中只记录状态、错误码和输出长度
 */
export async function executeToolWithTrace(
  toolExecutor: ToolExecutor,
  call: Parameters<ToolExecutor["execute"]>[0],
  ctx: ToolContext,
): Promise<ToolResult> {
  return runWithTrace(
    {
      name: `tool:${call.name}`,
      tags: ["code-agent", "tool", `tool:${call.name}`],
      metadata: {
        sessionId: String(ctx.sessionId),
        runId: ctx.runId ? String(ctx.runId) : null,
        taskId: ctx.taskId ? String(ctx.taskId) : null,
        role: ctx.roleId ?? null,
        tool: call.name,
        args: summarizeArgsForTrace(call.args),
      },
    },
    () => toolExecutor.execute(call, ctx),
    (result) => ({
      ok: result.ok,
      errorCode: result.errorCode ?? null,
      contentLength: result.content.length,
    }),
  );
}
