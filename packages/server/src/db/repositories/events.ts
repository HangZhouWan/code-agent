import { randomUUID } from "node:crypto";
import { eq, desc, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { events } from "../schema.js";

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 事件输入 */
export interface EventInput {
  topic: string;
  payload: string; // JSON string
  senderId: string;
  sessionId: string;
  correlationId?: string;
  taskId?: string;
}

/** 事件记录（数据库行映射） */
export interface EventRecord {
  id: string;
  topic: string;
  payload: string;
  correlationId: string | null;
  taskId: string | null;
  senderId: string;
  sessionId: string;
  timestamp: Date;
}

// ─────────────────────────────────────────────
// EventRepository
// ─────────────────────────────────────────────

/**
 * EventRepository —— 多 Agent 事件审计数据访问层
 *
 * 封装 events 表的写入和查询，用于审计和回溯 Agent 间通信历史。
 * 可选功能：不存储事件不会影响核心系统运行。
 */
export class EventRepository {
  constructor(private db: BetterSQLite3Database) {}

  // ============================================================
  // 存储
  // ============================================================

  /**
   * 存储一条事件
   *
   * @param input - 事件数据
   * @returns 新创建的事件记录
   */
  store(input: EventInput): EventRecord {
    const record: EventRecord = {
      id: randomUUID(),
      topic: input.topic,
      payload: input.payload,
      correlationId: input.correlationId ?? null,
      taskId: input.taskId ?? null,
      senderId: input.senderId,
      sessionId: input.sessionId,
      timestamp: new Date(),
    };

    this.db.insert(events).values(record).run();
    return record;
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 获取指定会话的所有事件，按时间降序排列
   */
  getBySession(sessionId: string): EventRecord[] {
    return this.db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(desc(events.timestamp))
      .all() as EventRecord[];
  }

  /**
   * 获取指定任务的所有事件，按时间升序排列
   */
  getByTask(taskId: string): EventRecord[] {
    return this.db
      .select()
      .from(events)
      .where(eq(events.taskId, taskId))
      .orderBy(events.timestamp)
      .all() as EventRecord[];
  }

  /**
   * 获取指定会话中特定主题的事件
   */
  getBySessionAndTopic(
    sessionId: string,
    topic: string,
  ): EventRecord[] {
    return this.db
      .select()
      .from(events)
      .where(
        and(eq(events.sessionId, sessionId), eq(events.topic, topic)),
      )
      .orderBy(desc(events.timestamp))
      .all() as EventRecord[];
  }

  /**
   * 按 correlationId 查找关联事件
   *
   * 用于追踪完整的请求-响应链路。
   */
  getByCorrelation(correlationId: string): EventRecord[] {
    return this.db
      .select()
      .from(events)
      .where(eq(events.correlationId, correlationId))
      .orderBy(events.timestamp)
      .all() as EventRecord[];
  }

  // ============================================================
  // 删除
  // ============================================================

  /**
   * 删除指定会话的所有事件
   *
   * @returns 删除数量
   */
  deleteBySession(sessionId: string): number {
    return this.db
      .delete(events)
      .where(eq(events.sessionId, sessionId))
      .run().changes;
  }
}
