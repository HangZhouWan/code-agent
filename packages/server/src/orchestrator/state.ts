/**
 * Orchestrator —— LangGraph 状态定义
 *
 * 使用 LangGraph Annotation.Root 定义状态图中各节点的共享状态。
 * 每个字段声明了类型和 reducer 策略（替换/追加/合并）。
 */

import { Annotation } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { SubTask, Plan, NextAction, ReplanSignal, Artifacts } from './types.js';
import type { WorkerOutput } from '@code-agent/core';

/**
 * Orchestrator 工作流的状态图 Annotation
 *
 * 使用 Annotation.Root 定义状态，各字段的 reducer：
 * - messages: 追加（addMessages 语义）
 * - plan / pendingTasks / finalResponse / nextAction: 替换（LastValue）
 * - completedTasks: 合并（浅合并，保留已完成的子任务结果）
 * - replanSignal: 替换（LastValue）
 * - artifacts: 替换（LastValue）
 */
export const OrchestratorState = Annotation.Root({
  /** 用户消息历史，追加模式（新消息追加到末尾） */
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),

  /** Planner 生成的 Plan（含 complexity + tasks + suggestedAgents），替换模式 */
  plan: Annotation<Plan>,

  /** 已完成的子任务结果（taskId → WorkerOutput），合并模式 */
  completedTasks: Annotation<Record<string, WorkerOutput>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  /** 待执行的子任务列表，替换模式 */
  pendingTasks: Annotation<SubTask[]>,

  /** Finalizer 生成的最终回复，替换模式 */
  finalResponse: Annotation<string>,

  /** Dispatcher 的路由决策："continue" 循环 / "replan" 修正 / "finalize" 结束 */
  nextAction: Annotation<NextAction>,

  /**
   * Replan 信号（Step 4 新增）
   *
   * 当 Dispatcher 检测到任务返回 replan_needed 时设置此信号。
   * Replanner 节点读取此信号进行计划修正。
   */
  replanSignal: Annotation<ReplanSignal | null>,

  /**
   * 产物集合（Step 4 新增）
   *
   * 追踪整个工作流执行过程中产生的文件变更、commit 和测试结果。
   * Finalizer 读取此字段生成最终报告。
   */
  artifacts: Annotation<Artifacts>({
    reducer: (left, right) => ({
      files: [...(left?.files ?? []), ...(right?.files ?? [])],
      commits: [...(left?.commits ?? []), ...(right?.commits ?? [])],
      tests: [...(left?.tests ?? []), ...(right?.tests ?? [])],
    }),
    default: () => ({ files: [], commits: [], tests: [] }),
  }),
});
