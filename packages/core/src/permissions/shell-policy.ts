/**
 * Shell 命令策略
 *
 * 不使用“首个 token 白名单”，而是：
 * - 高危模式直接 deny
 * - 其余命令默认需要用户确认（由工具 permission 决定）
 */

import type { PermissionDecision } from "../tools/base.js";

export const DENY_SHELL_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)?\//, reason: "拒绝删除根路径/绝对路径" },
  { pattern: /\bsudo\b/i, reason: "拒绝提权命令" },
  { pattern: /\bchmod\s+777\b/i, reason: "拒绝 777 权限" },
  { pattern: /\bchown\b/i, reason: "拒绝变更文件所有者" },
  { pattern: /\bdd\s+if=/i, reason: "拒绝磁盘直接读写" },
  { pattern: /\bmkfs\./i, reason: "拒绝格式化文件系统" },
  { pattern: />\s*\/dev\//i, reason: "拒绝写入设备文件" },
  { pattern: /\bcurl\b[^\n]*\|\s*(?:sh|bash)\b/i, reason: "拒绝远程脚本直接执行" },
  { pattern: /\bwget\b[^\n]*\|\s*(?:sh|bash)\b/i, reason: "拒绝远程脚本直接执行" },
  { pattern: /\bgit\s+push\b/i, reason: "拒绝自动 push（本期不提供网络写操作）" },
];

/** 评估 shell 命令；返回 deny 或 allow（是否 confirm 由工具声明决定） */
export function evaluateShellCommand(command: string): PermissionDecision {
  const trimmed = command.trim();
  if (!trimmed) {
    return { level: "allow" };
  }

  for (const { pattern, reason } of DENY_SHELL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { level: "deny", reason };
    }
  }

  return { level: "allow" };
}

export function isDangerousShellCommand(command: string): boolean {
  return evaluateShellCommand(command).level === "deny";
}
