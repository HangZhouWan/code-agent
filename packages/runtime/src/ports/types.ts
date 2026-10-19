/**
 * Runtime 持久化端口
 */

import type { CheckpointStore } from "@code-agent/core";
import type {
  Artifact,
  ChatMessage,
  EventEnvelope,
  RunId,
  RunStatus,
  RunSummary,
  SessionEvent,
  SessionId,
  SessionSummary,
  TaskRecord,
} from "@code-agent/protocol";

export interface Clock {
  now(): string;
  nowMs(): number;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface CreateSessionRecordInput {
  id: SessionId;
  title?: string;
  createdAt: string;
}

export interface SessionStore {
  create(input: CreateSessionRecordInput): Promise<SessionSummary>;
  get(id: SessionId): Promise<SessionSummary | null>;
  list(): Promise<SessionSummary[]>;
  updateTitle(id: SessionId, title: string, updatedAt: string): Promise<void>;
  delete(id: SessionId): Promise<void>;

  appendMessage(message: ChatMessage): Promise<void>;
  listMessages(
    sessionId: SessionId,
    options?: { limit?: number },
  ): Promise<ChatMessage[]>;
}

export interface CreateRunInput {
  id: RunId;
  sessionId: SessionId;
  status: RunStatus;
  startedAt: string;
  node?: string;
}

export interface RunPatch {
  status?: RunStatus;
  node?: string;
  finishedAt?: string;
}

export interface RunStore {
  createRun(input: CreateRunInput): Promise<RunSummary>;
  updateRun(id: RunId, patch: RunPatch): Promise<void>;
  getRun(id: RunId): Promise<RunSummary | null>;
  getActiveRun(sessionId: SessionId): Promise<RunSummary | null>;
  listRuns(sessionId: SessionId): Promise<RunSummary[]>;

  upsertTask(task: TaskRecord): Promise<void>;
  listTasks(runId: RunId): Promise<TaskRecord[]>;
  appendArtifact(artifact: Artifact): Promise<void>;
  listArtifacts(runId: RunId): Promise<Artifact[]>;
}

export interface EventLog {
  append(envelope: EventEnvelope<SessionEvent>): Promise<void>;
  since(
    sessionId: SessionId,
    seq: number,
  ): Promise<Array<EventEnvelope<SessionEvent>>>;
  lastSeq(sessionId: SessionId): Promise<number>;
}

export interface RuntimePorts {
  sessions: SessionStore;
  runs: RunStore;
  events: EventLog;
  checkpoints: CheckpointStore;
  clock: Clock;
  ids: IdGenerator;
}
