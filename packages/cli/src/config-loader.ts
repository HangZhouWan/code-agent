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
import { globalConfigSchema } from "@code-agent/core";

// ─── Schema ────────────────────────────────────────

const configFileSchema = globalConfigSchema.extend({
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]).optional(),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MAX_RETRIES: z.coerce.number().optional(),
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

function loadDotEnv(filePath: string): Record<string, string> {
  try {
    if (!existsSync(filePath)) return {};
    const raw = readFileSync(filePath, "utf-8");
    const entries: Record<string, string> = {};

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
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

function findMonoRepoRoot(): string | null {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    let dir = resolve(__dirname);
    for (let i = 0; i < 10; i++) {
      const workspaceFile = join(dir, "pnpm-workspace.yaml");
      if (existsSync(workspaceFile)) return dir;
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}
  return null;
}

// ─── Public API ────────────────────────────────────

export interface LoadConfigOptions {
  workspacePath: string;
  cliModel?: string;
}

export function loadConfig(options: LoadConfigOptions): EnvConfig {
  const { workspacePath, cliModel } = options;

  const globalConfigPath = join(homedir(), ".code-agent", "config.json");
  const globalConfig = loadJsonConfig(globalConfigPath);
  if (globalConfig) console.log(`[config] Loaded global config: ${globalConfigPath}`);

  const projectConfigPath = join(workspacePath, ".code-agent", "config.json");
  const projectConfig = loadJsonConfig(projectConfigPath);
  if (projectConfig) console.log(`[config] Loaded project config: ${projectConfigPath}`);

  const projectEnv = loadDotEnv(join(workspacePath, ".env"));

  const monoRepoRoot = findMonoRepoRoot();
  let monoRepoEnv: Record<string, string> = {};
  if (monoRepoRoot) {
    monoRepoEnv = loadDotEnv(join(monoRepoRoot, ".env"));
    if (Object.keys(monoRepoEnv).length > 0) {
      console.log(`[config] Loaded monorepo .env: ${monoRepoRoot}/.env`);
    }
  }

  const merged: Record<string, string> = {};

  if (globalConfig) {
    if (globalConfig.LLM_PROVIDER) merged.LLM_PROVIDER = globalConfig.LLM_PROVIDER;
    if (globalConfig.LLM_MODEL) merged.LLM_MODEL = globalConfig.LLM_MODEL;
    if (globalConfig.LLM_API_KEY) merged.LLM_API_KEY = globalConfig.LLM_API_KEY;
    if (globalConfig.LLM_BASE_URL) merged.LLM_BASE_URL = globalConfig.LLM_BASE_URL;
    if (globalConfig.LLM_MAX_RETRIES !== undefined) merged.LLM_MAX_RETRIES = String(globalConfig.LLM_MAX_RETRIES);
    if (globalConfig.WORKSPACE_PATH) merged.WORKSPACE_PATH = globalConfig.WORKSPACE_PATH;
  }

  if (projectConfig) {
    if (projectConfig.LLM_PROVIDER) merged.LLM_PROVIDER = projectConfig.LLM_PROVIDER;
    if (projectConfig.LLM_MODEL) merged.LLM_MODEL = projectConfig.LLM_MODEL;
    if (projectConfig.LLM_API_KEY) merged.LLM_API_KEY = projectConfig.LLM_API_KEY;
    if (projectConfig.LLM_BASE_URL) merged.LLM_BASE_URL = projectConfig.LLM_BASE_URL;
    if (projectConfig.LLM_MAX_RETRIES !== undefined) merged.LLM_MAX_RETRIES = String(projectConfig.LLM_MAX_RETRIES);
    if (projectConfig.WORKSPACE_PATH) merged.WORKSPACE_PATH = projectConfig.WORKSPACE_PATH;
  }

  for (const [key, value] of Object.entries({ ...projectEnv, ...monoRepoEnv })) {
    merged[key] = value;
  }

  for (const key of ["LLM_PROVIDER","LLM_MODEL","LLM_API_KEY","LLM_BASE_URL","LLM_MAX_RETRIES","WORKSPACE_PATH"]) {
    if (process.env[key]) merged[key] = process.env[key]!;
  }

  if (cliModel) merged.LLM_MODEL = cliModel;
  merged.WORKSPACE_PATH = workspacePath;

  return finalConfigSchema.parse(merged);
}
