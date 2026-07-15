/**
 * EventBus —— 内存实现
 *
 * 提供 InMemoryEventBus，一个基于内存的 EventBus 实现。
 * 核心特性：
 * - publish/subscribe：fire-and-forget + 精确/通配匹配
 * - request/reply：命令-响应模式，支持超时
 * - 错误隔离：单个 handler 异常不影响其他订阅者
 */

import type {
  BusMessage,
  BusMessageMetadata,
  CommandTopic,
  EventTopic,
  IEventBus,
  MessageHandler,
  MessageId,
  Unsubscribe,
} from './types.js';
import { BusTimeoutError } from './types.js';

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/** 生成唯一 ID */
function generateId(): MessageId {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 当前时间戳 */
function now(): Date {
  return new Date();
}

/**
 * 将 glob 模式转换为正则表达式
 *
 * 支持两种通配符：
 * - `*`：匹配单段（不含 `.`）
 * - `**`：匹配任意段
 *
 * @example
 *   globToRegex('agent.event.*')      → /^agent\.event\.[^.]+$/
 *   globToRegex('agent.**.changed')   → /^agent\..+\.changed$/
 *   globToRegex('agent.event.**')     → /^agent\.event\..+$/
 */
function globToRegex(pattern: string): RegExp {
  // 先处理 **（多段通配），替换为占位符
  const doubleStarPlaceholder = '___DOUBLE_STAR___';
  let escaped = pattern.replace(/\*\*/g, doubleStarPlaceholder);

  // 转义正则特殊字符（除 * 和占位符外）
  escaped = escaped.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

  // 替换单段通配 *
  escaped = escaped.replace(/\*/g, '[^.]+');

  // 替换多段通配 **
  escaped = escaped.replace(new RegExp(doubleStarPlaceholder, 'g'), '.+');

  return new RegExp(`^${escaped}$`);
}

// ─────────────────────────────────────────────
// Pending Request
// ─────────────────────────────────────────────

/** Pending request 记录 */
interface PendingRequest {
  resolve: (msg: BusMessage) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─────────────────────────────────────────────
// InMemoryEventBus
// ─────────────────────────────────────────────

/**
 * 基于内存的 EventBus 实现
 *
 * 单进程内高效传递消息。适合单机开发/调试阶段使用，
 * 后续可替换为 Redis/RabbitMQ 等分布式实现。
 */
export class InMemoryEventBus implements IEventBus {
  /** 精确匹配订阅：topic → handler 集合 */
  private readonly handlers = new Map<string, Set<MessageHandler>>();

  /** 通配模式订阅：{ regex, handler } 列表 */
  private readonly patternHandlers: Array<{
    regex: RegExp;
    handler: MessageHandler;
  }> = [];

  /** 等待响应的 request：correlationId → PendingRequest */
  private readonly pendingRequests = new Map<MessageId, PendingRequest>();

  // ─── publish ────────────────────────────

  /**
   * 发布消息（fire-and-forget）
   *
   * 通知所有匹配的订阅者（精确 + 通配），订阅者抛异常不中断其他订阅者。
   * 无匹配订阅者时静默忽略。
   */
  async publish(
    topic: CommandTopic | EventTopic,
    payload: unknown,
    metadata?: Partial<BusMessageMetadata>,
  ): Promise<void> {
    const message: BusMessage = {
      id: generateId(),
      topic,
      payload,
      metadata: {
        senderId: metadata?.senderId ?? 'unknown',
        timestamp: metadata?.timestamp ?? now(),
        correlationId: metadata?.correlationId,
        taskId: metadata?.taskId,
        ttl: metadata?.ttl,
      },
    };

    await this.deliver(message);
  }

  // ─── request ────────────────────────────

  /**
   * 发送命令请求并等待响应
   *
   * 生成 correlationId，向匹配 handler 投递消息，然后等待 reply。
   * 超时抛出 BusTimeoutError。
   */
  async request(
    topic: CommandTopic,
    payload: unknown,
    timeoutMs = 30000,
  ): Promise<BusMessage> {
    const correlationId = generateId();

    const message: BusMessage = {
      id: generateId(),
      topic,
      payload,
      metadata: {
        senderId: 'system',
        timestamp: now(),
        correlationId,
      },
    };

    return new Promise<BusMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new BusTimeoutError(correlationId, topic, timeoutMs));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, timer });

      // 投递消息，不等待
      this.deliver(message).catch(() => {
        // 投递失败不阻塞 request
      });
    });
  }

  // ─── subscribe ──────────────────────────

  /**
   * 精确匹配订阅
   */
  subscribe(topic: string, handler: MessageHandler): Unsubscribe {
    let handlers = this.handlers.get(topic);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(topic, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers?.delete(handler);
      if (handlers && handlers.size === 0) {
        this.handlers.delete(topic);
      }
    };
  }

  // ─── subscribePattern ───────────────────

  /**
   * 通配符模式订阅
   *
   * 使用 glob 风格模式：`*` 匹配单段，`**` 匹配任意段。
   */
  subscribePattern(pattern: string, handler: MessageHandler): Unsubscribe {
    const regex = globToRegex(pattern);
    const entry = { regex, handler };
    this.patternHandlers.push(entry);

    return () => {
      const idx = this.patternHandlers.indexOf(entry);
      if (idx !== -1) {
        this.patternHandlers.splice(idx, 1);
      }
    };
  }

  // ─── reply ──────────────────────────────

  /**
   * 回复消息
   *
   * 根据 inReplyTo（即 request 的 correlationId）匹配 pending request。
   * 匹配不到则静默忽略。
   */
  async reply(inReplyTo: MessageId, payload: unknown): Promise<void> {
    const pending = this.pendingRequests.get(inReplyTo);
    if (!pending) {
      // 无匹配 request，静默忽略
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(inReplyTo);

    const response: BusMessage = {
      id: generateId(),
      topic: `reply.${inReplyTo}`,
      payload,
      metadata: {
        senderId: 'system',
        timestamp: now(),
        correlationId: inReplyTo,
      },
    };

    pending.resolve(response);
  }

  // ─── subscriberCount ────────────────────

  /**
   * 查询主题的订阅者数量（调试用）
   *
   * 包括精确匹配和通配匹配的订阅者。
   */
  subscriberCount(topic: string): number {
    let count = 0;

    // 精确匹配
    const exactHandlers = this.handlers.get(topic);
    if (exactHandlers) {
      count += exactHandlers.size;
    }

    // 通配匹配
    for (const { regex } of this.patternHandlers) {
      if (regex.test(topic)) {
        count += 1;
      }
    }

    return count;
  }

  // ─── 内部方法 ───────────────────────────

  /**
   * 投递消息到所有匹配的订阅者
   *
   * 内部方法，负责错误隔离：单个 handler 抛异常不影响其他 handler。
   */
  private async deliver(message: BusMessage): Promise<void> {
    const promises: Promise<void>[] = [];

    // 精确匹配
    const exactHandlers = this.handlers.get(message.topic);
    if (exactHandlers) {
      for (const handler of exactHandlers) {
        promises.push(this.safeInvoke(handler, message));
      }
    }

    // 通配匹配
    for (const { regex, handler } of this.patternHandlers) {
      if (regex.test(message.topic)) {
        promises.push(this.safeInvoke(handler, message));
      }
    }

    // 等待所有 handler 完成（不阻断彼此）
    await Promise.allSettled(promises);
  }

  /**
   * 安全调用 handler，捕获异常不影响其他订阅者
   */
  private async safeInvoke(
    handler: MessageHandler,
    message: BusMessage,
  ): Promise<void> {
    try {
      await handler(message);
    } catch {
      // 错误隔离：单个 handler 异常不中断其他订阅者
    }
  }
}
