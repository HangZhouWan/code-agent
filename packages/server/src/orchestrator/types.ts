/**
 * Orchestrator —— 类型定义
 *
 * 定义 Orchestrator 使用的子任务接口、Plan 结构和状态枚举。
 */

import type { WorkerOutput } from '@my-agent/core';

/**
 * 子任务描述 —— Planner 节点生成的计划项
 *
 * 每个 SubTask 描述一个可独立（或依赖前置任务）执行的子任务，
 * 由 Dispatcher 根据 routing 字段决定走 direct 通道还是 bus 通道。
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
  /**
   * 路由方式（Step 4 新增）
   *
   * - "direct"：简单任务，由 Dispatcher 直接调用 Agent.run()
   * - "bus"：复杂任务，发布到 EventBus 等待 Agent 协作完成
   */
  routing: 'direct' | 'bus';
  /**
   * 负责的 Agent 角色（Step 4 新增）
   *
   * 如 "code"、"test"、"doc"，Dispatcher 根据此字段
   * 从 AgentRegistry 查找对应 Agent。
   */
  role: string;
}

/**
 * Plan —— Planner 节点的完整输出（Step 4 新增）
 *
 * 包含复杂度判定、子任务列表和建议的任务→角色映射。
 */
export interface Plan {
  /** 复杂度判定：simple 单 Agent 可完成 / complex 需多 Agent 协作 */
  complexity: 'simple' | 'complex';
  /** 子任务列表 */
  tasks: SubTask[];
  /** 建议的任务→角色映射（taskId → roleId） */
  suggestedAgents: Record<string, string>;
}

/**
 * Orchestrator 状态图中 dispatcher 的路由动作
 *
 * - "continue": 还有等待中的子任务，需要继续循环
 * - "replan": 有任务返回 replan_needed 信号，需要修正计划
 * - "finalize": 所有子任务完成，跳转到 Finalizer 节点
 */
export type NextAction = 'continue' | 'replan' | 'finalize';

/**
 * Replan 信号（Step 4 新增）
 *
 * 当 Dispatcher 检测到任务返回 replan_needed 时，
 * 将信号传递给 Replanner 节点进行处理。
 */
export interface ReplanSignal {
  /** 触发 replan 的源任务 ID */
  sourceTaskId: string;
  /** 失败/冲突原因 */
  reason: string;
  /** 修正建议 */
  suggestion: string;
}

/**
 * 产物集合（Step 4 新增）
 *
 * 追踪整个工作流执行过程中产生的文件变更、commit 和测试结果。
 */
export interface Artifacts {
  files: FileChange[];
  commits: CommitRecord[];
  tests: TestResult[];
}

/** 文件变更记录 */
export interface FileChange {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  taskId: string;
  agentRole: string;
  timestamp: Date;
}

/** Commit 记录 */
export interface CommitRecord {
  hash: string;
  message: string;
  taskId: string;
  files: string[];
  timestamp: Date;
}

/** 测试结果记录 */
export interface TestResult {
  taskId: string;
  total: number;
  passed: number;
  failed: number;
  output?: string;
  timestamp: Date;
}

/**
 * 子任务执行结果汇总（内部使用）
 */
export interface TaskResult {
  task: SubTask;
  output: WorkerOutput;
}
