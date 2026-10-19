/**
 * TaskStateStore —— 每会话的任务状态
 */

import type {
  AgentRoleId,
  RunId,
  TaskId,
  TaskRecord,
  TaskResult,
  TaskRouting,
  TaskStatus,
} from "@code-agent/protocol";
import { assertTransition } from "./task-machine.js";

export interface CreateTaskInput {
  id: TaskId;
  runId: RunId;
  role: AgentRoleId;
  description: string;
  routing?: TaskRouting;
  dependsOn?: TaskId[];
}

export class TaskStateStore {
  private readonly tasks = new Map<TaskId, TaskRecord>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  create(input: CreateTaskInput): TaskRecord {
    if (this.tasks.has(input.id)) {
      throw new Error(`Task already exists: ${input.id}`);
    }
    const timestamp = this.now();
    const task: TaskRecord = {
      id: input.id,
      runId: input.runId,
      role: input.role,
      description: input.description,
      status: "pending",
      routing: input.routing ?? "direct",
      dependsOn: input.dependsOn ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.tasks.set(task.id, task);
    return { ...task, dependsOn: [...task.dependsOn] };
  }

  get(id: TaskId): TaskRecord | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task, dependsOn: [...task.dependsOn] } : undefined;
  }

  list(): TaskRecord[] {
    return [...this.tasks.values()].map((task) => ({
      ...task,
      dependsOn: [...task.dependsOn],
    }));
  }

  listByRun(runId: RunId): TaskRecord[] {
    return this.list().filter((task) => task.runId === runId);
  }

  transition(id: TaskId, to: TaskStatus): TaskRecord {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    assertTransition(task.status, to);
    const updated: TaskRecord = {
      ...task,
      status: to,
      updatedAt: this.now(),
    };
    this.tasks.set(id, updated);
    return { ...updated, dependsOn: [...updated.dependsOn] };
  }

  setResult(id: TaskId, result: TaskResult): TaskRecord {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const updated: TaskRecord = {
      ...task,
      result,
      updatedAt: this.now(),
    };
    this.tasks.set(id, updated);
    return { ...updated, dependsOn: [...updated.dependsOn] };
  }

  hydrate(tasks: TaskRecord[]): void {
    this.tasks.clear();
    for (const task of tasks) {
      this.tasks.set(task.id, {
        ...task,
        dependsOn: [...task.dependsOn],
      });
    }
  }

  snapshot(): TaskRecord[] {
    return this.list();
  }

  get size(): number {
    return this.tasks.size;
  }
}
