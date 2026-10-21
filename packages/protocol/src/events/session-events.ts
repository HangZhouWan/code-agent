/**
 * 传输无关的会话域事件
 *
 * CLI / WebSocket / HTTP 适配器只消费这一套事件，不直接接触 LangGraph。
 */

import type { CallId, MemoryId, QuestionId, RunId, SessionId, TaskId } from "../ids.js";
import type { IsoTimestamp, JsonValue } from "../json.js";
import type { SerializedError } from "../errors.js";
import type { AgentRoleId } from "../domain/role.js";
import type { Plan, TaskStatus } from "../domain/plan.js";
import type { ChatMessage } from "../domain/message.js";
import type { RunResult, UserTurnInput } from "../domain/session.js";
import type {
  ApprovalDecision,
  ApprovalRequest,
  UserQuestion,
} from "../domain/interaction.js";
import type { ApprovalKind } from "../domain/interaction.js";
import type { MemoryOp } from "../domain/memory.js";

export const SESSION_EVENT_TYPES = [
  "run.started",
  "message.delta",
  "message.completed",
  "tool.started",
  "tool.finished",
  "approval.required",
  "approval.resolved",
  "user.question.required",
  "user.question.resolved",
  "task.status",
  "plan.updated",
  "plan.mode.changed",
  "checkpoint.saved",
  "context.compacted",
  "memory.updated",
  "session.title.updated",
  "run.completed",
  "run.failed",
  "run.aborted",
] as const;

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];

export type SessionEvent =
  | { type: "run.started"; input: UserTurnInput; resumed: boolean }
  | { type: "message.delta"; messageId: string; delta: string }
  | { type: "message.completed"; message: ChatMessage }
  | {
      type: "tool.started";
      callId: CallId;
      runId: RunId;
      taskId: TaskId;
      agentRunId?: string;
      toolName: string;
      args: JsonValue;
    }
  | {
      type: "tool.finished";
      callId: CallId;
      taskId: TaskId;
      ok: boolean;
      resultPreview: string;
      durationMs: number;
      errorCode?: string;
    }
  | { type: "approval.required"; request: ApprovalRequest }
  | {
      type: "approval.resolved";
      callId: CallId;
      decision: ApprovalDecision;
      reason?: string;
      kind?: ApprovalKind;
      selectedProposalIds?: string[];
      feedback?: string;
    }
  | { type: "user.question.required"; question: UserQuestion }
  | { type: "user.question.resolved"; questionId: QuestionId; answer: string }
  | {
      type: "task.status";
      taskId: TaskId;
      roleId: AgentRoleId;
      status: TaskStatus;
    }
  | { type: "plan.updated"; plan: Plan }
  | { type: "plan.mode.changed"; enabled: boolean }
  | { type: "checkpoint.saved"; checkpointId: string; scope: "agent" | "session"; node?: string }
  | {
      type: "context.compacted";
      beforeTokens: number;
      afterTokens: number;
      strategy: string;
      summaryTokens?: number;
      artifactsCreated?: number;
    }
  | { type: "memory.updated"; memoryId: MemoryId; op: MemoryOp["op"] }
  | { type: "session.title.updated"; sessionId: SessionId; title: string }
  | { type: "run.completed"; result: RunResult }
  | { type: "run.failed"; error: SerializedError }
  | { type: "run.aborted"; reason: string };

export interface EventEnvelope<T = SessionEvent> {
  v: 1;
  id: string;
  sessionId: SessionId;
  runId: RunId;
  seq: number;
  ts: IsoTimestamp;
  event: T;
}

export type SessionEventSink = (event: SessionEvent) => void | Promise<void>;
