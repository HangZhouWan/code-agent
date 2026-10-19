/**
 * 全局用户配置读写
 *
 * 文件默认位于 ~/.code-agent/config.json：
 * - 原子写（temp + fsync + rename）
 * - 权限 0600
 * - 对外提供掩码视图，避免 API Key 泄漏到 UI/日志
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { llmConfigSchema, type LlmConfig } from "@code-agent/protocol";
import { resolveCodeAgentHome } from "./paths.js";

/** 全局配置文件 schema（与完整 LLM 配置一致） */
export const globalConfigSchema = llmConfigSchema;

export type GlobalConfig = LlmConfig;

export type GlobalConfigInput = {
  LLM_PROVIDER: LlmConfig["LLM_PROVIDER"];
  LLM_MODEL: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MAX_RETRIES?: number;
};

export interface GlobalConfigManagerOptions {
  homeDir?: string;
  filePath?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

/** 原子写文件（同目录 temp + fsync + rename） */
export function atomicWriteFileSync(
  filePath: string,
  content: string,
  mode = 0o600,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tempPath, "w", mode);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
}

/** 掩码 API Key：保留首尾 4 位 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export class GlobalConfigManager {
  private readonly filePath: string;

  constructor(options: GlobalConfigManagerOptions = {}) {
    const homeDir = resolveCodeAgentHome({
      homeDir: options.homeDir,
      env: options.env,
      cwd: options.cwd,
    });
    this.filePath = options.filePath ?? join(homeDir, "config.json");
  }

  getConfigPath(): string {
    return this.filePath;
  }

  /** 读取并校验全局配置；不存在或无效时返回 null */
  load(): GlobalConfig | null {
    try {
      if (!existsSync(this.filePath)) return null;
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = llmConfigSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** 是否已配置（provider/model 完整，且必要 API Key 非空） */
  isConfigured(): boolean {
    return this.load() !== null;
  }

  /** 写入全局配置（校验后原子写） */
  save(config: GlobalConfigInput): GlobalConfig {
    const parsed = llmConfigSchema.parse(config);
    atomicWriteFileSync(
      this.filePath,
      `${JSON.stringify(parsed, null, 2)}\n`,
      0o600,
    );
    return parsed;
  }

  /** 返回脱敏配置，用于 API/UI 展示 */
  masked(): GlobalConfig | null {
    const config = this.load();
    if (!config) return null;
    return { ...config, LLM_API_KEY: maskApiKey(config.LLM_API_KEY) };
  }
}
