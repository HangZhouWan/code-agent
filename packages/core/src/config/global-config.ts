/**
 * GlobalConfigManager —— 全局用户配置读写
 *
 * 管理 ~/.code-agent/config.json 的读取、校验和写入。
 * CLI 和 Web 端共享此模块，保证配置格式一致。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { z } from "zod";

// ─── Schema ────────────────────────────────────────

/**
 * 全局配置文件 JSON Schema
 *
 * 仅包含模型相关配置。与 CLI config-loader 中的 configFileSchema 保持兼容。
 */
export const globalConfigSchema = z.object({
  /** LLM provider */
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]),
  /** Model name */
  LLM_MODEL: z.string().min(1),
  /** API key */
  LLM_API_KEY: z.string().min(1),
  /** Custom API endpoint (optional) */
  LLM_BASE_URL: z.string().optional(),
});

/** 从 Schema 推导的全局配置类型 */
export type GlobalConfig = z.infer<typeof globalConfigSchema>;

// ─── Config Path ───────────────────────────────────

/** 全局配置文件路径：~/.code-agent/config.json */
function getConfigPath(): string {
  return join(homedir(), ".code-agent", "config.json");
}

// ─── Manager ───────────────────────────────────────

export class GlobalConfigManager {
  /**
   * 获取配置文件路径。
   */
  getConfigPath(): string {
    return getConfigPath();
  }

  /**
   * 检查全局配置是否已就绪。
   *
   * 条件：文件存在 + JSON 格式正确 + schema 校验通过。
   * 不满足任一条件返回 false。
   */
  isConfigured(): boolean {
    try {
      if (!existsSync(getConfigPath())) return false;
      const raw = readFileSync(getConfigPath(), "utf-8");
      const parsed = JSON.parse(raw);
      const result = globalConfigSchema.safeParse(parsed);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * 读取并校验全局配置。
   *
   * @returns 校验通过的配置对象，失败时返回 null
   */
  load(): GlobalConfig | null {
    try {
      if (!existsSync(getConfigPath())) return null;
      const raw = readFileSync(getConfigPath(), "utf-8");
      const parsed = JSON.parse(raw);
      const result = globalConfigSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  /**
   * 写入全局配置到 ~/.code-agent/config.json。
   *
   * 自动创建 .code-agent 目录（如果不存在）。
   * 写入前会先校验数据格式。
   *
   * @param config - 待写入的配置
   * @throws {z.ZodError} 数据校验失败时抛出
   */
  save(config: GlobalConfig): void {
    // 先校验
    globalConfigSchema.parse(config);

    const configPath = getConfigPath();
    const dir = dirname(configPath);

    // 确保目录存在
    mkdirSync(dir, { recursive: true });

    // 写入 JSON（pretty-print，方便用户手动编辑）
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
}
