/**
 * tracing 辅助测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext, ToolDefinition } from "../../tools/base.js";
import { ToolExecutor } from "../tool-executor.js";
import {
  executeToolWithTrace,
  runWithTrace,
  summarizeArgsForTrace,
} from "../tracing.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("summarizeArgsForTrace", () => {
  it("保留路径和短命令，截断长字符串", () => {
    const summary = summarizeArgsForTrace({
      path: "src/api.ts",
      command: "pnpm test",
      options: { recursive: true },
    });
    expect(summary).toEqual({
      path: "src/api.ts",
      command: "pnpm test",
      options: "[object]",
    });
  });

  it("文件内容类参数只记录长度", () => {
    const summary = summarizeArgsForTrace({
      path: "src/a.ts",
      content: "x".repeat(5_000),
      old_string: "old",
      new_string: "new",
    });
    expect(summary.path).toBe("src/a.ts");
    expect(summary.content).toBe("[5000 chars]");
    expect(summary.old_string).toBe("[3 chars]");
    expect(summary.new_string).toBe("[3 chars]");
  });

  it("超长字符串截断，数组只记录数量", () => {
    const summary = summarizeArgsForTrace({
      query: "q".repeat(400),
      files: ["a.ts", "b.ts", "c.ts"],
    });
    expect(String(summary.query)).toHaveLength(303);
    expect(String(summary.query).endsWith("...")).toBe(true);
    expect(summary.files).toBe("[3 items]");
  });
});

describe("runWithTrace", () => {
  it("返回真实结果并支持摘要", async () => {
    const result = await runWithTrace(
      { name: "test-run", tags: ["test"], metadata: { a: 1 } },
      async () => ({ value: 42 }),
      (value) => ({ doubled: value.value * 2 }),
    );
    expect(result).toEqual({ value: 42 });
  });

  it("执行失败时向上抛出", async () => {
    await expect(
      runWithTrace(
        { name: "test-fail", tags: [], metadata: {} },
        async () => {
          throw new Error("boom");
        },
        () => ({}),
      ),
    ).rejects.toThrow("boom");
  });
});

describe("executeToolWithTrace", () => {
  it("执行工具并返回原始 ToolResult", async () => {
    const tool: ToolDefinition = {
      name: "file_read",
      description: "read",
      schema: z.object({ path: z.string() }),
      permission: "allow",
      sideEffect: "none",
      execute: async (args) => `content:${args.path}`,
    };
    const workspace = mkdtempSync(join(tmpdir(), "code-agent-trace-"));
    tempDirs.push(workspace);
    const executor = new ToolExecutor([tool]);
    const ctx: ToolContext = {
      workspacePath: workspace,
      sessionId: "s1",
      runId: "r1",
      taskId: "t1",
      roleId: "code",
    };

    const result = await executeToolWithTrace(
      executor,
      { id: "c1", name: "file_read", args: { path: "a.ts" } },
      ctx,
    );

    expect(result).toMatchObject({
      ok: true,
      content: "content:a.ts",
    });
  });
});
