/**
 * 运行时路径工具
 *
 * 对齐 Claude Code 的目录结构：
 *   ~/.code-agent/
 *   ├── config.json                       # 全局配置
 *   └── projects/
 *       └── <workspace-slug>/             # 按工作区路径隔离
 *           ├── data/                     # 长时记忆
 *           └── checkpoints/              # checkpoint 快照
 *
 * workspace-slug 规则：将绝对路径中的 / 替换为 -（与 Claude 一致）。
 * 例：/Users/qichen/projects/my-app → -Users-qichen-projects-my-app
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** code-agent 系统根目录 */
const CODE_AGENT_HOME = join(homedir(), ".code-agent");

/**
 * 将工作区绝对路径转为文件系统安全的 slug。
 *
 * 规则：将路径分隔符 / 替换为 -。
 * 保留原始路径的层级结构，确保不同路径产生不同 slug。
 */
export function workspaceToSlug(workspacePath: string): string {
  // 确保是绝对路径
  const absolute = workspacePath.startsWith("/")
    ? workspacePath
    : join(process.cwd(), workspacePath);

  // /Users/qichen/projects/my-app → -Users-qichen-projects-my-app
  return absolute.replace(/\//g, "-");
}

/**
 * 获取 code-agent 系统根目录（~/.code-agent）。
 */
export function getCodeAgentHome(): string {
  return CODE_AGENT_HOME;
}

/**
 * 获取指定工作区在 ~/.code-agent/projects/ 下的项目目录。
 */
export function getProjectDir(workspacePath: string): string {
  return join(CODE_AGENT_HOME, "projects", workspaceToSlug(workspacePath));
}

/**
 * 获取指定工作区的运行时数据目录。
 */
export function getDataDir(workspacePath: string): string {
  return join(getProjectDir(workspacePath), "data");
}

/**
 * 获取指定工作区的 checkpoint 目录。
 */
export function getCheckpointDir(workspacePath: string): string {
  return join(getProjectDir(workspacePath), "checkpoints");
}
