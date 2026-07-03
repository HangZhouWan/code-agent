import { eq, desc, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { MessageRole } from "./sessions.js";
import { messages } from "../schema.js";

/**
 * MessageRepository —— 消息专用查询
 *
 * 提供跨会话的消息查询能力，作为 SessionRepository 的补充。
 * SessionRepository 处理会话维度的消息操作，此 repository 处理消息维度的独立查询。
 */
export class MessageRepository {
  constructor(private db: BetterSQLite3Database) {}

  /**
   * 按角色过滤消息（支持分页）
   *
   * @param sessionId - 会话 ID
   * @param role - 消息角色
   * @param limit - 返回数量上限，默认 50
   * @param offset - 偏移量，默认 0
   */
  findByRole(sessionId: string, role: MessageRole, limit = 50, offset = 0) {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.sessionId, sessionId),
          eq(messages.role, role),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
  }

  /**
   * 获取会话的最新消息
   *
   * @param sessionId - 会话 ID
   * @param limit - 返回数量，默认 1
   */
  findLatest(sessionId: string, limit = 1) {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .all();
  }

  /**
   * 统计会话的消息数量
   *
   * @param sessionId - 会话 ID
   */
  countBySession(sessionId: string) {
    const result = this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all();
    return result.length;
  }

  /**
   * 查找包含工具调用的消息
   *
   * @param sessionId - 会话 ID
   * @param toolName - 可选，按工具名称过滤
   */
  findToolCalls(sessionId: string, toolName?: string) {
    return this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.sessionId, sessionId),
          eq(messages.role, "tool"),
          ...(toolName ? [eq(messages.toolName!, toolName)] : []),
        ),
      )
      .orderBy(messages.createdAt)
      .all();
  }
}
