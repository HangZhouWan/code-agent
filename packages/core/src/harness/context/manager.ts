/**
 * 上下文管理器 —— ContextManager
 *
 * 管理所有活跃 Agent 的会话上下文生命周期。
 *
 * 核心职责：
 * - 创建/查询/销毁 Agent 上下文
 * - 追加消息并自动触发 token 预算压缩
 * - 注入工具调用结果（ToolMessage）
 * - 为子 Agent 创建继承上下文（摘要传递）
 *
 * @example
 * ```ts
 * const manager = new ContextManager();
 * const ctx = manager.create('session-1', 'agent-1');
 * manager.addMessage('agent-1', new HumanMessage('Hello'));
 * ```
 */

import {
  HumanMessage,
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { AgentContext, ContextWindow, RuntimeContext } from './types.js';
import { compressMessages } from './compressor.js';

/**
 * 默认 token 预算
 */
const DEFAULT_MAX_TOKENS = 128000;

/**
 * 默认压缩阈值（使用 80% 后触发压缩）
 */
const DEFAULT_THRESHOLD = 0.8;

/**
 * 默认保留最近消息数（压缩时保留不动）
 */
const DEFAULT_KEEP_RECENT = 20;

/**
 * 上下文管理器
 *
 * 线程不安全 —— 仅供单个 Orchestrator 使用。
 */
export class ContextManager {
  /** agentId → AgentContext 存储 */
  private contexts = new Map<string, AgentContext>();

  /**
   * 创建新的 Agent 上下文
   *
   * @param sessionId - 父会话 ID
   * @param agentId - Agent 唯一标识
   * @param window - Token 窗口配置（可选，使用默认值）
   * @returns 新创建的 AgentContext
   */
  create(
    sessionId: string,
    agentId: string,
    window?: Partial<ContextWindow>,
  ): AgentContext {
    const ctx: AgentContext = {
      sessionId,
      agentId,
      messages: [],
      window: {
        maxTokens: window?.maxTokens ?? DEFAULT_MAX_TOKENS,
        currentTokens: window?.currentTokens ?? 0,
        threshold: window?.threshold ?? DEFAULT_THRESHOLD,
      },
    };
    this.contexts.set(agentId, ctx);
    return ctx;
  }

  /**
   * 查询 Agent 上下文
   *
   * @param agentId - Agent 唯一标识
   * @returns AgentContext 或 undefined
   */
  get(agentId: string): AgentContext | undefined {
    return this.contexts.get(agentId);
  }

  /**
   * 追加消息到 Agent 的消息历史
   *
   * 会自动更新 token 估算值。当 currentTokens 超过
   * maxTokens × threshold 时触发消息压缩，将摘要写入 ctx.summary。
   *
   * @param agentId - Agent 唯一标识
   * @param message - 要追加的消息
   * @returns 更新后的 AgentContext，若 Agent 不存在返回 undefined
   */
  async addMessage(
    agentId: string,
    message: BaseMessage,
  ): Promise<AgentContext | undefined> {
    const ctx = this.contexts.get(agentId);
    if (!ctx) return undefined;

    ctx.messages.push(message);
    ctx.window.currentTokens = this.estimateTokens(ctx.messages);

    // 超阈值时触发压缩
    const usageRatio = ctx.window.currentTokens / ctx.window.maxTokens;
    if (usageRatio > ctx.window.threshold) {
      ctx.summary = await compressMessages(ctx.messages, ctx.window.maxTokens, {
        keepRecent: DEFAULT_KEEP_RECENT,
      });
      // 压缩后重新估算（摘要 + 保留的消息）
      ctx.window.currentTokens = this.estimateTokens(ctx.messages);
    }

    return ctx;
  }

  /**
   * 注入工具调用结果（ToolMessage）
   *
   * 将工具执行结果包装为 ToolMessage 并追加到消息历史。
   * 也会触发与 addMessage 相同的压缩逻辑。
   *
   * @param agentId - Agent 唯一标识
   * @param toolCallId - 工具调用的唯一 ID
   * @param toolName - 工具名称
   * @param result - 工具执行结果字符串
   * @returns 更新后的 AgentContext，若 Agent 不存在返回 undefined
   */
  async addToolResult(
    agentId: string,
    toolCallId: string,
    toolName: string,
    result: string,
  ): Promise<AgentContext | undefined> {
    const toolMessage = new ToolMessage({
      content: result,
      tool_call_id: toolCallId,
      name: toolName,
    });
    return this.addMessage(agentId, toolMessage);
  }

  /**
   * 为子 Agent 创建继承上下文
   *
   * 子 Agent 继承父 Agent 的 sessionId 和摘要，但不继承完整消息历史。
   * 这确保子 Agent 获得任务背景（通过摘要）同时拥有独立的 token 预算。
   *
   * @param parentAgentId - 父 Agent ID
   * @param childAgentId - 子 Agent ID
   * @param taskDescription - 子 Agent 的任务描述（作为首条 HumanMessage）
   * @param window - 子 Agent 的 token 窗口配置（可选）
   * @returns 子 Agent 的 AgentContext，若父 Agent 不存在返回 undefined
   */
  inheritForSubAgent(
    parentAgentId: string,
    childAgentId: string,
    taskDescription: string,
    window?: Partial<ContextWindow>,
  ): AgentContext | undefined {
    const parent = this.contexts.get(parentAgentId);
    if (!parent) return undefined;

    const childWindow: ContextWindow = {
      maxTokens: window?.maxTokens ?? DEFAULT_MAX_TOKENS,
      currentTokens: window?.currentTokens ?? 0,
      threshold: window?.threshold ?? DEFAULT_THRESHOLD,
    };

    // 构建子 Agent 的初始消息
    const messages: BaseMessage[] = [];

    // 如果父 Agent 有摘要，作为 system context 注入
    if (parent.summary) {
      messages.push(
        new HumanMessage(
          `Previous conversation summary:\n${parent.summary}\n\nNew task: ${taskDescription}`,
        ),
      );
    } else {
      messages.push(new HumanMessage(taskDescription));
    }

    // 如果有父 Agent 的最近 AI 消息（上下文），追加
    const recentParentMessages = parent.messages.slice(-4); // 最近 2 轮对话
    for (const msg of recentParentMessages) {
      if (msg instanceof AIMessage || msg instanceof HumanMessage) {
        messages.push(msg);
      }
    }

    // 去重：如果 taskDescription 已经是最新消息，避免重复
    const lastMsg = messages[messages.length - 1];
    if (
      lastMsg instanceof HumanMessage &&
      lastMsg.content === taskDescription &&
      messages.length > 1
    ) {
      // 已经作为最后一条消息了，不需要额外操作
    }

    const childCtx: AgentContext = {
      sessionId: parent.sessionId,
      agentId: childAgentId,
      messages,
      window: childWindow,
      summary: parent.summary,
    };

    // 估算初始 token
    childCtx.window.currentTokens = this.estimateTokens(messages);

    this.contexts.set(childAgentId, childCtx);
    return childCtx;
  }

  /**
   * 销毁 Agent 上下文
   *
   * @param agentId - Agent 唯一标识
   * @returns 是否成功删除
   */
  delete(agentId: string): boolean {
    return this.contexts.delete(agentId);
  }

  // ─── ExecutionEngine 辅助方法 ─────────────

  /**
   * 从消息列表构建 RuntimeContext
   *
   * 构建轻量级的运行时上下文，用于 ExecutionEngine。
   * 不与内部 contexts Map 关联。
   *
   * @param messages - 初始消息列表
   * @param window - Token 窗口配置（可选）
   * @returns 运行时上下文
   */
  build(
    messages: BaseMessage[],
    window?: Partial<ContextWindow>,
  ): RuntimeContext {
    const tokenCount = this.estimateTokens(messages);
    return {
      messages: [...messages],
      tokenCount,
      summary: undefined,
    };
  }

  /**
   * 追加内容到 RuntimeContext
   *
   * 向消息列表追加一条 HumanMessage，重新计算 token 估算。
   * 如果 token 使用超过 maxTokens * threshold，自动触发压缩。
   *
   * @param ctx - 当前运行时上下文
   * @param content - 要追加的文本内容
   * @param maxTokens - Token 上限（用于压缩检查）
   * @param threshold - 压缩阈值（0-1），默认 0.8
   * @returns 更新后的运行时上下文
   */
  async append(
    ctx: RuntimeContext,
    content: string,
    maxTokens?: number,
    threshold?: number,
  ): Promise<RuntimeContext> {
    const newMessage = new HumanMessage(content);
    const messages = [...ctx.messages, newMessage];
    const tokenCount = this.estimateTokens(messages);

    const result: RuntimeContext = {
      messages,
      tokenCount,
      summary: ctx.summary,
    };

    // 超阈值时触发压缩
    const limit = maxTokens ?? DEFAULT_MAX_TOKENS;
    const thresh = threshold ?? DEFAULT_THRESHOLD;
    if (tokenCount > limit * thresh) {
      return this.compress(result, limit);
    }

    return result;
  }

  /**
   * 压缩 RuntimeContext
   *
   * 保留最近 20 条消息，对更早的消息生成摘要。
   * 摘要合并到 summary 字段中，后续构建 prompt 时注入。
   *
   * @param ctx - 当前运行时上下文
   * @param maxTokens - Token 上限（当前预留，未使用）
   * @returns 压缩后的运行时上下文
   */
  async compress(
    ctx: RuntimeContext,
    _maxTokens?: number,
  ): Promise<RuntimeContext> {
    const keepRecent = DEFAULT_KEEP_RECENT;

    if (ctx.messages.length <= keepRecent) {
      return ctx;
    }

    // 对更早的消息生成摘要
    const toCompress = ctx.messages.slice(
      0,
      ctx.messages.length - keepRecent,
    );
    const toKeep = ctx.messages.slice(-keepRecent);

    const excerpts = toCompress.slice(0, 10).map((msg, i) => {
      const content =
        typeof msg.content === 'string'
          ? msg.content.slice(0, 500)
          : JSON.stringify(msg.content).slice(0, 500);
      return `[${i + 1}] ${content}`;
    });

    const newSummary = ctx.summary
      ? `${ctx.summary}\n[Additional context: ${toCompress.length} earlier messages]\n${excerpts.join('\n')}`
      : `[Summary of ${toCompress.length} earlier messages]\n${excerpts.join('\n')}`;

    const tokenCount = this.estimateTokens(toKeep);

    return {
      messages: toKeep,
      tokenCount,
      summary: newSummary,
    };
  }

  /**
   * 获取当前管理的上下文数量
   */
  get size(): number {
    return this.contexts.size;
  }

  /**
   * 简单 token 估算（字符数 / 4）
   *
   * 这是一个粗略估算，实际 token 数取决于具体的 tokenizer。
   * 后续可替换为 tiktoken 或 Anthropic 的 tokenizer。
   *
   * @param messages - 消息数组
   * @returns 估算的 token 数
   */
  estimateTokens(messages: BaseMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      const content = msg.content;
      if (typeof content === 'string') {
        totalChars += content.length;
      } else if (Array.isArray(content)) {
        // 多模态内容块
        for (const block of content as Array<string | Record<string, unknown>>) {
          if (typeof block === 'string') {
            totalChars += block.length;
          } else if (typeof block === 'object' && block !== null && 'text' in block) {
            totalChars += String(block.text).length;
          }
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }
}
