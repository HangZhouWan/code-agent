/**
 * Shell / 测试工具（新契约）
 */

import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition, ToolResult } from "../base.js";
import { toolError, toolOk } from "../middleware.js";
import { resolveWorkspacePath } from "../../permissions/paths.js";
import { ToolNames } from "../tool-names.js";

const execAsync = promisify(exec);

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      signal,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const err = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? String(error),
      exitCode: typeof err.code === "number" ? err.code : 1,
    };
  }
}

function formatOutput(result: CommandResult): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout.trimEnd());
  if (result.stderr) parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
  if (parts.length === 0) parts.push("(无输出)");
  return parts.join("\n");
}

export const shellExecTool: ToolDefinition<z.ZodObject<{
  command: z.ZodString;
  cwd: z.ZodOptional<z.ZodString>;
  timeoutMs: z.ZodOptional<z.ZodNumber>;
}>> = {
  name: ToolNames.SHELL_EXEC,
  description:
    "在工作区内执行 shell 命令。危险命令会被拒绝；其余命令需要用户确认。",
  schema: z.object({
    command: z.string().min(1).describe("要执行的命令"),
    cwd: z.string().optional().describe("相对工作区的执行目录"),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .optional()
      .describe("超时时间（毫秒），默认 30000"),
  }),
  permission: "confirm",
  sideEffect: "mutating",
  async execute(args, ctx): Promise<ToolResult> {
    const cwd = args.cwd
      ? resolveWorkspacePath(ctx.workspacePath, args.cwd)
      : ctx.workspacePath;
    const result = await runCommand(
      args.command,
      cwd,
      args.timeoutMs ?? 30_000,
      ctx.signal,
    );

    if (ctx.signal?.aborted) {
      return toolError("命令执行已取消", "ABORTED");
    }

    const content = `$ ${args.command}\n${formatOutput(result)}`;
    if (result.exitCode !== 0) {
      return {
        ok: false,
        content: `${content}\n[exit code ${result.exitCode}]`,
        errorCode: "TOOL_FAILED",
        metadata: {
          command: args.command,
          exitCode: result.exitCode,
          cwd,
        },
      };
    }

    return toolOk(content, {
      command: args.command,
      exitCode: 0,
      cwd,
    });
  },
};

/**
 * 检测项目测试命令。
 *
 * 顺序：显式 command > package.json scripts.test > Python/Cargo/Go。
 */
export async function detectTestCommand(
  workspacePath: string,
  explicit?: string,
): Promise<string | null> {
  if (explicit?.trim()) return explicit.trim();

  const packageJsonPath = path.join(workspacePath, "package.json");
  try {
    const raw = await fs.readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    if (pkg.scripts?.test) {
      if (await exists(path.join(workspacePath, "pnpm-lock.yaml"))) {
        return "pnpm test";
      }
      if (await exists(path.join(workspacePath, "yarn.lock"))) {
        return "yarn test";
      }
      return "npm test";
    }
  } catch {
    // 没有 package.json
  }

  if (
    (await exists(path.join(workspacePath, "pyproject.toml"))) ||
    (await exists(path.join(workspacePath, "pytest.ini")))
  ) {
    return "pytest";
  }
  if (await exists(path.join(workspacePath, "Cargo.toml"))) {
    return "cargo test";
  }
  if (await exists(path.join(workspacePath, "go.mod"))) {
    return "go test ./...";
  }

  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseTestSummary(output: string): {
  passed?: number;
  failed?: number;
  skipped?: number;
} {
  const summary: { passed?: number; failed?: number; skipped?: number } = {};
  const vitest = output.match(
    /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?/i,
  );
  if (vitest) {
    summary.failed = vitest[1] ? Number(vitest[1]) : 0;
    summary.passed = Number(vitest[2]);
    summary.skipped = vitest[3] ? Number(vitest[3]) : 0;
    return summary;
  }

  const pytest = output.match(
    /(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/i,
  );
  if (pytest) {
    summary.passed = Number(pytest[1]);
    summary.failed = pytest[2] ? Number(pytest[2]) : 0;
    summary.skipped = pytest[3] ? Number(pytest[3]) : 0;
  }
  return summary;
}

export const runTestsTool: ToolDefinition<z.ZodObject<{
  command: z.ZodOptional<z.ZodString>;
  path: z.ZodOptional<z.ZodString>;
  timeoutMs: z.ZodOptional<z.ZodNumber>;
}>> = {
  name: ToolNames.RUN_TESTS,
  description:
    "自动检测并运行项目测试命令；也可显式传入 command。需要用户确认。",
  schema: z.object({
    command: z.string().optional().describe("显式测试命令"),
    path: z.string().optional().describe("相对工作区的执行目录"),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(600_000)
      .optional()
      .describe("超时时间（毫秒），默认 120000"),
  }),
  permission: "confirm",
  sideEffect: "mutating",
  async execute(args, ctx): Promise<ToolResult> {
    const cwd = args.path
      ? resolveWorkspacePath(ctx.workspacePath, args.path)
      : ctx.workspacePath;
    const command = await detectTestCommand(cwd, args.command);

    if (!command) {
      return toolError(
        "无法检测测试命令；请显式提供 command 参数",
        "VALIDATION",
      );
    }

    const result = await runCommand(
      command,
      cwd,
      args.timeoutMs ?? 120_000,
      ctx.signal,
    );
    const summary = parseTestSummary(result.stdout + "\n" + result.stderr);
    const content = `$ ${command}\n${formatOutput(result)}`;

    if (result.exitCode !== 0) {
      return {
        ok: false,
        content: `${content}\n[exit code ${result.exitCode}]`,
        errorCode: "TOOL_FAILED",
        metadata: { command, exitCode: result.exitCode, ...summary },
      };
    }

    return toolOk(content, {
      command,
      exitCode: 0,
      ...summary,
    });
  },
};
