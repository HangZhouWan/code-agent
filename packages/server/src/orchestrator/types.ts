/**
 * Orchestrator —— 类型定义
 *
 * 定义 Orchestrator 使用的子任务接口和状态枚举。
 */

import type { WorkerOutput } from '@my-agent/core';

/**
 * 子任务描述 —— Planner 节点生成的计划项
 *
 * 每个 SubTask 描述一个可独立（或依赖前置任务）执行的子任务，
 * 由 Dispatcher 派发给 WorkerAgent 执行。
 */
export interface SubTask {
  /** 子任务唯一标识，如 "task-1"、"analyze-code" */
  id: string;
  /** 子任务的自然语言描述，将作为 Worker 的任务描述 */
  description: string;
  /** 该子任务需要的工具列表，如 ["file_read", "code_search"] */
  tools: string[];
  /**
   * 依赖的前置任务 ID 列表
   *
   * 当前置任务全部完成后，此子任务才能开始执行。
   * 空数组或 undefined 表示无依赖，可立即并行执行。
   */
  dependsOn?: string[];
}

/**
 * Orchestrator 状态图中 dispatcher 的路由动作
 *
 * - "continue": 还有等待中的子任务，需要继续循环
 * - "summarize": 所有子任务完成，跳转到汇总节点
 */
export type NextAction = 'continue' | 'summarize';

/**
 * 子任务执行结果汇总（内部使用）
 */
export interface TaskResult {
  task: SubTask;
  output: WorkerOutput;
}
