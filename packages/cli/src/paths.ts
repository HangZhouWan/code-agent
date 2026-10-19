/**
 * CLI 路径入口
 *
 * 路径解析已收敛到 @code-agent/core；这里保留兼容函数。
 */

import {
  resolveCodeAgentHome,
  resolvePaths,
  workspaceToSlug,
} from "@code-agent/core";

export { workspaceToSlug };

export function getCodeAgentHome(): string {
  return resolveCodeAgentHome();
}

export function getProjectDir(workspacePath: string): string {
  return resolvePaths({ workspacePath }).projectDir;
}

export function getDataDir(workspacePath: string): string {
  return resolvePaths({ workspacePath }).dataDir;
}

export function getCheckpointDir(workspacePath: string): string {
  return resolvePaths({ workspacePath }).checkpointDir;
}
