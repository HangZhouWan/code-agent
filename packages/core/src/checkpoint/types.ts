/**
 * 两层 Checkpoint：Agent（任务级）与 Session（编排级）
 */

import type {
  ApprovalRequest,
  Artifact,
  CallId,
  ChatMessage,
  JsonValue,
  Plan,
  RunId,
  RunStatus,
  SerializedMessage,
  SessionId,
  TaskId,
  TaskRecord,
  UserQuestion,
} from "@code-agent/protocol";
import type { ContextSummary } from "../context/types.js";

export interface SerializedToolCall {
  callId: CallId;
  name: string;
  args: JsonValue;
  ok: boolean;
  content: string;
  errorCode?: string;
}

export type AgentCheckpointStatus =
  | "running"
  | "awaiting_tool"
  | "awaiting_approval";

export interface AgentCheckpointV1 {
  v: 1;
  sessionId: SessionId;
  runId: RunId;
  taskId: TaskId;
  roleId: string;
  step: number;
  status: AgentCheckpointStatus;
  messages: SerializedMessage[];
  tokenCount: number;
  summary?: ContextSummary;
  coveredMessageIds?: string[];
  toolHistory: SerializedToolCall[];
  pendingTool?: {
    callId: CallId;
    name: string;
    args: JsonValue;
    sideEffect: "none" | "idempotent" | "mutating";
  };
  startedAt: string;
  updatedAt: string;
}

export type SessionNode =
  | "planner"
  | "dispatcher"
  | "replanner"
  | "finalizer";

export interface SessionCheckpointV1 {
  v: 1;
  sessionId: SessionId;
  runId: RunId;
  status: RunStatus;
  node: SessionNode;
  /** 恢复时用于重建 workspace；可选以兼容旧快照 */
  workspacePath?: string;
  /** 本次 run 是否启用计划模式 */
  planMode?: boolean;
  /** 执行路径；直接执行（含计划模式）暂不支持恢复 */
  executionMode?: "direct" | "orchestrated";
  plan?: Plan;
  tasks: TaskRecord[];
  completedTaskIds: TaskId[];
  pendingTaskIds: TaskId[];
  inFlightTaskIds: TaskId[];
  artifacts: Artifact[];
  messages: ChatMessage[];
  pendingApprovals: ApprovalRequest[];
  pendingQuestions?: UserQuestion[];
  replanCount: number;
  nextSeq: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecoverableRun {
  sessionId: SessionId;
  runId: RunId;
  node: SessionNode;
  status: RunStatus;
  updatedAt: string;
}

export interface CheckpointStore {
  saveAgent(checkpoint: AgentCheckpointV1): Promise<void>;
  loadAgent(
    sessionId: SessionId,
    runId: RunId,
    taskId: TaskId,
  ): Promise<AgentCheckpointV1 | null>;

  saveSession(checkpoint: SessionCheckpointV1): Promise<void>;
  loadLatestSession(sessionId: SessionId): Promise<SessionCheckpointV1 | null>;
  listRecoverable(): Promise<RecoverableRun[]>;

  purgeRun(sessionId: SessionId, runId: RunId): Promise<void>;

  acquireLease(sessionId: SessionId, owner: string, ttlMs: number): Promise<boolean>;
  renewLease(sessionId: SessionId, owner: string, ttlMs: number): Promise<boolean>;
  releaseLease(sessionId: SessionId, owner: string): Promise<void>;
}

export interface AgentCheckpointSink {
  save(checkpoint: AgentCheckpointV1): Promise<void>;
}

export class CheckpointVersionError extends Error {
  constructor(public readonly version: unknown) {
    super(`Incompatible checkpoint version: ${String(version)}`);
    this.name = "CheckpointVersionError";
  }
}

export class LeaseHeldError extends Error {
  constructor(sessionId: string, owner: string) {
    super(`Session ${sessionId} is leased by ${owner}`);
    this.name = "LeaseHeldError";
  }
}
