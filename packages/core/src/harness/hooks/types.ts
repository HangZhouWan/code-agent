/**
 * Hooks 引擎 —— 类型定义
 *
 * 定义事件驱动的插件机制所需的核心类型：
 * - HookEvent：7 个生命周期事件
 * - HookContext：事件上下文
 * - HookResult：处理结果（可用于修改参数和拦截执行）
 * - HookHandler：处理函数签名
 */

/**
 * 生命周期事件枚举
 *
 * 覆盖 Agent 运行时的完整生命周期，按触发顺序排列：
 * - agent:start    → Agent 启动时触发
 * - message:send   → Agent 发送消息时触发
 * - tool:before    → 工具调用前触发
 * - tool:after     → 工具调用后触发
 * - message:receive → Agent 接收消息时触发
 * - agent:end      → Agent 正常结束时触发
 * - agent:error    → Agent 出错时触发
 */
export type HookEvent =
  | 'agent:start'
  | 'agent:end'
  | 'tool:before'
  | 'tool:after'
  | 'agent:error'
  | 'message:send'
  | 'message:receive';

/**
 * 事件上下文
 *
 * 携带事件触发时的上下文信息，传递给每个 HookHandler。
 */
export interface HookContext {
  /** 事件名称 */
  event: HookEvent;
  /** Agent 标识 */
  agentId: string;
  /** 事件触发时间（ISO 8601） */
  timestamp: string;
  /** 事件相关的附加数据，各事件类型的数据结构不同 */
  data: Record<string, unknown>;
}

/**
 * Hook 处理结果
 *
 * HookHandler 可以返回此对象来修改数据或拦截执行。
 * 返回 void 表示无副作用。
 */
export interface HookResult {
  /**
   * 修改后的工具参数（仅 tool:before 事件有效）
   *
   * 多个 handler 的修改会浅合并。
   */
  modifiedArgs?: Record<string, unknown>;
  /**
   * 修改后的工具结果（仅 tool:after 事件有效）
   *
   * 多个 handler 的修改会浅合并。
   */
  modifiedResult?: Record<string, unknown>;
  /**
   * 是否跳过后续执行
   *
   * - tool:before → 跳过工具调用
   * - message:send → 跳过消息发送
   * 任一 handler 返回 true 则整体 skip = true。
   */
  skip?: boolean;
}

/**
 * Hook 处理函数签名
 *
 * 接收事件上下文，可选择性地返回 HookResult 来修改或拦截。
 * 单个 handler 的异常不阻塞其他 handler 或主流程。
 *
 * @param ctx - 事件上下文
 * @returns HookResult 或 void
 */
export type HookHandler = (ctx: HookContext) => Promise<void | HookResult>;
