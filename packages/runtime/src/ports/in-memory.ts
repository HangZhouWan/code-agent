/**
 * 内存端口实现（测试 / CLI）
 */

import { InMemoryCheckpointStore } from "@code-agent/core";
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
import type {
  Clock,
  CreateRunInput,
  CreateSessionInput,
  EventLog,
  IdGenerator,
  RunPatch,
  RunStore,
  RuntimePorts,
  SessionStore,
} from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
  nowMs(): number {
    return Date.now();
  }
}

export class UuidIdGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<SessionId, SessionSummary>();
  private readonly messages = new Map<SessionId, ChatMessage[]>();

  async create(input: CreateSessionInput): Promise<SessionSummary> {
    const existing = this.sessions.get(input.id);
    if (existing) return clone(existing);

    const summary: SessionSummary = {
      id: input.id,
      title: input.title ?? "New Chat",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.sessions.set(input.id, summary);
    this.messages.set(input.id, []);
    return clone(summary);
  }

  async get(id: SessionId): Promise<SessionSummary | null> {
    const summary = this.sessions.get(id);
    return summary ? clone(summary) : null;
  }

  async list(): Promise<SessionSummary[]> {
    return [...this.sessions.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }

  async updateTitle(
    id: SessionId,
    title: string,
    updatedAt: string,
  ): Promise<void> {
    const summary = this.sessions.get(id);
    if (summary) {
      this.sessions.set(id, { ...summary, title, updatedAt });
    }
  }

  async delete(id: SessionId): Promise<void> {
    this.sessions.delete(id);
    this.messages.delete(id);
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    const list = this.messages.get(message.sessionId) ?? [];
    list.push(clone(message));
    this.messages.set(message.sessionId, list);
    const summary = this.sessions.get(message.sessionId);
    if (summary) {
      this.sessions.set(message.sessionId, {
        ...summary,
        updatedAt: message.createdAt,
      });
    }
  }

  async listMessages(
    sessionId: SessionId,
    options: { limit?: number } = {},
  ): Promise<ChatMessage[]> {
    const list = this.messages.get(sessionId) ?? [];
    const sliced =
      options.limit !== undefined ? list.slice(-options.limit) : list;
    return sliced.map(clone);
  }
}

export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<RunId, RunSummary>();
  private readonly tasks = new Map<RunId, TaskRecord[]>();
  private readonly artifacts = new Map<RunId, Artifact[]>();

  async createRun(input: CreateRunInput): Promise<RunSummary> {
    const summary: RunSummary = {
      id: input.id,
      sessionId: input.sessionId,
      status: input.status,
      ...(input.node ? { node: input.node } : {}),
      startedAt: input.startedAt,
    };
    this.runs.set(input.id, summary);
    return clone(summary);
  }

  async updateRun(id: RunId, patch: RunPatch): Promise<void> {
    const current = this.runs.get(id);
    if (!current) return;
    this.runs.set(id, {
      ...current,
      ...patch,
    });
  }

  async getRun(id: RunId): Promise<RunSummary | null> {
    const run = this.runs.get(id);
    return run ? clone(run) : null;
  }

  async getActiveRun(sessionId: SessionId): Promise<RunSummary | null> {
    const active = [...this.runs.values()].find(
      (run) =>
        run.sessionId === sessionId &&
        (run.status === "running" ||
          run.status === "awaiting_approval" ||
          run.status === "awaiting_input"),
    );
    return active ? clone(active) : null;
  }

  async listRuns(sessionId: SessionId): Promise<RunSummary[]> {
    return [...this.runs.values()]
      .filter((run) => run.sessionId === sessionId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(clone);
  }

  async upsertTask(task: TaskRecord): Promise<void> {
    const list = this.tasks.get(task.runId) ?? [];
    const index = list.findIndex((item) => item.id === task.id);
    if (index === -1) list.push(clone(task));
    else list[index] = clone(task);
    this.tasks.set(task.runId, list);
  }

  async listTasks(runId: RunId): Promise<TaskRecord[]> {
    return (this.tasks.get(runId) ?? []).map(clone);
  }

  async appendArtifact(artifact: Artifact): Promise<void> {
    const list = this.artifacts.get(artifact.runId) ?? [];
    list.push(clone(artifact));
    this.artifacts.set(artifact.runId, list);
  }

  async listArtifacts(runId: RunId): Promise<Artifact[]> {
    return (this.artifacts.get(runId) ?? []).map(clone);
  }
}

export class InMemoryEventLog implements EventLog {
  private readonly events: Array<EventEnvelope<SessionEvent>> = [];

  async append(envelope: EventEnvelope<SessionEvent>): Promise<void> {
    this.events.push(clone(envelope));
  }

  async since(
    sessionId: SessionId,
    seq: number,
  ): Promise<Array<EventEnvelope<SessionEvent>>> {
    return this.events
      .filter(
        (event) => event.sessionId === sessionId && event.seq > seq,
      )
      .map(clone);
  }

  async lastSeq(sessionId: SessionId): Promise<number> {
    let last = 0;
    for (const event of this.events) {
      if (event.sessionId === sessionId) last = Math.max(last, event.seq);
    }
    return last;
  }

  clear(): void {
    this.events.length = 0;
  }
}

export function createInMemoryPorts(): RuntimePorts {
  return {
    sessions: new InMemorySessionStore(),
    runs: new InMemoryRunStore(),
    events: new InMemoryEventLog(),
    checkpoints: new InMemoryCheckpointStore(),
    clock: new SystemClock(),
    ids: new UuidIdGenerator(),
  };
}
