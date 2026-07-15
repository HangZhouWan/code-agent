/**
 * StateManager —— 内存实现
 *
 * 提供 InMemoryStateManager，一个基于内存的状态管理器实现。
 * 包含四个子模块：Task、Workflow、Agent、Artifact。
 *
 * 核心特性：
 * - TaskState：状态机校验 + onChange 回调
 * - AgentState：心跳检测 + 空闲查找
 * - ArtifactState：纯追加模式
 * - 可选 EventBus 集成：状态变更自动发事件
 */

import type { IEventBus } from '../event-bus/types.js';
import type {
  AgentState,
  AgentStatus,
  ArtifactList,
  ArtifactState,
  CommitRecord,
  FileChange,
  IStateManager,
  Plan,
  Task,
  TaskState as ITaskState,
  TaskStatus,
  TestResult,
  WorkflowState,
} from './types.js';
import { InvalidTransitionError } from './types.js';
import type { Unsubscribe } from '../event-bus/types.js';

// ─────────────────────────────────────────────
// 状态机定义
// ─────────────────────────────────────────────

/**
 * 合法的状态流转映射
 *
 * 键为当前状态，值为允许转移到的目标状态集合。
 */
const LEGAL_TRANSITIONS: Record<TaskStatus, Set<TaskStatus>> = {
  pending: new Set(['assigned', 'cancelled']),
  assigned: new Set(['running', 'cancelled']),
  running: new Set(['completed', 'failed', 'awaiting_input', 'cancelled']),
  awaiting_input: new Set(['running', 'cancelled']),
  failed: new Set(['pending']),
  completed: new Set([]),
  cancelled: new Set([]),
};

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function now(): Date {
  return new Date();
}

// ─────────────────────────────────────────────
// TaskState 实现
// ─────────────────────────────────────────────

class TaskStateImpl implements ITaskState {
  private tasks = new Map<string, Task>();
  private changeHandlers = new Set<
    (taskId: string, from: TaskStatus, to: TaskStatus) => void
  >();

  /** 重置内部状态（测试用） */
  _reset(): void {
    this.tasks = new Map();
    this.changeHandlers = new Set();
  }

  create(input: Omit<Task, 'status' | 'createdAt' | 'updatedAt'>): Task {
    const task: Task = {
      ...input,
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  transition(taskId: string, to: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found`);
    }

    const from = task.status;
    const allowed = LEGAL_TRANSITIONS[from];

    if (!allowed || !allowed.has(to)) {
      throw new InvalidTransitionError(taskId, from, to);
    }

    task.status = to;
    task.updatedAt = now();

    if (to === 'running' && !task.startedAt) {
      task.startedAt = now();
    }

    if (to === 'completed' || to === 'failed' || to === 'cancelled') {
      task.completedAt = now();
    }

    // 触发 onChange 回调
    for (const handler of this.changeHandlers) {
      try {
        handler(taskId, from, to);
      } catch {
        // 错误隔离：单个回调异常不影响其他回调
      }
    }
  }

  blockedTasks(): Task[] {
    return this.getAll().filter((t) => t.status === 'awaiting_input');
  }

  progress(): {
    total: number;
    done: number;
    failed: number;
    running: number;
    pending: number;
  } {
    const all = this.getAll();
    const total = all.length;
    const done = all.filter((t) => t.status === 'completed').length;
    const failed = all.filter((t) => t.status === 'failed').length;
    const running = all.filter(
      (t) => t.status === 'running' || t.status === 'awaiting_input' || t.status === 'assigned',
    ).length;
    const pending = all.filter((t) => t.status === 'pending').length;

    return { total, done, failed, running, pending };
  }

  onChange(
    handler: (taskId: string, from: TaskStatus, to: TaskStatus) => void,
  ): Unsubscribe {
    this.changeHandlers.add(handler);
    return () => {
      this.changeHandlers.delete(handler);
    };
  }
}

// ─────────────────────────────────────────────
// AgentState 实现
// ─────────────────────────────────────────────

class AgentStateImpl implements AgentState {
  private agents = new Map<string, AgentStatus>();

  /** 重置内部状态（测试用） */
  _reset(): void {
    this.agents = new Map();
  }

  register(agentId: string, role: string): void {
    const existing = this.agents.get(agentId);
    if (existing) {
      // 已存在则更新角色
      existing.role = role;
      existing.lastHeartbeat = now();
      return;
    }

    this.agents.set(agentId, {
      agentId,
      role,
      status: 'idle',
      lastHeartbeat: now(),
      toolCallCount: 0,
    });
  }

  update(agentId: string, partial: Partial<AgentStatus>): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not registered`);
    }
    Object.assign(agent, partial);
  }

  get(agentId: string): AgentStatus | undefined {
    return this.agents.get(agentId);
  }

  getAll(): AgentStatus[] {
    return Array.from(this.agents.values());
  }

  active(): AgentStatus[] {
    return this.getAll().filter((a) => a.status !== 'offline');
  }

  findIdle(role: string): AgentStatus | undefined {
    for (const agent of this.agents.values()) {
      if (agent.role === role && agent.status === 'idle') {
        return agent;
      }
    }
    return undefined;
  }

  heartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = now();
    }
  }
}

// ─────────────────────────────────────────────
// ArtifactState 实现
// ─────────────────────────────────────────────

class ArtifactStateImpl implements ArtifactState {
  private fileChanges: FileChange[] = [];
  private commits: CommitRecord[] = [];
  private testResults: TestResult[] = [];

  /** 重置内部状态（测试用） */
  _reset(): void {
    this.fileChanges = [];
    this.commits = [];
    this.testResults = [];
  }

  addFileChange(change: FileChange): void {
    this.fileChanges.push(change);
  }

  addCommit(hash: string, message: string, taskId: string, files: string[]): void {
    this.commits.push({
      hash,
      message,
      taskId,
      files,
      timestamp: now(),
    });
  }

  addTestResult(
    taskId: string,
    total: number,
    passed: number,
    failed: number,
    output?: string,
  ): void {
    this.testResults.push({
      taskId,
      total,
      passed,
      failed,
      output,
      timestamp: now(),
    });
  }

  changedFiles(): FileChange[] {
    return [...this.fileChanges];
  }

  byTask(taskId: string): ArtifactList {
    return {
      files: this.fileChanges.filter((f) => f.taskId === taskId),
      commits: this.commits.filter((c) => c.taskId === taskId),
      tests: this.testResults.filter((t) => t.taskId === taskId),
    };
  }

  all(): ArtifactList {
    return {
      files: [...this.fileChanges],
      commits: [...this.commits],
      tests: [...this.testResults],
    };
  }
}

// ─────────────────────────────────────────────
// WorkflowState 实现
// ─────────────────────────────────────────────

class WorkflowStateImpl implements WorkflowState {
  private currentNode: string = 'idle';
  private plan: Plan | undefined;
  private decisions: string[] = [];

  /** 重置内部状态（测试用） */
  _reset(): void {
    this.currentNode = 'idle';
    this.plan = undefined;
    this.decisions = [];
  }

  setCurrentNode(node: string): void {
    this.currentNode = node;
  }

  getCurrentNode(): string {
    return this.currentNode;
  }

  setPlan(plan: Plan): void {
    this.plan = plan;
  }

  getPlan(): Plan | undefined {
    return this.plan;
  }

  addDecision(decision: string): void {
    this.decisions.push(decision);
  }

  getDecisions(): string[] {
    return [...this.decisions];
  }
}

// ─────────────────────────────────────────────
// InMemoryStateManager
// ─────────────────────────────────────────────

/**
 * 基于内存的 StateManager 实现
 *
 * 可选集成 EventBus：传入 eventBus 后，
 * task 状态变更自动 publish agent.event.task_status_changed 事件。
 */
export class InMemoryStateManager implements IStateManager {
  readonly task: TaskStateImpl;
  readonly workflow: WorkflowStateImpl;
  readonly agents: AgentStateImpl;
  readonly artifacts: ArtifactStateImpl;

  constructor(eventBus?: IEventBus) {
    this.task = new TaskStateImpl();
    this.workflow = new WorkflowStateImpl();
    this.agents = new AgentStateImpl();
    this.artifacts = new ArtifactStateImpl();

    // 可选的 EventBus 集成：task 状态变更自动发事件
    if (eventBus) {
      this.task.onChange((taskId, from, to) => {
        eventBus
          .publish('agent.event.task_status_changed', {
            taskId,
            from,
            to,
          } as any)
          .catch(() => {
            // 事件发送失败不阻塞状态流转
          });
      });
    }
  }

  reset(): void {
    this.task._reset();
    this.workflow._reset();
    this.agents._reset();
    this.artifacts._reset();
  }
}
