/**
 * 工作区路径解析
 *
 * 优先使用 $WORKSPACE/.agent/（与工作区同生命周期），
 * 不可写时回退到 ~/.code-agent/projects/<slug>/。
 */

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ResolvePathsOptions, WorkspacePaths } from "./types.js";

/** 将绝对路径转为文件系统安全的 slug，例如 /a/b → -a-b */
export function workspaceToSlug(
  workspacePath: string,
  cwd: string = process.cwd(),
): string {
  return resolve(cwd, workspacePath).replace(/[\\/]/g, "-");
}

/** 解析 ~/.code-agent（支持 CODE_AGENT_HOME 覆盖） */
export function resolveCodeAgentHome(options: {
  homeDir?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
} = {}): string {
  const envHome = options.env?.CODE_AGENT_HOME?.trim();
  if (envHome) {
    return resolve(options.cwd ?? process.cwd(), envHome);
  }
  return join(options.homeDir ?? homedir(), ".code-agent");
}

function tryEnsureDir(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析工作区运行时路径。
 *
 * - 默认创建 .agent/data、.agent/runtime/checkpoints、.agent/artifacts
 * - 创建失败时回退到 ~/.code-agent/projects/<slug>/
 * - DB_PATH 环境变量可覆盖数据库位置
 */
export function resolvePaths(options: ResolvePathsOptions = {}): WorkspacePaths {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const workspacePath = resolve(
    cwd,
    options.workspacePath ?? env.WORKSPACE_PATH ?? ".",
  );
  const homeDir = resolveCodeAgentHome({
    homeDir: options.homeDir,
    env,
    cwd,
  });
  const projectDir = join(homeDir, "projects", workspaceToSlug(workspacePath));

  const workspaceAgentDir = join(workspacePath, ".agent");
  const localDataDir = join(workspaceAgentDir, "data");
  const localCheckpointDir = join(workspaceAgentDir, "runtime", "checkpoints");
  const localArtifactsDir = join(workspaceAgentDir, "artifacts");

  const shouldCreate = options.createDirs !== false;
  const useLocal = shouldCreate
    ? tryEnsureDir(localDataDir) &&
      tryEnsureDir(localCheckpointDir) &&
      tryEnsureDir(localArtifactsDir)
    : true;

  const dataDir = useLocal ? localDataDir : join(projectDir, "data");
  const checkpointDir = useLocal
    ? localCheckpointDir
    : join(projectDir, "checkpoints");
  const artifactsDir = useLocal
    ? localArtifactsDir
    : join(projectDir, "artifacts");

  if (shouldCreate && !useLocal) {
    tryEnsureDir(dataDir);
    tryEnsureDir(checkpointDir);
    tryEnsureDir(artifactsDir);
  }

  const envDbPath = env.DB_PATH?.trim();
  const dbPath = envDbPath
    ? resolve(cwd, envDbPath)
    : join(dataDir, "code-agent.db");

  return {
    workspacePath,
    homeDir,
    projectDir,
    dataDir,
    checkpointDir,
    artifactsDir,
    dbPath,
    globalConfigPath: join(homeDir, "config.json"),
    workspaceConfigPath: join(workspacePath, ".code-agent", "config.json"),
    workspaceEnvPath: join(workspacePath, ".env"),
  };
}
