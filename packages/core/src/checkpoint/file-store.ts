/**
 * 文件 Checkpoint 存储
 *
 * 布局：
 *   <baseDir>/sessions/<sessionId>/lease.json
 *   <baseDir>/sessions/<sessionId>/<runId>/session.json
 *   <baseDir>/sessions/<sessionId>/<runId>/tasks/<taskId>.json
 *
 * 所有写入均为原子写。
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { RunId, SessionId, TaskId } from "@code-agent/protocol";
import { atomicWriteFileSync } from "../config/global-config.js";
import {
  CheckpointVersionError,
  type AgentCheckpointV1,
  type CheckpointStore,
  type RecoverableRun,
  type SessionCheckpointV1,
} from "./types.js";

export interface FileCheckpointStoreOptions {
  baseDir: string;
  /** 毫秒时钟，用于租约测试 */
  now?: () => number;
}

interface LeaseRecord {
  owner: string;
  expiresAt: number;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || "_";
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function assertVersion(data: { v?: unknown }): void {
  if (data.v !== 1) throw new CheckpointVersionError(data.v);
}

export class FileCheckpointStore implements CheckpointStore {
  private readonly baseDir: string;
  private readonly now: () => number;

  constructor(options: FileCheckpointStoreOptions) {
    this.baseDir = options.baseDir;
    this.now = options.now ?? (() => Date.now());
  }

  private sessionsDir(): string {
    return join(this.baseDir, "sessions");
  }

  private sessionDir(sessionId: SessionId): string {
    return join(this.sessionsDir(), safeSegment(sessionId));
  }

  private runDir(sessionId: SessionId, runId: RunId): string {
    return join(this.sessionDir(sessionId), safeSegment(runId));
  }

  private agentPath(
    sessionId: SessionId,
    runId: RunId,
    taskId: TaskId,
  ): string {
    return join(
      this.runDir(sessionId, runId),
      "tasks",
      `${safeSegment(taskId)}.json`,
    );
  }

  private sessionPath(sessionId: SessionId, runId: RunId): string {
    return join(this.runDir(sessionId, runId), "session.json");
  }

  private leasePath(sessionId: SessionId): string {
    return join(this.sessionDir(sessionId), "lease.json");
  }

  async saveAgent(checkpoint: AgentCheckpointV1): Promise<void> {
    assertVersion(checkpoint);
    atomicWriteFileSync(
      this.agentPath(checkpoint.sessionId, checkpoint.runId, checkpoint.taskId),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      0o600,
    );
  }

  async loadAgent(
    sessionId: SessionId,
    runId: RunId,
    taskId: TaskId,
  ): Promise<AgentCheckpointV1 | null> {
    const data = readJson<AgentCheckpointV1>(
      this.agentPath(sessionId, runId, taskId),
    );
    if (!data) return null;
    assertVersion(data);
    return data;
  }

  async saveSession(checkpoint: SessionCheckpointV1): Promise<void> {
    assertVersion(checkpoint);
    atomicWriteFileSync(
      this.sessionPath(checkpoint.sessionId, checkpoint.runId),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      0o600,
    );
  }

  async loadLatestSession(
    sessionId: SessionId,
  ): Promise<SessionCheckpointV1 | null> {
    const dir = this.sessionDir(sessionId);
    if (!existsSync(dir)) return null;

    const candidates: SessionCheckpointV1[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const data = readJson<SessionCheckpointV1>(
        join(dir, entry.name, "session.json"),
      );
      if (!data) continue;
      assertVersion(data);
      candidates.push(data);
    }

    return (
      candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
      null
    );
  }

  async listRecoverable(): Promise<RecoverableRun[]> {
    const sessionsDir = this.sessionsDir();
    if (!existsSync(sessionsDir)) return [];

    const result: RecoverableRun[] = [];
    for (const sessionEntry of readdirSync(sessionsDir, {
      withFileTypes: true,
    })) {
      if (!sessionEntry.isDirectory()) continue;
      const sessionDir = join(sessionsDir, sessionEntry.name);
      for (const runEntry of readdirSync(sessionDir, { withFileTypes: true })) {
        if (!runEntry.isDirectory()) continue;
        const data = readJson<SessionCheckpointV1>(
          join(sessionDir, runEntry.name, "session.json"),
        );
        if (!data) continue;
        assertVersion(data);
        if (data.status === "completed" || data.status === "aborted") continue;
        result.push({
          sessionId: data.sessionId,
          runId: data.runId,
          node: data.node,
          status: data.status,
          updatedAt: data.updatedAt,
        });
      }
    }

    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async purgeRun(sessionId: SessionId, runId: RunId): Promise<void> {
    rmSync(this.runDir(sessionId, runId), { recursive: true, force: true });
  }

  private readLease(sessionId: SessionId): LeaseRecord | null {
    return readJson<LeaseRecord>(this.leasePath(sessionId));
  }

  private writeLease(sessionId: SessionId, lease: LeaseRecord): void {
    atomicWriteFileSync(
      this.leasePath(sessionId),
      `${JSON.stringify(lease, null, 2)}\n`,
      0o600,
    );
  }

  async acquireLease(
    sessionId: SessionId,
    owner: string,
    ttlMs: number,
  ): Promise<boolean> {
    mkdirSync(this.sessionDir(sessionId), { recursive: true });
    const lease = this.readLease(sessionId);
    const now = this.now();

    if (lease && lease.expiresAt > now && lease.owner !== owner) {
      return false;
    }
    if (lease && lease.owner === owner) {
      this.writeLease(sessionId, { owner, expiresAt: now + ttlMs });
      return true;
    }
    if (lease && lease.expiresAt <= now) {
      try {
        unlinkSync(this.leasePath(sessionId));
      } catch {
        // ignore
      }
    }

    try {
      const fd = openSync(this.leasePath(sessionId), "wx", 0o600);
      try {
        writeSync(fd, JSON.stringify({ owner, expiresAt: now + ttlMs }));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch {
      return false;
    }
  }

  async renewLease(
    sessionId: SessionId,
    owner: string,
    ttlMs: number,
  ): Promise<boolean> {
    const lease = this.readLease(sessionId);
    if (!lease || lease.owner !== owner) return false;
    this.writeLease(sessionId, { owner, expiresAt: this.now() + ttlMs });
    return true;
  }

  async releaseLease(sessionId: SessionId, owner: string): Promise<void> {
    const lease = this.readLease(sessionId);
    if (lease?.owner !== owner) return;
    try {
      unlinkSync(this.leasePath(sessionId));
    } catch {
      // ignore
    }
  }
}
