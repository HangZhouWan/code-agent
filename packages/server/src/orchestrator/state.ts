/**
 * Orchestrator —— LangGraph 状态定义
 *
 * 使用 LangGraph Annotation.Root 定义状态图中各节点的共享状态。
 * 每个字段声明了类型和 reducer 策略（替换/追加/合并）。
 */

import { Annotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { SubTask, NextAction } from './types.js';
import type { WorkerOutput } from '@my-agent/core';

/**
 * Orchestrator 工作流的状态图 Annotation
 *
 * 使用 Annotation.Root 定义状态，各字段的 reducer：
 * - messages: 追加（addMessages 语义）
 * - plan / pendingTasks / finalResponse / nextAction: 替换（LastValue）
 * - completedTasks: 合并（浅合并，保留已完成的子任务结果）
 */
export const OrchestratorState = Annotation.Root({
  /** 用户消息历史，追加模式（新消息追加到末尾） */
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),

  /** Planner 生成的子任务计划，替换模式 */
  plan: Annotation<SubTask[]>,

  /** 已完成的子任务结果（taskId → WorkerOutput），合并模式 */
  completedTasks: Annotation<Record<string, WorkerOutput>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  /** 待执行的子任务列表，替换模式 */
  pendingTasks: Annotation<SubTask[]>,

  /** Summarizer 生成的最终回复，替换模式 */
  finalResponse: Annotation<string>,

  /** Dispatcher 的路由决策："continue" 循环或 "summarize" 结束 */
  nextAction: Annotation<NextAction>,
});
