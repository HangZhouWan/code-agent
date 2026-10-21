/**
 * CLI 参数解析测试
 *
 * 覆盖路径/查询判定、print 模式、模型覆盖、resume、help/version。
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { parseArgs } from "../args.js";

/** 构造与 process.argv 一致的输入 */
function argv(...args: string[]): string[] {
  return ["node", "code-agent", ...args];
}

describe("parseArgs", () => {
  it("无参数时使用 cwd 并进入 REPL 模式", () => {
    const result = parseArgs(argv());

    expect(result.workspacePath).toBe(resolve(process.cwd()));
    expect(result.query).toBeUndefined();
    expect(result.printMode).toBe(false);
  });

  it("识别绝对路径作为工作区", () => {
    const result = parseArgs(argv("/tmp/my-project"));

    expect(result.workspacePath).toBe("/tmp/my-project");
    expect(result.query).toBeUndefined();
  });

  it("识别当前目录作为工作区", () => {
    const result = parseArgs(argv("."));

    expect(result.workspacePath).toBe(resolve("."));
    expect(result.query).toBeUndefined();
  });

  it("识别查询并自动开启 print 模式", () => {
    const result = parseArgs(argv("分析这个项目"));

    expect(result.query).toBe("分析这个项目");
    expect(result.printMode).toBe(true);
  });

  it("同时解析工作区和查询", () => {
    const result = parseArgs(argv("/tmp/my-project", "分析项目"));

    expect(result.workspacePath).toBe("/tmp/my-project");
    expect(result.query).toBe("分析项目");
    expect(result.printMode).toBe(true);
  });

  it("解析 -p / --model / --resume", () => {
    const result = parseArgs(
      argv("-p", "--model", "gpt-4o", "--resume", "task-1", "查询"),
    );

    expect(result.printMode).toBe(true);
    expect(result.model).toBe("gpt-4o");
    expect(result.resumeTaskId).toBe("task-1");
    expect(result.query).toBe("查询");
  });

  it("解析 --plan / --no-plan", () => {
    expect(parseArgs(["node", "cli", "--plan", "do it"]).planMode).toBe(true);
    expect(parseArgs(["node", "cli", "--no-plan", "do it"]).planMode).toBe(
      false,
    );
    expect(parseArgs(["node", "cli", "do it"]).planMode).toBeUndefined();
  });

  it("解析 -h 和 -v", () => {
    expect(parseArgs(argv("--help")).showHelp).toBe(true);
    expect(parseArgs(argv("-h")).showHelp).toBe(true);
    expect(parseArgs(argv("--version")).showVersion).toBe(true);
    expect(parseArgs(argv("-v")).showVersion).toBe(true);
  });

  it("忽略未知 flag", () => {
    const result = parseArgs(argv("--unknown", "查询"));

    expect(result.query).toBe("查询");
  });

  it("缺少 --model 值时忽略", () => {
    const result = parseArgs(argv("--model"));

    expect(result.model).toBeUndefined();
  });
});
