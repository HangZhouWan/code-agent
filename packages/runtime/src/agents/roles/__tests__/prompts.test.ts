/**
 * 角色提示词测试
 *
 * 覆盖：Markdown 源与生成物一致性、内置角色提示词结构、角色工具集。
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ToolNames } from "@code-agent/core";
import { BUILTIN_ROLES } from "../index.js";
import {
  CODE_PROMPT,
  COMMON_PROMPT,
  DOC_PROMPT,
  REVIEW_PROMPT,
  TEST_PROMPT,
} from "../prompts.generated.js";

/**
 * 归一化 Markdown 源，与生成器保持一致。
 *
 * 输入：原始文件内容
 * 输出：去 BOM、统一 LF、去掉末尾空白的结果
 */
function normalizeSource(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, "\n").trimEnd();
}

/**
 * 读取 prompts 目录下的 Markdown 源文件。
 *
 * @param name - 不含扩展名的文件名，例如 code
 * @returns 归一化后的文本
 */
function readSource(name: string): string {
  return normalizeSource(
    readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8"),
  );
}

/** 生成物导出名、源文件名与文本的映射 */
const GENERATED_PROMPTS: Array<[string, string, string]> = [
  ["COMMON_PROMPT", "common", COMMON_PROMPT],
  ["CODE_PROMPT", "code", CODE_PROMPT],
  ["TEST_PROMPT", "test", TEST_PROMPT],
  ["DOC_PROMPT", "doc", DOC_PROMPT],
  ["REVIEW_PROMPT", "review", REVIEW_PROMPT],
];

/** 四个角色共同使用的章节标题 */
const SECTION_HEADINGS = [
  "## Mission",
  "## Workflow",
  "## Rules",
  "## Tool use",
  "## Completion criteria",
  "## Output",
];

/** 各角色提示词必须提到的工具名 */
const EXPECTED_TOOL_NAMES: Record<string, string[]> = {
  code: [
    "file_read",
    "file_write",
    "file_edit",
    "code_search",
    "run_tests",
    "git_diff",
    "submit_proposals",
  ],
  test: ["file_read", "file_write", "file_edit", "run_tests"],
  doc: ["file_read", "file_edit", "file_write", "code_search"],
  review: ["file_read", "code_search", "git_diff", "git_log"],
};

describe("角色提示词 Markdown 源", () => {
  it("生成文件与 Markdown 源保持一致", () => {
    for (const [exportName, fileName, value] of GENERATED_PROMPTS) {
      expect(
        value,
        `${exportName} 与 ${fileName}.md 不一致，请运行 pnpm generate:prompts`,
      ).toBe(readSource(fileName));
    }
  });

  it("prompts 目录只包含预期的 Markdown 文件", () => {
    const dir = fileURLToPath(new URL("../prompts", import.meta.url));
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort();
    expect(files).toEqual([
      "code.md",
      "common.md",
      "doc.md",
      "review.md",
      "test.md",
    ]);
  });

  it("生成器 --check 通过", () => {
    const script = fileURLToPath(
      new URL("../../../../scripts/generate-prompts.mjs", import.meta.url),
    );
    expect(() =>
      execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });
});

describe("内置角色提示词", () => {
  for (const role of BUILTIN_ROLES) {
    it(`${role.id} 使用共享规则与统一章节`, () => {
      expect(role.systemPrompt.startsWith(COMMON_PROMPT.trim())).toBe(true);
      for (const heading of SECTION_HEADINGS) {
        expect(
          role.systemPrompt,
          `${role.id} 缺少章节 ${heading}`,
        ).toContain(heading);
      }
      expect(role.systemPrompt.length).toBeGreaterThan(800);
    });

    it(`${role.id} 提示词包含必需工具名`, () => {
      for (const toolName of EXPECTED_TOOL_NAMES[role.id] ?? []) {
        expect(role.systemPrompt).toContain(toolName);
      }
    });
  }

  it("Code Agent 保留分块写入约束", () => {
    const code = BUILTIN_ROLES.find((role) => role.id === "code");
    expect(code?.systemPrompt).toContain("6000");
    expect(code?.systemPrompt).toContain("append");
  });

  it("计划模式规则出现在所有角色提示词中", () => {
    for (const role of BUILTIN_ROLES) {
      expect(role.systemPrompt).toContain("submit_proposals");
      expect(role.systemPrompt).toContain("selected proposals");
    }
  });

  it("Review Agent 强调只读与运行时目录", () => {
    const review = BUILTIN_ROLES.find((role) => role.id === "review");
    expect(review?.systemPrompt).toContain("read-only");
    expect(review?.systemPrompt).toContain(".agent");
  });

  it("Test Agent 可以创建和修改测试文件", () => {
    const test = BUILTIN_ROLES.find((role) => role.id === "test");
    expect(test?.defaultTools).toContain(ToolNames.FILE_WRITE);
    expect(test?.defaultTools).toContain(ToolNames.FILE_EDIT);
  });
});
