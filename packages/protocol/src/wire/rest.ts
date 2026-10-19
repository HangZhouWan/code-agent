/**
 * REST DTO
 */

import type { ProviderId, ProviderDefinition } from "../config/providers.js";
import type { SerializedError } from "../errors.js";
import type { AgentActivity, RunSummary, SessionSummary } from "../domain/session.js";
import type { ChatMessage } from "../domain/message.js";
import type { MemoryOp, MemoryRecord } from "../domain/memory.js";
import type {
  GitFileStatus,
  WorkspaceDiff,
  WorkspaceEntry,
  WorkspaceFile,
} from "../domain/workspace.js";

export interface ApiErrorResponse {
  error: SerializedError;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
}

export interface SessionHistoryResponse {
  session: SessionSummary;
  messages: ChatMessage[];
}

export interface CreateSessionRequest {
  title?: string;
}

export interface UpdateSessionTitleRequest {
  title: string;
}

export interface ConfigStatusResponse {
  setupRequired: boolean;
  provider?: ProviderId;
  model?: string;
}

export interface SaveConfigRequest {
  LLM_PROVIDER: ProviderId;
  LLM_MODEL: string;
  LLM_API_KEY: string;
  LLM_BASE_URL?: string;
}

export interface SaveConfigResponse {
  success: boolean;
  path?: string;
  error?: string;
}

export interface ProvidersResponse {
  providers: ProviderDefinition[];
}

export interface AgentStatusResponse {
  agents: AgentActivity[];
}

export interface RunListResponse {
  runs: RunSummary[];
}

export interface WorkspaceTreeResponse {
  path: string;
  entries: WorkspaceEntry[];
}

export interface WorkspaceFileResponse {
  file: WorkspaceFile;
}

export interface WorkspaceDiffResponse {
  diff: WorkspaceDiff;
}

export interface GitStatusResponse {
  files: GitFileStatus[];
}

export interface MemoryListResponse {
  memories: MemoryRecord[];
}

export interface MemoryOpsRequest {
  ops: MemoryOp[];
}

export interface MemoryOpsResponse {
  applied: number;
  pendingReview: number;
}
