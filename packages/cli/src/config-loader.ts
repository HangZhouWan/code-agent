/**
 * 分层配置加载器
 *
 * 加载优先级（从低到高）：
 *   1. ~/.code-agent/config.json        —— 全局用户配置
 *   2. $WORKSPACE/.code-agent/config.json —— 项目级配置
 *   3. $WORKSPACE/.env                    —— 项目级环境变量文件
 *   4. process.env                        —— 运行时环境变量（最高优先级）
 *
 * 每层覆盖前一层的同名字段。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// ─── Schema ────────────────────────────────────────

const configFileSchema = z.object({
  /** LLM provider */
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]).optional(),
  /** Model name */
  LLM_MODEL: z.string().optional(),
  /** API key */
  LLM_API_KEY: z.string().optional(),
  /** Custom API endpoint */
  LLM_BASE_URL: z.string().optional(),
  /** Max retries */
  LLM_MAX_RETRIES: z.coerce.number().optional(),
  /** Workspace root path (can be overridden by CLI args) */
  WORKSPACE_PATH: z.string().optional(),
});

export type ConfigFileData = z.infer<typeof configFileSchema>;

// ─── Final Config Type ─────────────────────────────

const finalConfigSchema = z.object({
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]).default("openai"),
  LLM_MODEL: z.string().default("gpt-4o"),
  LLM_API_KEY: z.string(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MAX_RETRIES: z.coerce.number().default(3),
  WORKSPACE_PATH: z.string().default("./workspace"),
});

export type EnvConfig = z.infer<typeof finalConfigSchema>;

// ─── Internal Helpers ──────────────────────────────

/** Try to read and parse a JSON config file. Returns null if not found or invalid. */
function loadJsonConfig(filePath: string): ConfigFileData | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = configFileSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`[config] Warning: invalid config at ${filePath}, skipping.`);
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/** Try to load a .env file. Returns key-value pairs. */
function loadDotEnv(filePath: string): Record<string, string> {
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf-8");
    const entries: Record<string, string> = {};

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();

      // Remove surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (key) entries[key] = value;
    }
    return entries;
  } catch {
    return {};
  }
}

// ─── Monorepo Root Detection ───────────────────────

/**
 * Detect the monorepo root by looking for pnpm-workspace.yaml.
 * Used during development (pnpm dev) to load the monorepo's .env file.
 */
function findMonoRepoRoot(): string | null {
  try {
    // When running via tsx during dev, __dirname is packages/cli/src/
    const __dirname = dirname(fileURLToPath(import.meta.url));
    let dir = resolve(__dirname);

    // Walk up from src/ → cli/ → packages/ → root/
    for (let i = 0; i < 10; i++) {
      const workspaceFile = join(dir, "pnpm-workspace.yaml");
      if (existsSync(workspaceFile)) {
        return dir;
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Not running as ESM or in a monorepo — that's fine
  }
  return null;
}

// ─── Public API ────────────────────────────────────

export interface LoadConfigOptions {
  /** Resolved workspace path (from CLI args or cwd) */
  workspacePath: string;
  /** Optional model override from CLI --model flag */
  cliModel?: string;
}

/**
 * Load and merge configuration from all sources.
 *
 * Priority (low → high):
 *   1. ~/.code-agent/config.json
 *   2. $WORKSPACE/.code-agent/config.json
 *   3. $WORKSPACE/.env
 *   4. <monorepo_root>/.env (dev mode only, if applicable)
 *   5. process.env
 *   6. CLI flags (--model)
 *
 * @param options - workspacePath and optional CLI overrides
 * @returns validated EnvConfig
 * @throws ZodError if required fields are missing
 */
export function loadConfig(options: LoadConfigOptions): EnvConfig {
  const { workspacePath, cliModel } = options;

  // Layer 1: Global config (~/.code-agent/config.json)
  const globalConfigPath = join(homedir(), ".code-agent", "config.json");
  const globalConfig = loadJsonConfig(globalConfigPath);
  if (globalConfig) {
    console.log(`[config] Loaded global config: ${globalConfigPath}`);
  }

  // Layer 2: Project-level config ($WORKSPACE/.code-agent/config.json)
  const projectConfigPath = join(workspacePath, ".code-agent", "config.json");
  const projectConfig = loadJsonConfig(projectConfigPath);
  if (projectConfig) {
    console.log(`[config] Loaded project config: ${projectConfigPath}`);
  }

  // Layer 3: Project .env
  const projectEnv = loadDotEnv(join(workspacePath, ".env"));

  // Layer 4: Monorepo root .env (dev mode fallback)
  const monoRepoRoot = findMonoRepoRoot();
  let monoRepoEnv: Record<string, string> = {};
  if (monoRepoRoot) {
    monoRepoEnv = loadDotEnv(join(monoRepoRoot, ".env"));
    if (Object.keys(monoRepoEnv).length > 0) {
      console.log(`[config] Loaded monorepo .env: ${monoRepoRoot}/.env`);
    }
  }

  // Merge layers (each overwrites keys from previous)
  const merged: Record<string, string> = {};

  // Layer 1
  if (globalConfig) {
    if (globalConfig.LLM_PROVIDER) merged.LLM_PROVIDER = globalConfig.LLM_PROVIDER;
    if (globalConfig.LLM_MODEL) merged.LLM_MODEL = globalConfig.LLM_MODEL;
    if (globalConfig.LLM_API_KEY) merged.LLM_API_KEY = globalConfig.LLM_API_KEY;
    if (globalConfig.LLM_BASE_URL) merged.LLM_BASE_URL = globalConfig.LLM_BASE_URL;
    if (globalConfig.LLM_MAX_RETRIES !== undefined) merged.LLM_MAX_RETRIES = String(globalConfig.LLM_MAX_RETRIES);
    if (globalConfig.WORKSPACE_PATH) merged.WORKSPACE_PATH = globalConfig.WORKSPACE_PATH;
  }

  // Layer 2
  if (projectConfig) {
    if (projectConfig.LLM_PROVIDER) merged.LLM_PROVIDER = projectConfig.LLM_PROVIDER;
    if (projectConfig.LLM_MODEL) merged.LLM_MODEL = projectConfig.LLM_MODEL;
    if (projectConfig.LLM_API_KEY) merged.LLM_API_KEY = projectConfig.LLM_API_KEY;
    if (projectConfig.LLM_BASE_URL) merged.LLM_BASE_URL = projectConfig.LLM_BASE_URL;
    if (projectConfig.LLM_MAX_RETRIES !== undefined) merged.LLM_MAX_RETRIES = String(projectConfig.LLM_MAX_RETRIES);
    if (projectConfig.WORKSPACE_PATH) merged.WORKSPACE_PATH = projectConfig.WORKSPACE_PATH;
  }

  // Layer 3 & 4: .env files
  for (const [key, value] of Object.entries({ ...projectEnv, ...monoRepoEnv })) {
    merged[key] = value;
  }

  // Layer 5: process.env (highest priority among environment sources)
  for (const key of [
    "LLM_PROVIDER",
    "LLM_MODEL",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "LLM_MAX_RETRIES",
    "WORKSPACE_PATH",
  ]) {
    if (process.env[key]) {
      merged[key] = process.env[key]!;
    }
  }

  // Layer 6: CLI flags (--model override)
  if (cliModel) {
    merged.LLM_MODEL = cliModel;
  }

  // Always set WORKSPACE_PATH to the resolved workspace from CLI args
  merged.WORKSPACE_PATH = workspacePath;

  // Parse and validate final config
  return finalConfigSchema.parse(merged);
}
