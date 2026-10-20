/**
 * 配置 schema
 *
 * 所有配置使用 env 风格大写键，便于文件、.env、process.env 共用同一套 schema。
 * 完整 schema（llmConfigSchema）与 partial schema（llmOverridesSchema）分离，
 * 允许项目级只覆盖部分字段。
 */

import { z } from "zod";
import { PROVIDER_IDS, PROVIDER_DEFINITIONS, type ProviderId } from "./providers.js";

export const providerIdSchema = z.enum(PROVIDER_IDS);

const llmConfigObjectSchema = z.object({
  LLM_PROVIDER: providerIdSchema,
  LLM_MODEL: z.string().trim().min(1, "LLM_MODEL 不能为空"),
  LLM_API_KEY: z.string().default(""),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_MAX_RETRIES: z.number().int().min(0).max(10).default(3),
  /** 单次模型输出的最大 token 数；未设置时由 provider 决定 */
  LLM_MAX_TOKENS: z.coerce
    .number()
    .int()
    .min(256)
    .max(65_536)
    .optional(),
});

/** Provider 需要 API Key 时校验其非空 */
function requireApiKeyIfNeeded(
  value: z.infer<typeof llmConfigObjectSchema>,
  ctx: z.RefinementCtx,
): void {
  const definition = PROVIDER_DEFINITIONS[value.LLM_PROVIDER];
  if (definition.requiresApiKey && value.LLM_API_KEY.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LLM_API_KEY"],
      message: `${definition.label} 需要 LLM_API_KEY`,
    });
  }
}

export const llmConfigSchema =
  llmConfigObjectSchema.superRefine(requireApiKeyIfNeeded);

/**
 * 全局配置文件（~/.code-agent/config.json）schema。
 *
 * 在 LLM 配置之外记录应用级默认值：
 * - WORKSPACE_PATH：Agent 默认工作目录，留空时使用服务启动目录
 */
export const globalConfigSchema = llmConfigObjectSchema
  .extend({
    WORKSPACE_PATH: z
      .string()
      .trim()
      .min(1, "WORKSPACE_PATH 不能为空")
      .optional(),
    /** Auto mode：工作区内写文件/改文件/执行命令无需人工审批 */
    AUTO_MODE: z.boolean().default(false),
  })
  .superRefine(requireApiKeyIfNeeded);

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const llmOverridesSchema = llmConfigObjectSchema.partial();

export const contextConfigSchema = z
  .object({
    CONTEXT_SOFT_THRESHOLD: z.number().min(0.1).max(0.95).default(0.75),
    CONTEXT_HARD_THRESHOLD: z.number().min(0.5).max(1).default(0.9),
    RESERVED_OUTPUT_TOKENS: z.number().int().min(0).default(8_192),
    KEEP_RECENT_RATIO: z.number().min(0.1).max(0.8).default(0.3),
    SUMMARY_MAX_TOKENS: z.number().int().min(256).default(2_000),
    INLINE_TOOL_RESULT_LIMIT: z.number().int().min(1_024).default(8_000),
    SUMMARY_MODEL: z.string().optional(),
    MEMORY_MODEL: z.string().optional(),
  })
  .refine((value) => value.CONTEXT_SOFT_THRESHOLD < value.CONTEXT_HARD_THRESHOLD, {
    message: "CONTEXT_SOFT_THRESHOLD 必须小于 CONTEXT_HARD_THRESHOLD",
    path: ["CONTEXT_SOFT_THRESHOLD"],
  });

export const appConfigSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  WORKSPACE_PATH: z.string().optional(),
  DB_PATH: z.string().optional(),
  CODE_AGENT_HOME: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  AUTO_MODE: z.boolean().default(false),
});

export type LlmConfig = z.infer<typeof llmConfigObjectSchema>;
export type LlmOverrides = z.infer<typeof llmOverridesSchema>;
export type ContextConfig = z.infer<typeof contextConfigSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type { ProviderId };

/** 完整解析：失败时抛出 ZodError */
export function parseLlmConfig(input: unknown): LlmConfig {
  return llmConfigSchema.parse(input);
}

/** 安全解析：用于 setup API / 配置加载 */
export function safeParseLlmConfig(
  input: unknown,
): z.SafeParseReturnType<unknown, LlmConfig> {
  return llmConfigSchema.safeParse(input);
}
