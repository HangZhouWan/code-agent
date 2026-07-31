/**
 * 环境变量配置加载与 Zod 校验
 *
 * 在服务启动时调用 loadConfig() 获取类型安全的环境配置。
 * 必填字段缺失时 Zod 自动报错退出，避免运行时出现 undefined。
 *
 * 使用方式：
 * - 入口文件最顶部 import { config } from "dotenv"; config();
 * - 然后调用 loadConfig() 获取类型化的配置对象
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema 定义
// ---------------------------------------------------------------------------

/**
 * 环境变量校验 Schema
 *
 * 使用 z.coerce.number() 处理字符串环境变量到数字的转换。
 * LLM_API_KEY 为必填，缺失时 Zod 自动抛出 ZodError 并退出。
 */
const envSchema = z.object({
  /** LLM 提供商: openai / anthropic / openai-compatible */
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]).default("openai"),

  /** 模型名称，如 gpt-4o / claude-opus-4-8 */
  LLM_MODEL: z.string().default("gpt-4o"),

  /** API 密钥（必填，缺失时启动报错） */
  LLM_API_KEY: z.string(),

  /** 自定义 API 端点，用于代理或兼容服务（可选） */
  LLM_BASE_URL: z.string().optional(),

  /** 最大重试次数，默认 3 */
  LLM_MAX_RETRIES: z.coerce.number().default(3),

  /** 服务监听地址 */
  HOST: z.string().default("0.0.0.0"),

  /** 服务监听端口 */
  PORT: z.coerce.number().default(3000),

  /** 工作区根路径 */
  WORKSPACE_PATH: z.string().default("./workspace"),

  /** SQLite 数据库文件路径 */
  DB_PATH: z.string().default("./data/code-agent.db"),
});

// ---------------------------------------------------------------------------
// 类型导出
// ---------------------------------------------------------------------------

/** 从 Schema 推导出的配置类型 */
export type EnvConfig = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// 加载函数
// ---------------------------------------------------------------------------

/**
 * 加载并校验环境变量
 *
 * 从 process.env 中读取配置，经过 Zod 校验后返回类型安全的配置对象。
 * 校验失败时抛出 ZodError，附带详细的字段级错误信息。
 *
 * @returns 类型安全的配置对象
 * @throws {ZodError} 当必填字段缺失或类型不匹配时抛出
 *
 * @example
 * ```ts
 * import { config } from "dotenv";
 * config();
 * const cfg = loadConfig();
 * // cfg.LLM_API_KEY 类型为 string（而非 string | undefined）
 * ```
 */
export function loadConfig(): EnvConfig {
  return envSchema.parse(process.env);
}
