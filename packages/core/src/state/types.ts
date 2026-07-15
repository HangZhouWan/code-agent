/**
 * StateManager —— 核心类型定义
 *
 * 定义多 Agent 协作系统的状态管理和产物追踪所需的所有类型。
 * 包含四个子状态模块：Task、Workflow、Agent、Artifact。
 */

import type { Unsubscribe } from '../event-bus/types.js';

// ─────────────────────────────────────────────
// Task State
// ─────────────────────────────────────────────

/**
 * 任务状态
 *
 * 状态流转：
 * ```
 * pending ──→ assigned ──→ running ──→ completed
 *                  │            │
 *                  │            ├──→ failed ──→ (可被 Replanner 重置为 pending)
 *                  │            │
 *                  │            └──→ awaiting_input ──→ running
 *                  │
 *                  └──→ cancelled
 * ```
 */
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'running'
  | 'awaiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** 子任务记录 */
export interface Task {
  /** 任务唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 当前状态 */
  status: TaskStatus;
  /** 执行此任务的角色（如 code、test、doc） */
  role: string;
  /** 父亲任务 ID（子任务场景） */
  parentTaskId?: string;
  /** 任务的自然语言描述 */
  description: string;
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 开始执行时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
}

/**
 * 任务状态管理
 *
 * 管理所有 SubTask 的生命周期，包括创建、查询、状态流转和进度统计。
 * 状态变更时通过 onChange 回调通知外部（配合 EventBus 自动发事件）。
 */
export interface TaskState {
  /** 创建任务，默认状态为 pending */
  create(task: Omit<Task, 'status' | 'createdAt' | 'updatedAt'>): Task;

  /** 根据 ID 获取任务 */
  get(taskId: string): Task | undefined;

  /** 获取所有任务 */
  getAll(): Task[];

  /**
   * 状态流转
   *
   * 校验状态机合法性（如不能 completed → running），非法抛异常。
   * 触发 onChange 回调。
   */
  transition(taskId: string, to: TaskStatus): void;

  /** 返回被阻塞的任务（awaiting_input 状态） */
  blockedTasks(): Task[];

  /** 进度统计 */
  progress(): { total: number; done: number; failed: number; running: number; pending: number };

  /**
   * 监听状态变更
   *
   * 当任意任务 status 变化时触发回调。
   * 配合 EventBus 使用：onChange 自动 publish 事件。
   */
  onChange(handler: (taskId: string, from: TaskStatus, to: TaskStatus) => void): Unsubscribe;
}

// ─────────────────────────────────────────────
// Agent State
// ─────────────────────────────────────────────

/** Agent 实时状态 */
export interface AgentStatus {
  /** Agent 唯一标识 */
  agentId: string;
  /** Agent 角色（如 code、test、doc） */
  role: string;
  /** 当前运行状态 */
  status: 'idle' | 'busy' | 'error' | 'offline';
  /** 当前正在执行的任务 ID（busy 时有效） */
  currentTask?: string;
  /** 上次心跳时间 */
  lastHeartbeat: Date;
  /** 工具调用计数 */
  toolCallCount: number;
}

/**
 * Agent 状态管理
 *
 * 追踪所有 Agent 的实时状态，支持注册、更新、查询和心跳检测。
 */
export interface AgentState {
  /** 注册新 Agent，默认状态为 idle */
  register(agentId: string, role: string): void;

  /** 部分更新 Agent 状态 */
  update(agentId: string, partial: Partial<AgentStatus>): void;

  /** 获取单个 Agent 状态 */
  get(agentId: string): AgentStatus | undefined;

  /** 获取所有 Agent 状态 */
  getAll(): AgentStatus[];

  /** 获取活跃 Agent（非 offline） */
  active(): AgentStatus[];

  /** 查找指定角色的第一个空闲 Agent */
  findIdle(role: string): AgentStatus | undefined;

  /** 更新心跳时间 */
  heartbeat(agentId: string): void;
}

// ─────────────────────────────────────────────
// Artifact State
// ─────────────────────────────────────────────

/** 文件变更记录 */
export interface FileChange {
  /** 文件路径 */
  path: string;
  /** 操作类型 */
  action: 'created' | 'modified' | 'deleted';
  /** 关联任务 ID */
  taskId: string;
  /** 执行操作的 Agent 角色 */
  agentRole: string;
  /** 变更时间 */
  timestamp: Date;
}

/** Commit 记录 */
export interface CommitRecord {
  /** Commit hash */
  hash: string;
  /** Commit message */
  message: string;
  /** 关联任务 ID */
  taskId: string;
  /** 变更文件列表 */
  files: string[];
  /** 提交时间 */
  timestamp: Date;
}

/** 测试结果记录 */
export interface TestResult {
  /** 关联任务 ID */
  taskId: string;
  /** 测试总数 */
  total: number;
  /** 通过数 */
  passed: number;
  /** 失败数 */
  failed: number;
  /** 测试输出（可选） */
  output?: string;
  /** 测试时间 */
  timestamp: Date;
}

/** 按任务归并的产物列表 */
export interface ArtifactList {
  /** 文件变更 */
  files: FileChange[];
  /** Git commits */
  commits: CommitRecord[];
  /** 测试结果 */
  tests: TestResult[];
}

/**
 * 产物状态管理
 *
 * 纯追加（append-only）模式，不修改已写入的记录。
 */
export interface ArtifactState {
  /** 追加文件变更记录 */
  addFileChange(change: FileChange): void;

  /** 追加 Commit 记录 */
  addCommit(hash: string, message: string, taskId: string, files: string[]): void;

  /** 追加测试结果 */
  addTestResult(taskId: string, total: number, passed: number, failed: number, output?: string): void;

  /** 获取所有文件变更记录 */
  changedFiles(): FileChange[];

  /** 按任务 ID 归并产物 */
  byTask(taskId: string): ArtifactList;

  /** 获取所有产物 */
  all(): ArtifactList;
}

// ─────────────────────────────────────────────
// Workflow State
// ─────────────────────────────────────────────

/**
 * 计划（Plan）
 *
 * Planner 输出的结构化计划，包含复杂度判定和子任务列表。
 */
export interface Plan {
  /** 复杂度判定 */
  complexity: 'simple' | 'complex';
  /** 子任务列表 */
  tasks: SubTask[];
  /** 建议的任务→角色映射 */
  suggestedAgents: Record<string, string>;
}

/**
 * 子任务
 *
 * 计划中的最小可执行单元。
 */
export interface SubTask {
  /** 子任务唯一标识 */
  id: string;
  /** 自然语言描述 */
  description: string;
  /** 允许使用的工具列表 */
  tools: string[];
  /** 依赖的前置任务 ID */
  dependsOn: string[];
  /** 路由方式：direct 直接调用 / bus 通过 EventBus 发布 */
  routing: 'direct' | 'bus';
}

/**
 * Workflow 状态管理
 *
 * 追踪当前工作流的执行位置、计划和决策历史。
 */
export interface WorkflowState {
  /** 设置当前执行节点名称 */
  setCurrentNode(node: string): void;

  /** 获取当前执行节点 */
  getCurrentNode(): string;

  /** 设置当前计划 */
  setPlan(plan: Plan): void;

  /** 获取当前计划 */
  getPlan(): Plan | undefined;

  /** 追加决策记录 */
  addDecision(decision: string): void;

  /** 获取所有决策记录 */
  getDecisions(): string[];
}

// ─────────────────────────────────────────────
// StateManager 总入口
// ─────────────────────────────────────────────

/**
 * 状态管理器总接口
 *
 * 统一入口，包含四个子状态模块：
 * - task：任务生命周期管理
 * - workflow：工作流位置和计划
 * - agents：Agent 实时状态
 * - artifacts：产物追踪
 */
export interface IStateManager {
  /** 任务状态模块 */
  task: TaskState;

  /** 工作流状态模块 */
  workflow: WorkflowState;

  /** Agent 状态模块 */
  agents: AgentState;

  /** 产物状态模块 */
  artifacts: ArtifactState;

  /** 重置所有状态（主要用于测试） */
  reset(): void;
}

// ─────────────────────────────────────────────
// 错误类型
// ─────────────────────────────────────────────

/**
 * 状态流转非法错误
 *
 * 当 TaskState.transition() 请求非法状态流转时抛出。
 */
export class InvalidTransitionError extends Error {
  /** 任务 ID */
  readonly taskId: string;
  /** 当前状态 */
  readonly from: TaskStatus;
  /** 请求的目标状态 */
  readonly to: TaskStatus;

  constructor(taskId: string, from: TaskStatus, to: TaskStatus) {
    super(`Invalid task transition: "${taskId}" from "${from}" to "${to}"`);
    this.name = 'InvalidTransitionError';
    this.taskId = taskId;
    this.from = from;
    this.to = to;
  }
}
