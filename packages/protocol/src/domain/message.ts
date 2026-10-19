/**
 * 会话消息与工具调用记录
 */

import type { CallId, SessionId } from "../ids.js";
import type { IsoTimestamp, JsonValue } from "../json.js";

export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

export type ToolCallStatus = "running" | "success" | "failed" | "awaiting_approval";

export interface ToolCallRecord {
  id: CallId;
  name: string;
  args: JsonValue;
  result?: string;
  error?: string;
  status: ToolCallStatus;
  durationMs?: number;
}

export interface ChatMessage {
  id: string;
  sessionId: SessionId;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCallRecord[];
  toolCallId?: CallId;
  createdAt: IsoTimestamp;
}

/**
 * Checkpoint 使用的 JSON-safe 消息格式。
 * 与 LangChain BaseMessage 解耦，恢复时再显式重建。
 */
export interface SerializedMessage {
  role: "system" | "human" | "ai" | "tool";
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: JsonValue }>;
  toolCallId?: string;
}
