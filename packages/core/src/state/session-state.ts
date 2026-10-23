/**
 * SessionStateManager
 *
 * 每会话唯一状态入口：Task + Artifact。
 * Agent 活动状态由 TaskState 派生，不再维护 Agent.status。
 */

import type {
  AgentActivity,
  Artifact,
  SessionId,
  TaskRecord,
  TaskStatus,
} from "@code-agent/protocol";
import { ArtifactStateStore } from "./artifact-state.js";
import { TaskStateStore } from "./task-state.js";

const ACTIVE_STATUSES: readonly TaskStatus[] = [
  "assigned",
  "running",
  "awaiting_approval",
  "awaiting_input",
];

export interface SessionStateSnapshot {
  tasks: TaskRecord[];
  artifacts: Artifact[];
}

export class SessionStateManager {
  readonly tasks: TaskStateStore;
  readonly artifacts: ArtifactStateStore;

  constructor(
    readonly sessionId: SessionId,
    now?: () => string,
  ) {
    this.tasks = new TaskStateStore(now);
    this.artifacts = new ArtifactStateStore();
  }

  hydrate(tasks: TaskRecord[], artifacts: Artifact[]): void {
    this.tasks.hydrate(tasks);
    this.artifacts.hydrate(artifacts);
  }

  /** 由 TaskState 派生角色活动，替代旧的 Agent.status */
  getAgentActivity(): AgentActivity[] {
    const byRole = new Map<string, AgentActivity>();
    for (const task of this.tasks.list()) {
      if (!ACTIVE_STATUSES.includes(task.status)) continue;
      const existing = byRole.get(task.role) ?? {
        roleId: task.role,
        activeTaskIds: [],
      };
      existing.activeTaskIds.push(task.id);
      byRole.set(task.role, existing);
    }
    return [...byRole.values()];
  }

  snapshot(): SessionStateSnapshot {
    return {
      tasks: this.tasks.snapshot(),
      artifacts: this.artifacts.snapshot(),
    };
  }

  clear(): void {
    this.tasks.hydrate([]);
    this.artifacts.hydrate([]);
  }
}
