/**
 * 角色提示词组合
 *
 * 共享规则来自 prompts/common.md，角色专属内容来自各自的 Markdown 文件。
 */

import { COMMON_PROMPT } from "./prompts.generated.js";

/**
 * 组合共享规则与角色专属提示词。
 *
 * @param rolePrompt - 角色专属 prompt 文本
 * @returns 完整 systemPrompt（共享规则 + 空行 + 角色提示词）
 * @throws {Error} 角色 prompt 为空时抛出
 */
export function composeRoleSystemPrompt(rolePrompt: string): string {
  const role = rolePrompt.trim();
  if (!role) {
    throw new Error("[composeRoleSystemPrompt] 角色 prompt 不能为空");
  }
  return `${COMMON_PROMPT.trim()}\n\n${role}`;
}
