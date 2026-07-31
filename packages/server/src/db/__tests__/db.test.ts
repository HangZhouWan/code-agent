/**
 * 数据库层单元测试
 *
 * 覆盖：
 * - createDb —— 连接创建、WAL 模式、外键约束
 * - SessionRepository —— 会话 CRUD
 * - MessageRepository —— 消息查询
 * - Drizzle schema 类型推断正确性
 * - 级联删除行为
 * - 自动时间戳更新
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createDb } from "../connection.js";
import { sessions, messages } from "../schema.js";
import { SessionRepository, MessageRepository } from "../repositories/index.js";

// ═════════════════════════════════════════════
// 测试辅助
// ═════════════════════════════════════════════

/** 测试数据库路径 */
function testDbPath(name: string): string {
  return join(tmpdir(), `code-agent-test-${name}-${Date.now()}.db`);
}

/** 创建测试数据库实例 */
function createTestDb(path: string) {
  const db = createDb(path);
  // 创建表结构
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_args TEXT,
      tool_result TEXT,
      created_at TEXT NOT NULL
    )
  `);
  return db;
}

// ═════════════════════════════════════════════
// createDb 测试
// ═════════════════════════════════════════════

describe("createDb", () => {
  it("应该创建 SQLite 数据库文件", () => {
    const dbPath = testDbPath("create");
    const db = createDb(dbPath);

    // 验证：表可以正常创建
    db.run(`CREATE TABLE _test (id INTEGER PRIMARY KEY)`);
    db.run(`DROP TABLE _test`);

    // 清理
    rmSync(dbPath);
  });

  it("应该启用 WAL 模式", () => {
    const dbPath = testDbPath("wal");
    const db = createDb(dbPath);

    const result = db
      .all("PRAGMA journal_mode") as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe("wal");

    rmSync(dbPath);
  });

  it("应该启用外键约束", () => {
    const dbPath = testDbPath("fk");
    const db = createDb(dbPath);

    const result = db
      .all("PRAGMA foreign_keys") as Array<{ foreign_keys: number }>;
    expect(result[0].foreign_keys).toBe(1);

    rmSync(dbPath);
  });

  it("应该自动创建数据目录", () => {
    const dbPath = join(tmpdir(), `nested-dir-${Date.now()}`, "test.db");
    const db = createDb(dbPath);

    // 验证可以正常使用
    db.run(`CREATE TABLE _t (val TEXT)`);
    db.run(`INSERT INTO _t VALUES ('hello')`);
    const row = db.all("SELECT val FROM _t") as Array<{ val: string }>;
    expect(row[0].val).toBe("hello");

    // 清理
    rmSync(join(tmpdir(), `nested-dir-${Date.now()}`), {
      recursive: true,
      force: true,
    });
  });
});

// ═════════════════════════════════════════════
// SessionRepository 测试
// ═════════════════════════════════════════════

describe("SessionRepository", () => {
  let db: ReturnType<typeof createDb>;
  let repo: SessionRepository;
  let dbPath: string;

  beforeAll(() => {
    dbPath = testDbPath("sessions");
    db = createTestDb(dbPath);
    repo = new SessionRepository(db);
  });

  afterAll(() => {
    rmSync(dbPath, { force: true });
  });

  // --- 创建会话 ---

  it("create() 应该创建会话并返回包含 id、title、createdAt 的对象", () => {
    const session = repo.create("测试会话");

    expect(session).toHaveProperty("id");
    expect(typeof session.id).toBe("string");
    expect(session.id.length).toBeGreaterThan(0);

    expect(session.title).toBe("测试会话");
    expect(session).toHaveProperty("createdAt");
    expect(session).toHaveProperty("updatedAt");

    // 验证 ISO 8601 格式
    expect(() => new Date(session.createdAt)).not.toThrow();
    expect(() => new Date(session.updatedAt)).not.toThrow();
  });

  it("create() 默认标题应为 'New Chat'", () => {
    const session = repo.create();
    expect(session.title).toBe("New Chat");
  });

  it("create() 创建的每个会话应有唯一 ID", () => {
    const s1 = repo.create();
    const s2 = repo.create();
    expect(s1.id).not.toBe(s2.id);
  });

  // --- 获取会话 ---

  it("getById() 应该按 ID 查找会话", () => {
    const session = repo.create("查找测试");
    const found = repo.getById(session.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(session.id);
    expect(found!.title).toBe("查找测试");
  });

  it("getById() 对不存在的 ID 应返回 undefined", () => {
    const found = repo.getById("non-existent-id");
    expect(found).toBeUndefined();
  });

  // --- 列表排序 ---

  it("list() 应该按 updatedAt 降序排列", async () => {
    // 按时间顺序创建多个会话
    const s1 = repo.create("最早");
    await sleep(10);
    repo.create("中间");
    await sleep(10);
    repo.create("最新");

    // 更新 s1 使其变为最新活跃
    await sleep(10);
    repo.addMessage(s1.id, { role: "human", content: "更新 s1" });

    const list = repo.list();
    expect(list.length).toBeGreaterThanOrEqual(3);

    // s1 应该排在最前面（最近被更新）
    const topIds = list.slice(0, 3).map((s) => s.id);
    expect(topIds[0]).toBe(s1.id);
  });

  // --- 更新标题 ---

  it("updateTitle() 应该更新标题并刷新 updatedAt", async () => {
    const session = repo.create("旧标题");
    const originalUpdatedAt = session.updatedAt;

    // 稍等确保时间戳不同
    await sleep(1);
    const result = repo.updateTitle(session.id, "新标题");
    expect(result).toBe(1);

    const updated = repo.getById(session.id);
    expect(updated!.title).toBe("新标题");
    expect(new Date(updated!.updatedAt).getTime())
      .toBeGreaterThan(new Date(originalUpdatedAt).getTime());
  });

  it("updateTitle() 对不存在的 ID 应返回 0", () => {
    const result = repo.updateTitle("no-such-id", "x");
    expect(result).toBe(0);
  });

  // --- 删除（级联）---

  it("delete() 应该删除会话", () => {
    const session = repo.create("待删除");
    repo.delete(session.id);

    expect(repo.getById(session.id)).toBeUndefined();
  });

  it("delete() 应该级联删除关联的消息", () => {
    const session = repo.create("级联测试");
    repo.addMessage(session.id, { role: "human", content: "消息1" });
    repo.addMessage(session.id, { role: "assistant", content: "回复1" });

    // 确认消息存在
    expect(repo.getMessages(session.id).length).toBe(2);

    // 删除会话
    repo.delete(session.id);

    // 会话和消息都应被删除
    expect(repo.getById(session.id)).toBeUndefined();
    expect(repo.getMessages(session.id).length).toBe(0);
  });

  it("delete() 对不存在的 ID 应返回 0", () => {
    const result = repo.delete("no-such-id");
    expect(result).toBe(0);
  });

  // --- 添加消息 ---

  it("addMessage() 应该插入消息并返回完整对象", () => {
    const session = repo.create("消息测试");
    const msg = repo.addMessage(session.id, {
      role: "human",
      content: "你好",
    });

    expect(msg).toHaveProperty("id");
    expect(typeof msg.id).toBe("number");
    expect(msg.sessionId).toBe(session.id);
    expect(msg.role).toBe("human");
    expect(msg.content).toBe("你好");
    expect(msg).toHaveProperty("createdAt");
  });

  it("addMessage() 应该同时更新会话的 updatedAt", async () => {
    const session = repo.create("时间戳测试");
    const originalUpdatedAt = session.updatedAt;

    await sleep(1);
    repo.addMessage(session.id, { role: "human", content: "触发更新" });

    const refreshed = repo.getById(session.id);
    expect(new Date(refreshed!.updatedAt).getTime())
      .toBeGreaterThan(new Date(originalUpdatedAt).getTime());
  });

  it("addMessage() 应支持 tool 角色的消息（含工具参数和结果）", () => {
    const session = repo.create("工具测试");
    const msg = repo.addMessage(session.id, {
      role: "tool",
      content: "工具调用结果",
      toolName: "read_file",
      toolArgs: JSON.stringify({ path: "/test.txt" }),
      toolResult: JSON.stringify({ content: "hello" }),
    });

    expect(msg.role).toBe("tool");
    expect(msg.toolName).toBe("read_file");
    expect(msg.toolArgs).toBe('{"path":"/test.txt"}');
    expect(msg.toolResult).toBe('{"content":"hello"}');
  });

  // --- 获取消息 ---

  it("getMessages() 应该按 createdAt 升序排列", () => {
    const session = repo.create("排序测试");

    repo.addMessage(session.id, { role: "human", content: "第一条" });
    repo.addMessage(session.id, { role: "assistant", content: "第二条" });
    repo.addMessage(session.id, { role: "human", content: "第三条" });

    const msgs = repo.getMessages(session.id);
    expect(msgs.length).toBe(3);
    expect(msgs[0].content).toBe("第一条");
    expect(msgs[1].content).toBe("第二条");
    expect(msgs[2].content).toBe("第三条");

    // 验证时间戳递增
    const t0 = new Date(msgs[0].createdAt).getTime();
    const t1 = new Date(msgs[1].createdAt).getTime();
    const t2 = new Date(msgs[2].createdAt).getTime();
    expect(t0).toBeLessThanOrEqual(t1);
    expect(t1).toBeLessThanOrEqual(t2);
  });

  // --- 批量添加消息 ---

  it("addMessages() 应该批量插入消息", () => {
    const session = repo.create("批量测试");

    const msgs = repo.addMessages(session.id, [
      { role: "human", content: "问题1" },
      { role: "assistant", content: "回答1" },
      { role: "human", content: "问题2" },
      { role: "assistant", content: "回答2" },
    ]);

    expect(msgs.length).toBe(4);
    expect(msgs[0].id).toBeLessThan(msgs[1].id); // 自增 ID 递增

    const all = repo.getMessages(session.id);
    expect(all.length).toBe(4);
  });

  // --- 清空消息 ---

  it("clearMessages() 应该删除会话的所有消息", () => {
    const session = repo.create("清空测试");
    repo.addMessage(session.id, { role: "human", content: "msg1" });
    repo.addMessage(session.id, { role: "assistant", content: "msg2" });

    expect(repo.getMessages(session.id).length).toBe(2);

    const deleted = repo.clearMessages(session.id);
    expect(deleted).toBe(2);
    expect(repo.getMessages(session.id).length).toBe(0);
  });
});

// ═════════════════════════════════════════════
// MessageRepository 测试
// ═════════════════════════════════════════════

describe("MessageRepository", () => {
  let db: ReturnType<typeof createDb>;
  let sessionRepo: SessionRepository;
  let msgRepo: MessageRepository;
  let dbPath: string;
  let sessionId: string;

  beforeAll(async () => {
    dbPath = testDbPath("messages");
    db = createTestDb(dbPath);
    sessionRepo = new SessionRepository(db);
    msgRepo = new MessageRepository(db);

    // 准备测试数据（使用 sleep 确保时间戳有序）
    const session = sessionRepo.create("消息仓库测试");
    sessionId = session.id;

    await sleep(2);
    sessionRepo.addMessage(sessionId, { role: "human", content: "你好" });
    await sleep(2);
    sessionRepo.addMessage(sessionId, {
      role: "tool",
      content: "文件读取结果",
      toolName: "read_file",
      toolArgs: JSON.stringify({ path: "/a.txt" }),
      toolResult: JSON.stringify({ content: "file content" }),
    });
    await sleep(2);
    sessionRepo.addMessage(sessionId, { role: "assistant", content: "收到" });
    await sleep(2);
    sessionRepo.addMessage(sessionId, { role: "human", content: "继续" });
    await sleep(2);
    sessionRepo.addMessage(sessionId, {
      role: "tool",
      content: "搜索完成",
      toolName: "grep",
      toolArgs: JSON.stringify({ pattern: "fn" }),
    });
  });

  afterAll(() => {
    rmSync(dbPath, { force: true });
  });

  it("findByRole() 应该按角色过滤消息", () => {
    const humanMsgs = msgRepo.findByRole(sessionId, "human");
    expect(humanMsgs.length).toBe(2);
    expect(humanMsgs.every((m) => m.role === "human")).toBe(true);
  });

  it("findLatest() 应该返回最新消息", () => {
    const latest = msgRepo.findLatest(sessionId, 2);
    expect(latest.length).toBe(2);
    // 最新在前
    expect(latest[0].content).toBe("搜索完成");
  });

  it("countBySession() 应该返回消息总数", () => {
    const count = msgRepo.countBySession(sessionId);
    expect(count).toBe(5);
  });

  it("findToolCalls() 应该返回工具调用消息", () => {
    const tools = msgRepo.findToolCalls(sessionId);
    expect(tools.length).toBe(2);
    expect(tools.every((m) => m.role === "tool")).toBe(true);
  });

  it("findToolCalls() 应该按工具名称过滤", () => {
    const readFiles = msgRepo.findToolCalls(sessionId, "read_file");
    expect(readFiles.length).toBe(1);
    expect(readFiles[0].toolName).toBe("read_file");
  });
});

// ═════════════════════════════════════════════
// 并发写入测试（WAL 模式验证）
// ═════════════════════════════════════════════

describe("并发写入（WAL 模式）", () => {
  it("并发写入不应报错", async () => {
    const dbPath = testDbPath("concurrent");
    const db = createTestDb(dbPath);
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_args TEXT,
        tool_result TEXT,
        created_at TEXT NOT NULL
      )
    `);

    const repo = new SessionRepository(db);
    const session = repo.create("并发测试");

    // 并发插入 10 条消息
    const promises = Array.from({ length: 10 }, (_, i) => {
      return new Promise<void>((resolve) => {
        repo.addMessage(session.id, {
          role: "human",
          content: `并发消息 ${i}`,
        });
        resolve();
      });
    });

    await Promise.all(promises);

    const msgs = repo.getMessages(session.id);
    expect(msgs.length).toBe(10);

    rmSync(dbPath, { force: true });
  });
});

// ═════════════════════════════════════════════
// Schema 类型推断测试
// ═════════════════════════════════════════════

describe("Schema 类型推断", () => {
  it("sessions 表的 drizzle 查询应能通过类型检查", () => {
    const dbPath = testDbPath("types");
    const db = createTestDb(dbPath);
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_args TEXT,
        tool_result TEXT,
        created_at TEXT NOT NULL
      )
    `);

    const db2 = drizzle(new Database(dbPath));

    // 验证 Select 查询可用
    const all = db2.select().from(sessions).all();
    expect(Array.isArray(all)).toBe(true);

    // 验证 Insert 可用
    const now = new Date().toISOString();
    const result = db2
      .insert(sessions)
      .values({ id: "test-1", title: "T", createdAt: now, updatedAt: now })
      .returning()
      .get();
    expect(result.id).toBe("test-1");

    // 验证消息插入带外键
    const msgResult = db2
      .insert(messages)
      .values({
        sessionId: "test-1",
        role: "human",
        content: "hello",
        createdAt: now,
      })
      .returning()
      .get();
    expect(msgResult.sessionId).toBe("test-1");

    rmSync(dbPath, { force: true });
  });
});

// ═════════════════════════════════════════════
// 辅助
// ═════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
