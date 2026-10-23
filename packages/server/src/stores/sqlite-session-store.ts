/**
 * SQLite SessionStore
 */

import type {
  CreateSessionRecordInput,
  SessionStore,
} from "@code-agent/runtime";
import {
  asCallId,
  type ChatMessage,
  type MessageRole,
  type SessionId,
  type SessionSummary,
  type ToolCallRecord,
} from "@code-agent/protocol";
import type { ServerDb } from "../db/server-db.js";

interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: string;
}

function toSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id as SessionId,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseToolCalls(raw: string | null): ToolCallRecord[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed as ToolCallRecord[];
  } catch {
    return undefined;
  }
}

function toMessage(row: MessageRow): ChatMessage {
  const toolCalls = parseToolCalls(row.tool_calls);
  return {
    id: row.id,
    sessionId: row.session_id as SessionId,
    role: row.role as MessageRole,
    content: row.content,
    ...(toolCalls ? { toolCalls } : {}),
    ...(row.tool_call_id
      ? { toolCallId: asCallId(row.tool_call_id) }
      : {}),
    createdAt: row.created_at,
  };
}

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: ServerDb) {}

  async create(input: CreateSessionRecordInput): Promise<SessionSummary> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO runtime_sessions
         (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.title ?? "New Chat",
        input.createdAt,
        input.createdAt,
      );
    const session = await this.get(input.id);
    if (!session) throw new Error(`Failed to create session ${input.id}`);
    return session;
  }

  async get(id: SessionId): Promise<SessionSummary | null> {
    const row = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM runtime_sessions WHERE id = ?`,
      )
      .get(id) as SessionRow | undefined;
    return row ? toSummary(row) : null;
  }

  async list(): Promise<SessionSummary[]> {
    const rows = this.db
      .prepare(
        `SELECT id, title, created_at, updated_at
         FROM runtime_sessions ORDER BY updated_at DESC`,
      )
      .all() as SessionRow[];
    return rows.map(toSummary);
  }

  async updateTitle(
    id: SessionId,
    title: string,
    updatedAt: string,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE runtime_sessions SET title = ?, updated_at = ? WHERE id = ?`,
      )
      .run(title, updatedAt, id);
  }

  async delete(id: SessionId): Promise<void> {
    this.db.prepare(`DELETE FROM runtime_sessions WHERE id = ?`).run(id);
  }

  async appendMessage(message: ChatMessage): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runtime_messages
         (id, session_id, role, content, tool_calls, tool_call_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.sessionId,
        message.role,
        message.content,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        message.toolCallId ?? null,
        message.createdAt,
      );
    this.db
      .prepare(
        `UPDATE runtime_sessions SET updated_at = ? WHERE id = ?`,
      )
      .run(message.createdAt, message.sessionId);
  }

  async listMessages(
    sessionId: SessionId,
    options: { limit?: number } = {},
  ): Promise<ChatMessage[]> {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, content, tool_calls, tool_call_id, created_at
         FROM runtime_messages WHERE session_id = ?
         ORDER BY created_at ASC`,
      )
      .all(sessionId) as MessageRow[];
    const messages = rows.map(toMessage);
    return options.limit !== undefined
      ? messages.slice(-options.limit)
      : messages;
  }
}
