/**
 * EventBus —— 核心类型定义
 *
 * 定义多 Agent 协作中消息传递的基础类型：
 * BusMessage、Command/Event Topic、IEventBus 接口等。
 */

// ─────────────────────────────────────────────
// 消息 ID & 信封
// ─────────────────────────────────────────────

/** 消息唯一标识 */
export type MessageId = string;

/**
 * 消息信封
 *
 * 所有在 EventBus 中传递的消息统一使用此结构。
 * 包含消息本体（topic + payload）和元数据（correlationId、taskId 等）。
 */
export interface BusMessage<T = unknown> {
  /** 消息唯一 ID */
  id: MessageId;
  /** 消息主题，如 agent.command.run_tests */
  topic: string;
  /** 消息负载 */
  payload: T;
  /** 消息元数据 */
  metadata: BusMessageMetadata;
}

/** 消息元数据 */
export interface BusMessageMetadata {
  /** 关联 ID，用于 request-reply 模式关联请求与响应 */
  correlationId?: MessageId;
  /** 任务 ID，关联到哪个 Task 触发了此消息 */
  taskId?: string;
  /** 发送者 ID（Agent ID 或系统组件名） */
  senderId: string;
  /** 消息时间戳 */
  timestamp: Date;
  /** 消息生存时间（毫秒），超时可丢弃 */
  ttl?: number;
}

// ─────────────────────────────────────────────
// Topic 类型
// ─────────────────────────────────────────────

/**
 * Command 主题 —— 指令消息
 *
 * 格式：`agent.command.<动作>`，期待接收者响应。
 * 例如：agent.command.run_tests、agent.command.fix_code
 */
export type CommandTopic = `agent.command.${string}`;

/**
 * Event 主题 —— 事实消息
 *
 * 格式：`agent.event.<事件>`，广播通知，不期待响应。
 * 例如：agent.event.code_changed、agent.event.test_passed
 */
export type EventTopic = `agent.event.${string}`;

// ─────────────────────────────────────────────
// 处理器 & 订阅管理
// ─────────────────────────────────────────────

/**
 * 消息处理器
 *
 * 订阅者注册的处理函数，接收 BusMessage 并可能执行异步操作。
 * 处理器抛出的异常不会影响其他订阅者。
 */
export type MessageHandler<T = unknown> = (msg: BusMessage<T>) => Promise<void>;

/** 取消订阅函数 —— 调用后不再收到消息 */
export type Unsubscribe = () => void;

// ─────────────────────────────────────────────
// EventBus 接口
// ─────────────────────────────────────────────

/**
 * EventBus 接口
 *
 * 多 Agent 协作系统中的消息中枢，提供 publish/subscribe/request/reply 四种通信模式：
 *
 * - `publish`：fire-and-forget 广播
 * - `subscribe`：精确主题匹配订阅
 * - `subscribePattern`：通配符模式匹配订阅
 * - `request`：发送命令并等待响应
 * - `reply`：响应某个请求消息
 */
export interface IEventBus {
  /**
   * 发布消息（fire-and-forget）
   *
   * 通知所有匹配 topic 的订阅者。订阅者抛异常不会中断其他订阅者。
   * 无匹配订阅者时静默忽略。
   */
  publish(
    topic: CommandTopic | EventTopic,
    payload: unknown,
    metadata?: Partial<BusMessageMetadata>,
  ): Promise<void>;

  /**
   * 发送命令请求并等待响应
   *
   * 生成 correlationId，注册 pending 等待，收到 reply 后返回响应消息。
   * 超时抛出 BusTimeoutError。
   *
   * @param topic - Command 主题
   * @param payload - 请求负载
   * @param timeoutMs - 超时时间（毫秒），默认 30000
   * @returns 响应消息
   * @throws BusTimeoutError 超时未收到响应
   */
  request(
    topic: CommandTopic,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<BusMessage>;

  /**
   * 精确匹配订阅
   *
   * @param topic - 要订阅的主题（精确匹配）
   * @param handler - 消息处理器
   * @returns 取消订阅函数
   */
  subscribe(topic: string, handler: MessageHandler): Unsubscribe;

  /**
   * 通配符模式订阅
   *
   * 使用 glob 风格模式匹配，支持 `*` 匹配单段、`**` 匹配任意段。
   * 例如：`agent.event.*` 匹配 agent.event.code_changed、agent.event.test_passed 等。
   *
   * @param pattern - glob 模式字符串
   * @param handler - 消息处理器
   * @returns 取消订阅函数
   */
  subscribePattern(pattern: string, handler: MessageHandler): Unsubscribe;

  /**
   * 回复消息
   *
   * 通过 inReplyTo 匹配 pending request 的 correlationId，唤醒等待方。
   * 无匹配 request 时静默忽略。
   *
   * @param inReplyTo - 被回复消息的 ID（对应 request 的 correlationId）
   * @param payload - 响应负载
   */
  reply(inReplyTo: MessageId, payload: unknown): Promise<void>;

  /**
   * 查询主题的订阅者数量（调试用）
   *
   * @param topic - 主题名称
   * @returns 精确匹配 + 通配匹配的订阅者总数
   */
  subscriberCount(topic: string): number;
}

// ─────────────────────────────────────────────
// 错误类型
// ─────────────────────────────────────────────

/**
 * EventBus 超时错误
 *
 * 当 request() 在指定时间内未收到 reply 时抛出。
 */
export class BusTimeoutError extends Error {
  /** 请求的消息 ID */
  readonly requestId: MessageId;
  /** 请求的主题 */
  readonly topic: string;
  /** 超时时间（毫秒） */
  readonly timeoutMs: number;

  constructor(requestId: MessageId, topic: string, timeoutMs: number) {
    super(`Request ${requestId} on topic "${topic}" timed out after ${timeoutMs}ms`);
    this.name = 'BusTimeoutError';
    this.requestId = requestId;
    this.topic = topic;
    this.timeoutMs = timeoutMs;
  }
}
