/**
 * createChatModel —— 工厂函数
 *
 * 根据 ModelConfig 动态创建对应的 ChatModel 实例。
 * 直接复用 LangChain 的 BaseChatModel，不做额外包装。
 *
 * 支持的 Provider：
 * - openai → ChatOpenAI
 * - anthropic → ChatAnthropic
 * - openai-compatible → ChatOpenAI (通过自定义 baseURL 接入)
 *
 * 调用方无需关心底层实现差异。
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { ModelConfig } from './types.js';

// ─────────────────────────────────────────────
// 默认值
// ─────────────────────────────────────────────

/** 默认采样温度 */
const DEFAULT_TEMPERATURE = 0.7;

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 3;

// ─────────────────────────────────────────────
// 核心函数
// ─────────────────────────────────────────────

/**
 * 根据配置创建对应的 ChatModel 实例
 *
 * @param config - 模型配置
 * @returns LangChain BaseChatModel 实例
 * @throws {Error} 不支持的 provider 时抛出
 *
 * @example
 * ```ts
 * const model = createChatModel({
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   apiKey: process.env.OPENAI_API_KEY!,
 * });
 *
 * const response = await model.invoke("Hello!");
 * ```
 */
export function createChatModel(config: ModelConfig): BaseChatModel {
  const {
    provider,
    model,
    apiKey,
    baseURL,
    maxRetries = DEFAULT_MAX_RETRIES,
    temperature = DEFAULT_TEMPERATURE,
  } = config;

  // 通用的基础参数
  const baseParams = {
    model,
    temperature,
    maxRetries,
  };

  switch (provider) {
    // ── OpenAI 官方 API ──
    case 'openai':
      return new ChatOpenAI({
        ...baseParams,
        apiKey,
        ...(baseURL && { configuration: { baseURL } }),
      });

    // ── Anthropic 官方 API (Claude) ──
    case 'anthropic':
      return new ChatAnthropic({
        ...baseParams,
        apiKey,
        ...(baseURL && { anthropicApiUrl: baseURL }),
      });

    // ── OpenAI 兼容协议 (Ollama / LM Studio / vLLM 等) ──
    case 'openai-compatible':
      return new ChatOpenAI({
        ...baseParams,
        apiKey: apiKey || 'not-needed', // 本地模型通常不需要 API key
        configuration: {
          baseURL: baseURL || 'http://localhost:11434/v1',
        },
      });

    // ── 不支持的 provider ──
    default:
      throw new Error(
        `[createChatModel] 不支持的 provider: "${provider}"。` +
          `支持的选项: openai, anthropic, openai-compatible`,
      );
  }
}