import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { artifacts } from "../schema.js";

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

/** 产物类型 */
export type ArtifactType = "file_change" | "commit" | "test_result";

/** 文件变更输入 */
export interface FileChangeInput {
  taskId: string;
  sessionId: string;
  /** 文件路径 */
  path: string;
  /** 操作类型 */
  action: "created" | "modified" | "deleted";
  /** 执行操作的 Agent 角色 */
  agentRole: string;
}

/** Commit 输入 */
export interface CommitInput {
  taskId: string;
  sessionId: string;
  /** Commit hash */
  hash: string;
  /** Commit message */
  message: string;
  /** 变更文件列表 */
  files: string[];
}

/** 测试结果输入 */
export interface TestResultInput {
  taskId: string;
  sessionId: string;
  /** 测试总数 */
  total: number;
  /** 通过数 */
  passed: number;
  /** 失败数 */
  failed: number;
  /** 测试输出 */
  output?: string;
}

/** 产物记录（数据库行映射） */
export interface ArtifactRecord {
  id: string;
  taskId: string;
  sessionId: string;
  type: ArtifactType;
  data: string; // JSON string
  createdAt: Date;
}

// ─────────────────────────────────────────────
// ArtifactRepository
// ─────────────────────────────────────────────

/**
 * ArtifactRepository —— 多 Agent 产物数据访问层
 *
 * 封装 artifacts 表的追加操作和查询，纯追加模式。
 */
export class ArtifactRepository {
  constructor(private db: BetterSQLite3Database) {}

  // ============================================================
  // 追加
  // ============================================================

  /**
   * 追加文件变更记录
   */
  addFileChange(input: FileChangeInput): void {
    const record = {
      id: randomUUID(),
      taskId: input.taskId,
      sessionId: input.sessionId,
      type: "file_change" as ArtifactType,
      data: JSON.stringify({
        path: input.path,
        action: input.action,
        agentRole: input.agentRole,
        timestamp: new Date().toISOString(),
      }),
      createdAt: new Date(),
    };

    this.db.insert(artifacts).values(record).run();
  }

  /**
   * 追加 Commit 记录
   */
  addCommit(input: CommitInput): void {
    const record = {
      id: randomUUID(),
      taskId: input.taskId,
      sessionId: input.sessionId,
      type: "commit" as ArtifactType,
      data: JSON.stringify({
        hash: input.hash,
        message: input.message,
        files: input.files,
        timestamp: new Date().toISOString(),
      }),
      createdAt: new Date(),
    };

    this.db.insert(artifacts).values(record).run();
  }

  /**
   * 追加测试结果记录
   */
  addTestResult(input: TestResultInput): void {
    const record = {
      id: randomUUID(),
      taskId: input.taskId,
      sessionId: input.sessionId,
      type: "test_result" as ArtifactType,
      data: JSON.stringify({
        total: input.total,
        passed: input.passed,
        failed: input.failed,
        output: input.output ?? null,
        timestamp: new Date().toISOString(),
      }),
      createdAt: new Date(),
    };

    this.db.insert(artifacts).values(record).run();
  }

  // ============================================================
  // 查询
  // ============================================================

  /**
   * 获取指定任务的所有产物，按创建时间升序排列
   */
  getByTask(taskId: string): ArtifactRecord[] {
    return this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.taskId, taskId))
      .orderBy(artifacts.createdAt)
      .all() as ArtifactRecord[];
  }

  /**
   * 获取指定会话的所有产物，按创建时间降序排列
   */
  getBySession(sessionId: string): ArtifactRecord[] {
    return this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId))
      .orderBy(desc(artifacts.createdAt))
      .all() as ArtifactRecord[];
  }

  /**
   * 获取指定任务、指定类型的产物
   */
  getByTaskAndType(
    taskId: string,
    type: ArtifactType,
  ): ArtifactRecord[] {
    return this.db
      .select()
      .from(artifacts)
      .where(
        // drizzle-orm 多条件使用 and()
        eq(artifacts.taskId, taskId),
      )
      .orderBy(artifacts.createdAt)
      .all()
      .filter((r) => r.type === type) as ArtifactRecord[];
  }

  // ============================================================
  // 删除
  // ============================================================

  /**
   * 删除指定任务的所有产物
   *
   * @returns 删除数量
   */
  deleteByTask(taskId: string): number {
    return this.db
      .delete(artifacts)
      .where(eq(artifacts.taskId, taskId))
      .run().changes;
  }
}
