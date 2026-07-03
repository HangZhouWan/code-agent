/**
 * sessions.ts 路由测试
 *
 * 覆盖：
 * - POST /api/sessions —— 创建会话（默认标题、自定义标题）
 * - GET /api/sessions —— 列表查询（按 updatedAt 降序）
 * - GET /api/sessions/:id/history —— 消息历史
 * - DELETE /api/sessions/:id —— 删除（含 404）
 * - 请求体 Zod 校验（无效 title 类型）
 * - 404 响应格式
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sessions, messages } from "../../../db/schema.js";
import { errorHandler } from "../../middleware/error.js";
import sessionRoutes from "../sessions.js";

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

/**
 * 构建测试用的 Fastify 实例
 * - 使用内存 SQLite（:memory:）
 * - 自动创建 sessions 和 messages 表
 * - 注册 sessionRoutes
 */
async function buildTestApp() {
  const app = Fastify({ logger: false });

  // 内存数据库
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);

  // 建表
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

  app.decorate("db", db);
  app.setErrorHandler(errorHandler);
  await app.register(sessionRoutes, { prefix: "/api" });

  return app;
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("Sessions Routes", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /api/sessions ──

  describe("POST /api/sessions", () => {
    it("应返回 201 和新创建的会话", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: "测试会话" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty("id");
      expect(typeof body.id).toBe("string");
      expect(body.title).toBe("测试会话");
      expect(body).toHaveProperty("createdAt");
      expect(body).toHaveProperty("updatedAt");
    });

    it("不传 title 时默认应为 'New Chat'", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().title).toBe("New Chat");
    });

    it("空 body 时默认标题应为 'New Chat'", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().title).toBe("New Chat");
    });

    it("每次创建应有唯一 ID", async () => {
      const res1 = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });
      const res2 = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });

      expect(res1.json().id).not.toBe(res2.json().id);
    });

    it("title 超过 200 字符应返回 400", async () => {
      const longTitle = "x".repeat(201);
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: longTitle },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("ValidationError");
    });

    it("title 为数字类型应返回 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: 123 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("ValidationError");
    });
  });

  // ── GET /api/sessions ──

  describe("GET /api/sessions", () => {
    it("应返回会话列表（数组）", async () => {
      // 先创建几个会话
      await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: "会话A" },
      });
      await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: "会话B" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions",
      });

      expect(res.statusCode).toBe(200);
      const list = res.json();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(2);
    });

    it("空列表应返回空数组", async () => {
      // 创建全新的 app（无数据）
      const emptyApp = await buildTestApp();
      const res = await emptyApp.inject({
        method: "GET",
        url: "/api/sessions",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await emptyApp.close();
    });

    it("每个元素应包含 id、title、createdAt、updatedAt", async () => {
      await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: "测试" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/sessions",
      });

      const list = res.json();
      const item = list[0];
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("createdAt");
      expect(item).toHaveProperty("updatedAt");
    });
  });

  // ── GET /api/sessions/:id/history ──

  describe("GET /api/sessions/:id/history", () => {
    it("应返回会话的消息历史", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: "历史测试" },
      });
      const session = createRes.json();

      const res = await app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/history`,
      });

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    });

    it("新会话应返回空消息数组", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: {},
      });
      const session = createRes.json();

      const res = await app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/history`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("不存在的会话应返回 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/sessions/non-existent-id/history",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("NotFound");
    });
  });

  // ── DELETE /api/sessions/:id ──

  describe("DELETE /api/sessions/:id", () => {
    it("应返回 204 并删除会话", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { title: "待删除" },
      });
      const session = createRes.json();

      const res = await app.inject({
        method: "DELETE",
        url: `/api/sessions/${session.id}`,
      });

      expect(res.statusCode).toBe(204);

      // 验证已删除
      const getRes = await app.inject({
        method: "GET",
        url: `/api/sessions/${session.id}/history`,
      });
      expect(getRes.statusCode).toBe(404);
    });

    it("不存在的会话应返回 404", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/sessions/non-existent-id",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("NotFound");
    });
  });

  // ── 路由不存在 ──

  describe("未注册的路由", () => {
    it("PUT /api/sessions/:id 应返回 404", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/api/sessions/some-id",
        payload: { title: "updated" },
      });

      // Fastify 对未注册路由返回 404
      expect(res.statusCode).toBe(404);
    });
  });
});
