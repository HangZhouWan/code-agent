/**
 * 内存 Checkpoint 存储（测试 / CLI）
 */

import type { RunId, SessionId, TaskId } from "@code-agent/protocol";
import {
  CheckpointVersionError,
  type AgentCheckpointV1,
  type CheckpointStore,
  type RecoverableRun,
  type SessionCheckpointV1,
} from "./types.js";

interface LeaseRecord {
  owner: string;
  expiresAt: number;
}

function sessionKey(sessionId: SessionId, runId: RunId): string {
  return `${sessionId}|${runId}`;
}

function agentKey(
  sessionId: SessionId,
  runId: RunId,
  taskId: TaskId,
): string {
  return `${sessionId}|${runId}|${taskId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly agents = new Map<string, AgentCheckpointV1>();
  private readonly sessions = new Map<string, SessionCheckpointV1>();
  private readonly leases = new Map<string, LeaseRecord>();
  private readonly now: () => number;

  constructor(now?: () => number) {
    this.now = now ?? (() => Date.now());
  }

  async saveAgent(checkpoint: AgentCheckpointV1): Promise<void> {
    if (checkpoint.v !== 1) throw new CheckpointVersionError(checkpoint.v);
    this.agents.set(
      agentKey(checkpoint.sessionId, checkpoint.runId, checkpoint.taskId),
      clone(checkpoint),
    );
  }

  async loadAgent(
    sessionId: SessionId,
    runId: RunId,
    taskId: TaskId,
  ): Promise<AgentCheckpointV1 | null> {
    const checkpoint = this.agents.get(agentKey(sessionId, runId, taskId));
    return checkpoint ? clone(checkpoint) : null;
  }

  async saveSession(checkpoint: SessionCheckpointV1): Promise<void> {
    if (checkpoint.v !== 1) throw new CheckpointVersionError(checkpoint.v);
    this.sessions.set(
      sessionKey(checkpoint.sessionId, checkpoint.runId),
      clone(checkpoint),
    );
  }

  async loadLatestSession(
    sessionId: SessionId,
  ): Promise<SessionCheckpointV1 | null> {
    const candidates = [...this.sessions.values()]
      .filter((checkpoint) => checkpoint.sessionId === sessionId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return candidates[0] ? clone(candidates[0]) : null;
  }

  async listRecoverable(): Promise<RecoverableRun[]> {
    return [...this.sessions.values()]
      .filter(
        (checkpoint) =>
          checkpoint.status !== "completed" && checkpoint.status !== "aborted",
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((checkpoint) => ({
        sessionId: checkpoint.sessionId,
        runId: checkpoint.runId,
        node: checkpoint.node,
        status: checkpoint.status,
        updatedAt: checkpoint.updatedAt,
      }));
  }

  async purgeRun(sessionId: SessionId, runId: RunId): Promise<void> {
    this.sessions.delete(sessionKey(sessionId, runId));
    for (const key of [...this.agents.keys()]) {
      if (key.startsWith(`${sessionId}|${runId}|`)) {
        this.agents.delete(key);
      }
    }
  }

  async acquireLease(
    sessionId: SessionId,
    owner: string,
    ttlMs: number,
  ): Promise<boolean> {
    const lease = this.leases.get(sessionId);
    const now = this.now();
    if (lease && lease.expiresAt > now && lease.owner !== owner) {
      return false;
    }
    this.leases.set(sessionId, { owner, expiresAt: now + ttlMs });
    return true;
  }

  async renewLease(
    sessionId: SessionId,
    owner: string,
    ttlMs: number,
  ): Promise<boolean> {
    const lease = this.leases.get(sessionId);
    if (!lease || lease.owner !== owner) return false;
    this.leases.set(sessionId, { owner, expiresAt: this.now() + ttlMs });
    return true;
  }

  async releaseLease(sessionId: SessionId, owner: string): Promise<void> {
    const lease = this.leases.get(sessionId);
    if (lease?.owner === owner) {
      this.leases.delete(sessionId);
    }
  }
}
