/**
 * 会话管理 HTTP 路由
 *
 * 提供 RESTful 会话 CRUD 接口：
 *
 * | 方法   | 路径                      | 说明                         |
 * |--------|---------------------------|------------------------------|
 * | POST   | /api/sessions             | 创建会话                     |
 * | GET    | /api/sessions             | 会话列表（按 updatedAt 降序）|
 * | GET    | /api/sessions/:id/history | 获取会话消息历史             |
 * | DELETE | /api/sessions/:id         | 删除会话（级联删除消息）     |
 *
 * 所有请求体和路径参数使用 Zod 校验。
 * 通过 Fastify decorate("db") 获取数据库实例。
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { SessionRepository } from "../../db/repositories/sessions.js";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

/** 创建会话请求体 */
const createSessionSchema = z.object({
  title: z.string().max(200).optional().default("New Chat"),
});

/** 路径参数：会话 ID */
const sessionIdParams = z.object({
  id: z.string(),
});

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 从 Fastify 实例获取数据库连接
 *
 * db 实例由 index.ts 通过 app.decorate("db", db) 挂载。
 */
function getDb(app: FastifyInstance): BetterSQLite3Database {
  return (app as any).db;
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

/**
 * 会话管理路由插件
 *
 * @param app - Fastify 实例（作用域，prefix 已在注册时指定为 /api）
 */
const sessionRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/sessions —— 创建会话
   *
   * Request Body: { title?: string }
   * Response 201: 新创建的会话对象
   */
  app.post("/sessions", async (request, reply) => {
    const body = createSessionSchema.parse(request.body);
    const db = getDb(app);
    const repo = new SessionRepository(db);
    const session = repo.create(body.title);
    reply.status(201).send(session);
  });

  /**
   * GET /api/sessions —— 获取会话列表
   *
   * Response 200: 会话数组，按 updatedAt 降序排列
   */
  app.get("/sessions", async (_request, reply) => {
    const db = getDb(app);
    const repo = new SessionRepository(db);
    const list = repo.list();
    reply.status(200).send(list);
  });

  /**
   * GET /api/sessions/:id/history —— 获取会话消息历史
   *
   * Path Params: id (会话 UUID)
   * Response 200: 消息数组，按 createdAt 升序排列
   * Response 404: 会话不存在
   */
  app.get("/sessions/:id/history", async (request, reply) => {
    const { id } = sessionIdParams.parse(request.params);
    const db = getDb(app);
    const repo = new SessionRepository(db);

    const session = repo.getById(id);
    if (!session) {
      reply.status(404).send({
        error: "NotFound",
        message: `Session "${id}" not found`,
      });
      return;
    }

    const msgList = repo.getMessages(id);
    reply.status(200).send(msgList);
  });

  /**
   * DELETE /api/sessions/:id —— 删除会话
   *
   * Path Params: id (会话 UUID)
   * Response 204: 删除成功（含级联删除的所有消息）
   * Response 404: 会话不存在
   */
  app.delete("/sessions/:id", async (request, reply) => {
    const { id } = sessionIdParams.parse(request.params);
    const db = getDb(app);
    const repo = new SessionRepository(db);

    const session = repo.getById(id);
    if (!session) {
      reply.status(404).send({
        error: "NotFound",
        message: `Session "${id}" not found`,
      });
      return;
    }

    repo.delete(id);
    reply.status(204).send();
  });
};

export default sessionRoutes;
