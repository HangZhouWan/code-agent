/**
 * 分层配置加载器（唯一实现）
 *
 * 优先级（从低到高）：
 *   defaults
 *   < ~/.code-agent/config.json
 *   < $WORKSPACE/.code-agent/config.json
 *   < $WORKSPACE/.env
 *   < <monorepo>/.env
 *   < process.env / options.env
 *   < options.overrides
 *   < options.cliModel
 *
 * 所有层只接受已知配置键，避免 process.env 噪声污染配置。
 * 例外：LANGSMITH_* / LANGCHAIN_* 追踪变量会参与合并，并在最后写回
 * process.env，供 LangChain / LangSmith SDK 直接读取。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseDotEnv } from "dotenv";
import {
  DEFAULT_PROVIDER_ID,
  appConfigSchema,
  contextConfigSchema,
  getDefaultModel,
  llmConfigSchema,
  type ContextConfig,
  type LlmConfig,
} from "@code-agent/protocol";
import {
  expandHomePath,
  resolveCodeAgentHome,
  resolvePaths,
} from "./paths.js";
import type { LoadConfigOptions, ResolvedConfig } from "./types.js";

const LLM_KEYS = [
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MAX_RETRIES",
  "LLM_MAX_TOKENS",
] as const;

const APP_KEYS = [
  "HOST",
  "PORT",
  "WORKSPACE_PATH",
  "DB_PATH",
  "CODE_AGENT_HOME",
  "LOG_LEVEL",
  "AUTO_MODE",
] as const;

const CONTEXT_NUMERIC_KEYS = [
  "CONTEXT_SOFT_THRESHOLD",
  "CONTEXT_HARD_THRESHOLD",
  "RESERVED_OUTPUT_TOKENS",
  "KEEP_RECENT_RATIO",
  "SUMMARY_MAX_TOKENS",
  "INLINE_TOOL_RESULT_LIMIT",
] as const;

const CONTEXT_STRING_KEYS = ["SUMMARY_MODEL", "MEMORY_MODEL"] as const;

const KNOWN_KEYS = new Set<string>([
  ...LLM_KEYS,
  ...APP_KEYS,
  ...CONTEXT_NUMERIC_KEYS,
  ...CONTEXT_STRING_KEYS,
]);

/**
 * LangSmith 追踪相关的前缀。
 *
 * 这些键不进入 ResolvedConfig，但需要参与分层合并，
 * 并在最后写回 process.env 供 LangChain / LangSmith SDK 读取。
 * 同时包含 LANGSMITH_* 新变量与 LANGCHAIN_* 旧别名。
 */
const TRACING_ENV_PREFIXES = ["LANGSMITH_", "LANGCHAIN_"] as const;

/** 判断 key 是否为追踪相关环境变量 */
export function isTracingEnvKey(key: string): boolean {
  return TRACING_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** 判断 key 是否允许进入配置合并（已知配置键或追踪变量） */
function isKnownKey(key: string): boolean {
  return KNOWN_KEYS.has(key) || isTracingEnvKey(key);
}

function pickKnown(
  source: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!source) return result;
  for (const [key, value] of Object.entries(source)) {
    if (isKnownKey(key) && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function readJsonConfig(
  filePath: string,
  logger: (message: string) => void,
): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logger(`[config] Ignoring non-object config: ${filePath}`);
      return null;
    }
    logger(`[config] Loaded ${filePath}`);
    return pickKnown(parsed as Record<string, unknown>);
  } catch {
    logger(`[config] Ignoring invalid JSON config: ${filePath}`);
    return null;
  }
}

function readDotEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  try {
    return parseDotEnv(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

/** 从 startDir 向上查找 pnpm-workspace.yaml */
export function findMonorepoRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) ||
      existsSync(join(dir, "pnpm-workspace.yml"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown> | null | undefined,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && isKnownKey(key)) {
      target[key] = value;
    }
  }
}

/**
 * 将合并后的追踪变量写回 process.env。
 *
 * LangChain / LangSmith SDK 直接读取 process.env，而 .env 文件只经过
 * dotenv.parse 解析，不会进入进程环境；这里补齐这一步。
 * 仅在调用方以真实 process.env 作为来源时执行，避免测试注入的环境
 * 泄漏到全局。
 *
 * @param merged - 已完成所有层级合并的配置
 * @param sourceEnv - 本次加载使用的环境变量来源
 */
function applyTracingEnv(
  merged: Record<string, unknown>,
  sourceEnv: Record<string, string | undefined>,
): void {
  if (sourceEnv !== process.env) return;
  for (const [key, value] of Object.entries(merged)) {
    if (!isTracingEnvKey(key) || value === undefined) continue;
    process.env[key] = String(value);
  }
}

/** 数字字符串转为 number；非数字保留给 zod 报错 */
function normalizeNumber(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

/** 环境变量中的布尔字符串转为 boolean */
function normalizeBoolean(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  return value;
}

function buildContextInput(
  merged: Record<string, unknown>,
  overrides?: Partial<ContextConfig>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const key of CONTEXT_NUMERIC_KEYS) {
    input[key] = normalizeNumber(merged[key]);
    if (input[key] === undefined) delete input[key];
  }
  for (const key of CONTEXT_STRING_KEYS) {
    if (merged[key] !== undefined) input[key] = merged[key];
  }
  return { ...input, ...overrides };
}

/**
 * 加载并解析完整配置。
 *
 * @throws ZodError 当配置缺失/非法（例如缺少 API Key）
 */
export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const logger = options.logger ?? (() => {});

  // 先读取全局配置：其中的 WORKSPACE_PATH 作为默认工作目录，
  // 优先级低于显式 options / 环境变量，高于 cwd。
  const homeDir = resolveCodeAgentHome({
    homeDir: options.homeDir,
    env,
    cwd,
  });
  const globalConfig = readJsonConfig(join(homeDir, "config.json"), logger);
  const configuredWorkspace =
    typeof globalConfig?.WORKSPACE_PATH === "string"
      ? globalConfig.WORKSPACE_PATH
      : undefined;
  const workspaceInput =
    options.workspacePath ??
    env.WORKSPACE_PATH ??
    configuredWorkspace ??
    ".";
  const workspacePath = resolve(cwd, expandHomePath(workspaceInput));

  const paths = resolvePaths({
    workspacePath,
    cwd,
    homeDir: options.homeDir,
    env,
    createDirs: options.createDirs,
  });

  const defaultContext = contextConfigSchema.parse({});
  const merged: Record<string, unknown> = {
    LLM_PROVIDER: DEFAULT_PROVIDER_ID,
    LLM_MODEL: getDefaultModel(DEFAULT_PROVIDER_ID),
    LLM_API_KEY: "",
    LLM_MAX_RETRIES: 3,
    HOST: "127.0.0.1",
    PORT: 3000,
    LOG_LEVEL: "info",
    AUTO_MODE: false,
    ...defaultContext,
  };

  mergeInto(merged, globalConfig);
  mergeInto(merged, readJsonConfig(paths.workspaceConfigPath, logger));

  if (options.loadDotEnv !== false) {
    // 工作区 .env 低于 monorepo .env（保持原 CLI 行为）
    mergeInto(merged, pickKnown(readDotEnv(paths.workspaceEnvPath)));

    const monoRepoRoot = findMonorepoRoot(workspacePath);
    if (monoRepoRoot) {
      mergeInto(merged, pickKnown(readDotEnv(join(monoRepoRoot, ".env"))));
    }
  }

  mergeInto(merged, pickKnown(env));

  const { CONTEXT: contextOverrides, ...restOverrides } =
    options.overrides ?? {};
  mergeInto(merged, restOverrides as Record<string, unknown>);
  if (options.cliModel) merged.LLM_MODEL = options.cliModel;

  // 工作区最终由本次调用决定（全局配置仅提供默认值），
  // 项目级 config.json 不能反向覆盖工作区。
  merged.WORKSPACE_PATH = workspacePath;
  merged.CODE_AGENT_HOME = paths.homeDir;
  const configuredDbPath =
    typeof merged.DB_PATH === "string" && merged.DB_PATH.trim()
      ? resolve(cwd, merged.DB_PATH)
      : paths.dbPath;
  merged.DB_PATH = configuredDbPath;

  const llm = llmConfigSchema.parse({
    LLM_PROVIDER: merged.LLM_PROVIDER,
    LLM_MODEL: merged.LLM_MODEL,
    LLM_API_KEY: merged.LLM_API_KEY,
    LLM_BASE_URL: merged.LLM_BASE_URL,
    LLM_MAX_RETRIES: normalizeNumber(merged.LLM_MAX_RETRIES),
    LLM_MAX_TOKENS: normalizeNumber(merged.LLM_MAX_TOKENS),
  }) satisfies LlmConfig;

  const context = contextConfigSchema.parse(
    buildContextInput(merged, contextOverrides),
  );

  const app = appConfigSchema.parse({
    HOST: merged.HOST,
    PORT: merged.PORT,
    WORKSPACE_PATH: workspacePath,
    DB_PATH: configuredDbPath,
    CODE_AGENT_HOME: paths.homeDir,
    LOG_LEVEL: merged.LOG_LEVEL,
    AUTO_MODE: normalizeBoolean(merged.AUTO_MODE),
  });

  // .env 中的 LANGSMITH_* / LANGCHAIN_* 需要写回进程环境，SDK 才能读到
  applyTracingEnv(merged, env);

  return {
    ...llm,
    HOST: app.HOST,
    PORT: app.PORT,
    WORKSPACE_PATH: workspacePath,
    DB_PATH: configuredDbPath,
    CODE_AGENT_HOME: paths.homeDir,
    LOG_LEVEL: app.LOG_LEVEL,
    AUTO_MODE: app.AUTO_MODE,
    CONTEXT: context,
    paths,
  };
}
