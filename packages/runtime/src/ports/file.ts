/**
 * CLI 文件持久化端口
 *
 * - sessions.json：会话与消息
 * - runs.json：run / task / artifact
 * - events.jsonl：语义事件追加日志
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  atomicWriteFileSync,
  type CheckpointStore,
} from "@code-agent/core";
import type {
  Artifact,
  ChatMessage,
  EventEnvelope,
  RunId,
  RunSummary,
  SessionEvent,
  SessionId,
  SessionSummary,
  TaskRecord,
} from "@code-agent/protocol";
import { SystemClock } from "./in-memory.js";
import { UuidIdGenerator } from "./in-memory.js";
import type {
  CreateRunInput,
  CreateSessionRecordInput,
  EventLog,
  RunPatch,
  RunStore,
  RuntimePorts,
  SessionStore,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

interface SessionData {
  sessions: SessionSummary[];
  messages: Record<string, ChatMessage[]>;
}

interface RunData {
  runs: RunSummary[];
  tasks: TaskRecord[];
  artifacts: Artifact[];
}

export class FileSessionStore implements SessionStore {
  private readonly filePath: string;
  private readonly data: SessionData;

  constructor(private readonly baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
    this.filePath = join(baseDir, "sessions.json");
    this.data = readJson<SessionData>(this.filePath, {
      sessions: [],
      messages: {},
    });
  }

  private persist(): void {
    atomicWriteFileSync(
      this.filePath,
      `${JSON.stringify(this.data, null, 2)}\n`,
      0o600,
    );
  }

  async create(input: CreateSessionRecordInput): Promise<SessionSummary> {
    const existing = this.data.sessions.find(
      (session) => session.id === input.id,
    );
    if (existing) return clone(existing);

    const summary: SessionSummary = {
      id: input.id,
      title: input.title ?? "New Chat",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.data.sessions.push(summary);
    this.data.messages[input.id] = [];
    this.persist();
    return clone(summary);
  }

  async get(id: SessionId): Promise<SessionSummary | null> {
    const session = this.data.sessions.find((item) => item.id === id);
    return session ? clone(session) : null;
  }

  async list(): Promise<SessionSummary[]> {
    return this.data.sessions
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }

  async updateTitle(
    id: SessionId,
    title: string,
    updatedAt: string,
  ): Promise<void> {
    const session = this.data.sessions.find((item) => item.id === id);
    if (!session) return;
    session.title = title;
    session.updatedAt = updatedAt;
    this.persist();
  }

  async delete(id: SessionId): Promise<void> {
    this.data.sessions = this.data.sessions.filter(
      (session) => session.id !== id,
    );
    delete this.data.messages[id];
    this.persist();
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    const messages = this.data.messages[message.sessionId] ?? [];
    messages.push(clone(message));
    this.data.messages[message.sessionId] = messages;
    const session = this.data.sessions.find(
      (item) => item.id === message.sessionId,
    );
    if (session) session.updatedAt = message.createdAt;
    this.persist();
  }

  async listMessages(
    sessionId: SessionId,
    options: { limit?: number } = {},
  ): Promise<ChatMessage[]> {
    const messages = this.data.messages[sessionId] ?? [];
    return (options.limit !== undefined
      ? messages.slice(-options.limit)
      : messages
    ).map(clone);
  }
}

export class FileRunStore implements RunStore {
  private readonly filePath: string;
  private readonly data: RunData;

  constructor(baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
    this.filePath = join(baseDir, "runs.json");
    this.data = readJson<RunData>(this.filePath, {
      runs: [],
      tasks: [],
      artifacts: [],
    });
  }

  private persist(): void {
    atomicWriteFileSync(
      this.filePath,
      `${JSON.stringify(this.data, null, 2)}\n`,
      0o600,
    );
  }

  async createRun(input: CreateRunInput): Promise<RunSummary> {
    const existing = this.data.runs.find((run) => run.id === input.id);
    if (existing) return clone(existing);

    const summary: RunSummary = {
      id: input.id,
      sessionId: input.sessionId,
      status: input.status,
      ...(input.node ? { node: input.node } : {}),
      startedAt: input.startedAt,
    };
    this.data.runs.push(summary);
    this.persist();
    return clone(summary);
  }

  async updateRun(id: RunId, patch: RunPatch): Promise<void> {
    const run = this.data.runs.find((item) => item.id === id);
    if (!run) return;
    if (patch.status) run.status = patch.status;
    if (patch.node !== undefined) run.node = patch.node;
    if (patch.finishedAt) run.finishedAt = patch.finishedAt;
    this.persist();
  }

  async getRun(id: RunId): Promise<RunSummary | null> {
    const run = this.data.runs.find((item) => item.id === id);
    return run ? clone(run) : null;
  }

  async getActiveRun(sessionId: SessionId): Promise<RunSummary | null> {
    const run = this.data.runs
      .filter(
        (item) =>
          item.sessionId === sessionId &&
          (item.status === "running" ||
            item.status === "awaiting_approval" ||
            item.status === "awaiting_input"),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    return run ? clone(run) : null;
  }

  async listRuns(sessionId: SessionId): Promise<RunSummary[]> {
    return this.data.runs
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(clone);
  }

  async upsertTask(task: TaskRecord): Promise<void> {
    const index = this.data.tasks.findIndex((item) => item.id === task.id);
    if (index === -1) this.data.tasks.push(clone(task));
    else this.data.tasks[index] = clone(task);
    this.persist();
  }

  async listTasks(runId: RunId): Promise<TaskRecord[]> {
    return this.data.tasks
      .filter((task) => task.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }

  async appendArtifact(artifact: Artifact): Promise<void> {
    this.data.artifacts.push(clone(artifact));
    this.persist();
  }

  async listArtifacts(runId: RunId): Promise<Artifact[]> {
    return this.data.artifacts
      .filter((artifact) => artifact.runId === runId)
      .map(clone);
  }
}

export class FileEventLog implements EventLog {
  private readonly filePath: string;

  constructor(baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
    this.filePath = join(baseDir, "events.jsonl");
  }

  async append(envelope: EventEnvelope<SessionEvent>): Promise<void> {
    appendFileSync(this.filePath, `${JSON.stringify(envelope)}\n`, "utf-8");
  }

  async since(
    sessionId: SessionId,
    seq: number,
  ): Promise<Array<EventEnvelope<SessionEvent>>> {
    if (!existsSync(this.filePath)) return [];
    const lines = readFileSync(this.filePath, "utf-8").split("\n");
    const events: Array<EventEnvelope<SessionEvent>> = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const envelope = JSON.parse(
          line,
        ) as EventEnvelope<SessionEvent>;
        if (envelope.sessionId === sessionId && envelope.seq > seq) {
          events.push(envelope);
        }
      } catch {
        // 跳过损坏行
      }
    }
    return events;
  }

  async lastSeq(sessionId: SessionId): Promise<number> {
    const events = await this.since(sessionId, 0);
    return events.reduce(
      (max, event) => Math.max(max, event.seq),
      0,
    );
  }
}

export function createFilePorts(
  baseDir: string,
  checkpoints: CheckpointStore,
): RuntimePorts {
  return {
    sessions: new FileSessionStore(baseDir),
    runs: new FileRunStore(baseDir),
    events: new FileEventLog(baseDir),
    checkpoints,
    clock: new SystemClock(),
    ids: new UuidIdGenerator(),
  };
}
