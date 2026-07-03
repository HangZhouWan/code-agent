/**
 * LLM 抽象层 —— 核心类型定义
 *
 * 定义 ModelConfig、ChatOptions、UnifiedResponse、StreamChunk 等
 * 贯穿整个 LLM 调用流程的基础类型。
 */

import type { ToolCall } from '@langchain/core/messages';

// ─────────────────────────────────────────────
// Provider 类型
// ─────────────────────────────────────────────

/**
 * 支持的模型提供商类型
 *
 * - `openai`: OpenAI 官方 API
 * - `anthropic`: Anthropic 官方 API (Claude)
 * - `openai-compatible`: OpenAI 兼容协议 (Ollama / LM Studio / vLLM 等)
 */
export type ModelProvider = 'openai' | 'anthropic' | 'openai-compatible';

// ─────────────────────────────────────────────
// 模型配置
// ─────────────────────────────────────────────

/**
 * 模型配置 —— 创建 ChatModel 实例的完整参数
 *
 * @example
 * ```ts
 * const config: ModelConfig = {
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   temperature: 0.7,
 *   maxRetries: 3,
 * };
 * ```
 */
export interface ModelConfig {
  /** 模型提供商 */
  provider: ModelProvider;

  /** 模型名称 (如 gpt-4o, claude-opus-4-6) */
  model: string;

  /** API 密钥 */
  apiKey: string;

  /** 自定义 API 端点 (默认使用官方地址) */
  baseURL?: string;

  /** 最大重试次数，默认 3 */
  maxRetries?: number;

  /** 采样温度，范围 0-1，默认 0.7 */
  temperature?: number;
}

// ─────────────────────────────────────────────
// 调用选项
// ─────────────────────────────────────────────

/**
 * 单次 Chat 调用的可选参数
 *
 * 与 ModelConfig 分离，方便每次调用时动态配置。
 */
export interface ChatOptions {
  /** 可用的工具定义列表 */
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;

  /** 最大生成 token 数 */
  maxTokens?: number;

  /** 采样温度 (覆盖 ModelConfig 中的设置) */
  temperature?: number;

  /** 停止序列 —— 遇到即终止生成 */
  stopSequences?: string[];
}

// ─────────────────────────────────────────────
// 统一响应
// ─────────────────────────────────────────────

/**
 * 统一的 Chat 调用响应
 *
 * 屏蔽不同 Provider 的响应差异，提供一致的接口。
 */
export interface UnifiedResponse {
  /** 消息角色 */
  role: 'assistant' | 'tool';

  /** 文本内容 (工具调用请求时可能为 null) */
  content: string | null;

  /** 工具调用请求列表 (若无则为空数组) */
  toolCalls: ToolCall[];
}

// ─────────────────────────────────────────────
// 流式响应
// ─────────────────────────────────────────────

/**
 * 流式响应的单个数据块
 *
 * 通过 type 字段区分文本增量与工具调用增量。
 */
export interface StreamChunk {
  /** 数据块类型 */
  type: 'text' | 'tool_call';

  /** 文本增量 (type === 'text' 时有效) */
  content?: string;

  /** 工具调用增量 (type === 'tool_call' 时有效) */
  toolCall?: Partial<ToolCall>;
}

// ─────────────────────────────────────────────
// 协议检测
// ─────────────────────────────────────────────

/**
 * 协议检测结果
 *
 * - `openai`: 确认是 OpenAI 协议端点
 * - `anthropic`: 确认是 Anthropic 协议端点
 * - `unknown`: 无法确定协议类型
 */
export type ProtocolType = 'openai' | 'anthropic' | 'unknown';