/**
 * 会话、运行与快照
 */

import type { RunId, SessionId, TaskId } from "../ids.js";
import type { IsoTimestamp } from "../json.js";
import type { SerializedError } from "../errors.js";
import type { ChatMessage } from "./message.js";
import type { TaskRecord, TaskResult } from "./task.js";
import type { AgentRoleId } from "./role.js";

export const RUN_STATUSES = [
  "running",
  "awaiting_approval",
  "awaiting_input",
  "completed",
  "failed",
  "aborted",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface SessionSummary {
  id: SessionId;
  title: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface RunSummary {
  id: RunId;
  sessionId: SessionId;
  status: RunStatus;
  node?: string;
  startedAt: IsoTimestamp;
  finishedAt?: IsoTimestamp;
}

export interface AgentActivity {
  roleId: AgentRoleId;
  activeTaskIds: TaskId[];
}

export interface SessionSnapshot {
  session: SessionSummary;
  activeRun?: RunSummary;
  tasks: TaskRecord[];
  messages: ChatMessage[];
  agents: AgentActivity[];
}

export interface UserTurnInput {
  content: string;
  attachments?: Array<{ path?: string; content?: string }>;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface RunResult {
  runId: RunId;
  sessionId: SessionId;
  status: "completed" | "failed" | "aborted";
  finalResponse?: string;
  taskResults: TaskResult[];
  error?: SerializedError;
  usage?: RunUsage;
}
