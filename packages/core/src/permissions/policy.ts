/**
 * 默认权限策略
 *
 * 校验顺序：
 * 1. 工具声明的 permission（字符串或动态 evaluator）
 * 2. path/cwd/from/to/paths 的工作区包含校验
 * 3. shell_exec / run_tests 的危险命令 deny
 */

import type {
  PermissionDecision,
  ToolContext,
  ToolDefinition,
} from "../tools/base.js";
import { evaluateShellCommand } from "./shell-policy.js";
import { PathEscapeError, resolveWorkspacePath } from "./paths.js";

export interface PermissionPolicy {
  evaluate(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<PermissionDecision>;
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  async evaluate(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<PermissionDecision> {
    let decision: PermissionDecision;

    if (typeof tool.permission === "function") {
      decision = await tool.permission(args, ctx);
    } else {
      decision = {
        level: tool.permission === "safe" ? "allow" : tool.permission,
      };
    }

    if (decision.level === "deny") return decision;

    const pathKeys = ["path", "cwd", "from", "to"];
    for (const key of pathKeys) {
      const value = args[key];
      if (typeof value !== "string" || value.length === 0) continue;
      try {
        resolveWorkspacePath(ctx.workspacePath, value);
      } catch (error) {
        if (error instanceof PathEscapeError) {
          return { level: "deny", reason: error.message };
        }
        return {
          level: "deny",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }

    if (Array.isArray(args.paths)) {
      for (const value of args.paths) {
        if (typeof value !== "string" || value.length === 0) continue;
        try {
          resolveWorkspacePath(ctx.workspacePath, value);
        } catch (error) {
          return {
            level: "deny",
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }

    if (tool.name === "shell_exec" || tool.name === "run_tests") {
      const command = typeof args.command === "string" ? args.command : "";
      const shellDecision = evaluateShellCommand(command);
      if (shellDecision.level === "deny") return shellDecision;
    }

    return decision;
  }
}

export function createDefaultPermissionPolicy(): PermissionPolicy {
  return new DefaultPermissionPolicy();
}
