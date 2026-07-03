/**
 * 上下文管理 —— 类型定义
 *
 * 定义 Agent 会话上下文相关的核心类型：
 * - ContextWindow：token 预算和压缩阈值
 * - AgentContext：完整的 Agent 会话上下文
 */

import type { BaseMessage } from '@langchain/core/messages';

/**
 * 上下文窗口配置
 *
 * 定义 Agent 可用的 token 预算和自动压缩触发阈值。
 */
export interface ContextWindow {
  /** 最大 token 数，默认 128000 */
  maxTokens: number;
  /** 当前已使用的 token 数（估算值） */
  currentTokens: number;
  /**
   * 压缩触发阈值（0-1 之间的小数）
   *
   * 当 currentTokens > maxTokens × threshold 时触发自动压缩。
   * 默认 0.8（即使用 80% token 后触发压缩）。
   */
  threshold: number;
}

/**
 * Agent 上下文
 *
 * 封装单个 Agent 实例的完整会话状态，包括：
 * - 标识信息（sessionId, agentId）
 * - 消息历史
 * - Token 预算配置
 * - 压缩后生成的摘要（可选）
 */
export interface AgentContext {
  /** 父会话 ID，用于关联同一用户会话下的多个 Agent */
  sessionId: string;
  /** Agent 唯一标识 */
  agentId: string;
  /** 消息历史 */
  messages: BaseMessage[];
  /** Token 窗口配置 */
  window: ContextWindow;
  /**
   * 压缩后的历史消息摘要
   *
   * 当消息历史超阈值触发压缩后填充此字段，
   * 后续新建消息时可以将其作为 system message 注入。
   */
  summary?: string;
}
