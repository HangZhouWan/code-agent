/**
 * LLM 基础类型
 */

import type { ProviderId } from "@code-agent/protocol";

/**
 * 支持的模型提供商类型，与 protocol 的 ProviderId 保持一致。
 */
export type ModelProvider = ProviderId;

/**
 * 创建 ChatModel 实例的配置。
 */
export interface ModelConfig {
  /** 模型提供商 */
  provider: ModelProvider;

  /** 模型名称，如 gpt-4o */
  model: string;

  /** API 密钥 */
  apiKey: string;

  /** 自定义 API 端点（可选） */
  baseURL?: string;

  /** 最大重试次数，默认 3 */
  maxRetries?: number;

  /** 采样温度，默认 0.7 */
  temperature?: number;

  /** 单次输出最大 token 数；未设置时 anthropic 使用 8192，其他交给 provider */
  maxTokens?: number;
}
