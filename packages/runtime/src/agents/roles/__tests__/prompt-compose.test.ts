/**
 * 角色提示词组合测试
 *
 * 覆盖：共享规则与角色提示词的拼接顺序、空白裁剪、空输入校验。
 */

import { describe, expect, it } from "vitest";
import { composeRoleSystemPrompt } from "../prompt-compose.js";
import { COMMON_PROMPT } from "../prompts.generated.js";

const COMMON = COMMON_PROMPT.trim();

describe("composeRoleSystemPrompt", () => {
  it("按共享规则 + 空行 + 角色提示词拼接", () => {
    expect(composeRoleSystemPrompt("Role text")).toBe(
      `${COMMON}\n\nRole text`,
    );
  });

  it("裁剪角色提示词首尾空白", () => {
    expect(composeRoleSystemPrompt("\n  Role text  \n")).toBe(
      `${COMMON}\n\nRole text`,
    );
  });

  it("角色提示词为空时抛错", () => {
    expect(() => composeRoleSystemPrompt("   \n")).toThrow(/不能为空/);
  });

  it("共享规则位于角色提示词之前", () => {
    const result = composeRoleSystemPrompt("# Custom Role");
    expect(result.startsWith("# Ground Rules")).toBe(true);
    expect(result.indexOf("# Custom Role")).toBeGreaterThan(0);
  });
});
