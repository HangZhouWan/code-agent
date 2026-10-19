/**
 * 审批与用户提问
 */

import type {
  AgentRunId,
  CallId,
  QuestionId,
  RunId,
  SessionId,
  TaskId,
} from "../ids.js";
import type { IsoTimestamp, JsonValue } from "../json.js";

export type ApprovalDecision = "approved" | "denied";

export interface ApprovalRequest {
  callId: CallId;
  sessionId: SessionId;
  runId: RunId;
  taskId: TaskId;
  agentRunId?: AgentRunId;
  toolName: string;
  args: JsonValue;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  reason?: string;
}

export interface UserQuestion {
  questionId: QuestionId;
  sessionId: SessionId;
  runId: RunId;
  taskId: TaskId;
  question: string;
  options?: string[];
  allowFreeText: boolean;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

export interface UserAnswer {
  questionId: QuestionId;
  answer: string;
}
