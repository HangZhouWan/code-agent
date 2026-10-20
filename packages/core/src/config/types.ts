/**
 * 配置与路径类型
 */

import type {
  AppConfig,
  ContextConfig,
  LlmConfig,
  ProviderId,
} from "@code-agent/protocol";

export interface WorkspacePaths {
  workspacePath: string;
  homeDir: string;
  projectDir: string;
  dataDir: string;
  checkpointDir: string;
  artifactsDir: string;
  dbPath: string;
  globalConfigPath: string;
  workspaceConfigPath: string;
  workspaceEnvPath: string;
}

export interface ResolvedConfig extends LlmConfig {
  HOST: string;
  PORT: number;
  WORKSPACE_PATH: string;
  DB_PATH: string;
  CODE_AGENT_HOME: string;
  LOG_LEVEL: NonNullable<AppConfig["LOG_LEVEL"]>;
  /** Auto mode：工作区内写入/命令执行免审批 */
  AUTO_MODE: boolean;
  CONTEXT: ContextConfig;
  paths: WorkspacePaths;
}

export interface LoadConfigOptions {
  /** 工作区路径；默认 process.cwd() */
  workspacePath?: string;
  /** CLI --model 覆盖 */
  cliModel?: string;
  /** 相对路径解析基准 */
  cwd?: string;
  /** 覆盖 ~/.code-agent 的 home（测试用） */
  homeDir?: string;
  /** 环境变量来源；默认 process.env */
  env?: Record<string, string | undefined>;
  /** 最高优先级覆盖 */
  overrides?: Partial<LlmConfig> &
    Partial<AppConfig> & { CONTEXT?: Partial<ContextConfig> };
  /** 是否读取 .env；默认 true */
  loadDotEnv?: boolean;
  /** 是否创建运行时目录；默认 true */
  createDirs?: boolean;
  /** 配置加载日志 */
  logger?: (message: string) => void;
}

export interface ResolvePathsOptions {
  workspacePath?: string;
  cwd?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  createDirs?: boolean;
}

export type { ProviderId };
