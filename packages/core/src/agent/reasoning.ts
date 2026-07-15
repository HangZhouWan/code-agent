/**
 * ReasoningLoop —— Agent 推理循环抽象
 *
 * 封装 ReAct（Observe → Think → Act → Reflect）执行循环。
 * 是 Agent 四层结构中的第二层，位于 Role 之下、Runtime 之上。
 *
 * 当前实现委托给 ExecutionEngine，未来可替换为自定义推理策略。
 */

import type { ExecutionContext, ExecutionResult } from '../harness/execution/engine.js';
import { ExecutionEngine } from '../harness/execution/engine.js';

/**
 * 推理循环接口
 *
 * 定义 Agent 推理执行的标准契约。
 * 每个 Agent 通过此接口驱动其 ReAct 循环。
 */
export interface IReasoningLoop {
  /**
   * 执行推理循环
   *
   * 接收完整的执行上下文，驱动 Observe → Think → Act → Reflect 循环，
   * 直到任务完成、失败、超时或需要重新规划。
   *
   * @param context - 执行上下文（含模型、工具、消息历史、能力限制）
   * @returns 执行结果（含状态、输出、推理记录）
   */
  run(context: ExecutionContext): Promise<ExecutionResult>;

  /**
   * 从 checkpoint 恢复执行
   *
   * 加载之前的执行快照，从断点继续推理循环。
   *
   * @param taskId - 要恢复的任务 ID
   * @param context - 恢复所需的上下文（模型、工具等）
   * @returns 执行结果
   */
  resume(
    taskId: string,
    context: Omit<ExecutionContext, 'agentId' | 'taskId' | 'agent' | 'context'>,
  ): Promise<ExecutionResult>;
}

/**
 * 默认推理循环实现
 *
 * 直接委托给 ExecutionEngine，保持与 Step 2 的兼容性。
 * 未来可替换为：
 * - 带自定义策略的推理循环（如 chain-of-thought、tree-of-thought）
 * - 带超时和重试的推理循环
 * - 带多模型投票的推理循环
 */
export class DefaultReasoningLoop implements IReasoningLoop {
  constructor(private readonly engine: ExecutionEngine) {}

  /** 委托给 ExecutionEngine.run() */
  async run(context: ExecutionContext): Promise<ExecutionResult> {
    return this.engine.run(context);
  }

  /** 委托给 ExecutionEngine.resume() */
  async resume(
    taskId: string,
    context: Omit<ExecutionContext, 'agentId' | 'taskId' | 'agent' | 'context'>,
  ): Promise<ExecutionResult> {
    return this.engine.resume(
      taskId,
      context.model,
      context.tools,
      context.systemPrompt,
      context.capability,
    );
  }
}
