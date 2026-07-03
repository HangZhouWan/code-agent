import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sessions, messages } from "../schema.js";

/**
 * 消息角色枚举
 */
export type MessageRole = "human" | "assistant" | "system" | "tool";

/**
 * 新消息输入（不含 id 和 createdAt，由 repository 自动生成）
 */
export interface CreateMessageInput {
  role: MessageRole;
  content: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
}

/**
 * SessionRepository —— 会话与消息数据访问层
 *
 * 封装 sessions 和 messages 两张表的所有 CRUD 操作。
 * 自动维护会话的 updatedAt 时间戳以保证列表排序准确性。
 */
export class SessionRepository {
  constructor(private db: BetterSQLite3Database) {}

  // ============================================================
  // 会话操作
  // ============================================================

  /**
   * 创建新会话
   *
   * @param title - 会话标题，默认 "New Chat"
   * @returns 新创建的会话对象
   */
  create(title: string = "New Chat") {
    const now = new Date().toISOString();
    const session = {
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(sessions).values(session).run();
    return session;
  }

  /**
   * 获取会话列表，按最近活跃时间降序排列
   */
  list() {
    return this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt))
      .all();
  }

  /**
   * 根据 ID 获取单个会话
   *
   * @returns 会话对象，不存在时返回 undefined
   */
  getById(id: string) {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .get();
  }

  /**
   * 更新会话标题
   *
   * @param id - 会话 ID
   * @param title - 新标题
   * @returns 受影响行数
   */
  updateTitle(id: string, title: string) {
    const result = this.db
      .update(sessions)
      .set({
        title,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, id))
      .run();
    return result.changes;
  }

  /**
   * 删除会话及其所有关联消息（通过 ON DELETE CASCADE）
   *
   * @param id - 会话 ID
   * @returns 受影响行数
   */
  delete(id: string) {
    const result = this.db
      .delete(sessions)
      .where(eq(sessions.id, id))
      .run();
    return result.changes;
  }

  // ============================================================
  // 消息操作
  // ============================================================

  /**
   * 获取指定会话的所有消息，按创建时间升序排列
   *
   * @param sessionId - 会话 ID
   */
  getMessages(sessionId: string) {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();
  }

  /**
   * 向会话添加一条消息
   *
   * 同时更新 sessions 表的 updatedAt 字段，
   * 确保列表按最近活跃时间排序始终准确。
   *
   * @param sessionId - 目标会话 ID
   * @param msg - 消息内容
   * @returns 新创建的消息对象
   */
  addMessage(sessionId: string, msg: CreateMessageInput) {
    const now = new Date().toISOString();

    // 插入消息
    const result = this.db
      .insert(messages)
      .values({
        sessionId,
        role: msg.role,
        content: msg.content,
        toolName: msg.toolName ?? null,
        toolArgs: msg.toolArgs ?? null,
        toolResult: msg.toolResult ?? null,
        createdAt: now,
      })
      .returning()
      .get();

    // 同步更新会话的 updatedAt
    this.db
      .update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.id, sessionId))
      .run();

    return result;
  }

  /**
   * 批量向会话添加多条消息（同一事务，共用同一个时间戳）
   *
   * @param sessionId - 目标会话 ID
   * @param msgs - 消息数组
   * @returns 新创建的消息对象数组
   */
  addMessages(sessionId: string, msgs: CreateMessageInput[]) {
    const now = new Date().toISOString();

    const results = msgs.map((msg) =>
      this.db
        .insert(messages)
        .values({
          sessionId,
          role: msg.role,
          content: msg.content,
          toolName: msg.toolName ?? null,
          toolArgs: msg.toolArgs ?? null,
          toolResult: msg.toolResult ?? null,
          createdAt: now,
        })
        .returning()
        .get(),
    );

    // 同步更新会话的 updatedAt
    this.db
      .update(sessions)
      .set({ updatedAt: now })
      .where(eq(sessions.id, sessionId))
      .run();

    return results;
  }

  /**
   * 删除指定会话的所有消息（可选清空消息而不删除会话）
   *
   * @param sessionId - 会话 ID
   * @returns 删除的消息数量
   */
  clearMessages(sessionId: string) {
    const result = this.db
      .delete(messages)
      .where(eq(messages.sessionId, sessionId))
      .run();
    return result.changes;
  }
}
