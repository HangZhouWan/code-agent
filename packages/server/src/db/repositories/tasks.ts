import { randomUUID } from "node:crypto";
import { eq, desc, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { tasks } from "../schema.js";

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 任务状态枚举 */
export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

/** 创建任务输入 */
export interface CreateTaskInput {
  sessionId: string;
  role: string;
  description: string;
  parentTaskId?: string;
  plan?: string;
}

/** 任务记录（数据库行映射） */
export interface TaskRecord {
  id: string;
  sessionId: string;
  status: TaskStatus;
  role: string;
  parentTaskId: string | null;
  description: string;
  plan: string | null;
  result: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

// ─────────────────────────────────────────────
// TaskRepository
// ─────────────────────────────────────────────

/**
 * TaskRepository —— 多 Agent 任务数据访问层
 *
 * 封装 tasks 表的 CRUD 操作，管理 SubTask 的完整生命周期。
 */
export class TaskRepository {
  constructor(private db: BetterSQLite3Database) {}

  // ============================================================
  // 创建
  // ============================================================

  /**
   * 创建新任务
   *
   * @param input - 任务输入参数
   * @returns 新创建的任务记录
   */
  create(input: CreateTaskInput): TaskRecord {
    const now = new Date();
    const record: TaskRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      status: "pending",
      role: input.role,
      parentTaskId: input.parentTaskId ?? null,
      description: input.description,
      plan: input.plan ?? null,
      result: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };

    this.db.insert(tasks).values(record).run();
    return record;
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 根据 ID 获取任务
   *
   * @returns 任务记录，不存在时返回 undefined
   */
  getById(id: string): TaskRecord | undefined {
    return this.db.select().from(tasks).where(eq(tasks.id, id)).get() as
      | TaskRecord
      | undefined;
  }

  /**
   * 获取指定会话的所有任务，按创建时间降序排列
   */
  getBySession(sessionId: string): TaskRecord[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.sessionId, sessionId))
      .orderBy(desc(tasks.createdAt))
      .all() as TaskRecord[];
  }

  /**
   * 获取指定会话中特定状态的任务
   */
  getBySessionAndStatus(
    sessionId: string,
    status: TaskStatus,
  ): TaskRecord[] {
    return this.db
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.sessionId, sessionId), eq(tasks.status, status)),
      )
      .orderBy(desc(tasks.createdAt))
      .all() as TaskRecord[];
  }

  /**
   * 获取指定父任务的所有子任务
   */
  getByParent(parentTaskId: string): TaskRecord[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.parentTaskId, parentTaskId))
      .orderBy(tasks.createdAt)
      .all() as TaskRecord[];
  }

  // ============================================================
  // 更新
  // ============================================================

  /**
   * 更新任务状态
   *
   * 自动维护 startedAt（首次 running）和 completedAt（终态）时间戳。
   *
   * @param id - 任务 ID
   * @param status - 新状态
   */
  updateStatus(id: string, status: TaskStatus): void {
    const now = new Date();
    const updates: Record<string, unknown> = {
      status,
      updatedAt: now,
    };

    if (status === "running") {
      // 仅在首次进入 running 时设置 startedAt
      const existing = this.getById(id);
      if (existing && !existing.startedAt) {
        updates.startedAt = now;
      }
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.completedAt = now;
    }

    this.db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
  }

  /**
   * 更新任务结果
   *
   * @param id - 任务 ID
   * @param result - 结果 JSON 字符串
   * @param status - 可选同时更新状态
   */
  updateResult(id: string, result: string, status?: TaskStatus): void {
    const updates: Record<string, unknown> = {
      result,
      updatedAt: new Date(),
    };

    if (status) {
      updates.status = status;
      if (status === "completed" || status === "failed") {
        updates.completedAt = new Date();
      }
    }

    this.db.update(tasks).set(updates).where(eq(tasks.id, id)).run();
  }

  /**
   * 更新任务计划
   *
   * @param id - 任务 ID
   * @param plan - 计划 JSON 字符串
   */
  updatePlan(id: string, plan: string): void {
    this.db
      .update(tasks)
      .set({ plan, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .run();
  }

  // ============================================================
  // 删除
  // ============================================================

  /**
   * 删除任务及其关联产物（通过 ON DELETE CASCADE）
   *
   * @returns 删除数量
   */
  delete(id: string): number {
    return this.db.delete(tasks).where(eq(tasks.id, id)).run().changes;
  }

  /**
   * 删除指定会话的所有任务
   *
   * @returns 删除数量
   */
  deleteBySession(sessionId: string): number {
    return this.db
      .delete(tasks)
      .where(eq(tasks.sessionId, sessionId))
      .run().changes;
  }
}
