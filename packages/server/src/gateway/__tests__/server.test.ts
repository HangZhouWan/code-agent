/**
 * server.ts 工厂函数测试
 *
 * 覆盖：
 * - createServer 返回有效的 Fastify 实例
 * - CORS 已注册
 * - WebSocket 已注册
 * - RESTful 路由已注册（验证端点可达）
 * - 全局错误处理器已注册
 * - approvalStore 已挂载
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../server.js";
import type { ToolRegistry } from "@code-agent/core";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

/** 最小可用的 ToolRegistry mock */
function createMockToolRegistry(): ToolRegistry {
  const registry = {
    listAll: () => [],
    register: () => {},
    get: () => undefined,
    getToolsForAgent: () => [],
    createDefault: () => registry,
  };
  return registry as unknown as ToolRegistry;
}

/** 最小可用的 BaseChatModel mock */
function createMockModel() {
  return {
    _llmType: () => "mock",
    _call: async () => "mock response",
  } as any;
}

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

async function buildTestServer() {
  const model = createMockModel();
  const toolRegistry = createMockToolRegistry();
  const app = await createServer({
    model,
    toolRegistry,
    workspacePath: "./test-workspace",
  });
  return app;
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("createServer", () => {
  let app: Awaited<ReturnType<typeof buildTestServer>>;

  beforeAll(async () => {
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── 实例创建 ──

  it("应返回有效的 Fastify 实例", () => {
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.close).toBe("function");
  });

  it("应返回一个 FastifyInstance", () => {
    // Fastify 实例的特征方法
    expect(typeof app.inject).toBe("function");
    expect(typeof app.register).toBe("function");
    expect(typeof app.decorate).toBe("function");
  });

  // ── 错误处理器 ──

  it("应有全局错误处理器", () => {
    // Fastify 的 errorHandler 可以通过内部属性检查
    expect(app.errorHandler).toBeDefined();
    expect(typeof app.errorHandler).toBe("function");
  });

  // ── 路由注册 ──

  it("GET /api/sessions 应返回 200（而非 404）", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
    });

    // 路由存在，但因为没有 db 挂载会报错。
    // 验证路由已注册：不应返回 Fastify 默认的 404
    expect(res.statusCode).not.toBe(404);
  });

  it("POST /api/sessions 应返回非 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "test" },
    });

    // 路由已注册（可能因为没有 db 而报 500，但不应该是 404）
    expect(res.statusCode).not.toBe(404);
  });

  it("GET /api/sessions/:id/history 路由应注册", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions/test-id/history",
    });

    expect(res.statusCode).not.toBe(404);
  });

  it("DELETE /api/sessions/:id 路由应注册", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/sessions/test-id",
    });

    expect(res.statusCode).not.toBe(404);
  });

  it("POST /api/tools/:callId/approve 路由应注册", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tools/call-1/approve",
      payload: { approved: true },
    });

    // 路由已注册：会返回 JSON 响应（404 NotFound），而非 Fastify 默认的纯文本 404
    // 未注册的路由返回 HTML/text，已注册的路由返回 application/json
    expect(res.headers["content-type"]).toContain("application/json");
  });

  // ── approvalStore 挂载 ──

  it("approvalStore 应已挂载到实例", () => {
    const store = (app as any).approvalStore;
    expect(store).toBeDefined();
    expect(typeof store.resolve).toBe("function");
    expect(typeof store.cleanup).toBe("function");
  });

  it("approvalStore.resolve 对不存在的 callId 应返回 false", () => {
    const store = (app as any).approvalStore;
    expect(store.resolve("nonexistent", true)).toBe(false);
  });

  // ── WebSocket 路由 ──

  it("GET /api/sessions/:id/chat WebSocket 路由应注册", async () => {
    // WebSocket 路由通过 { websocket: true } 注册
    // 通过路由表验证：Fastify 将路由打印为树形结构，leaf node 为 "chat (GET, HEAD)"
    const routes = app.printRoutes();
    expect(routes).toContain("chat (GET, HEAD)");
  });

  // ── 健康检查 / 未定义路由 ──

  it("未注册路由应返回 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/nonexistent",
    });

    expect(res.statusCode).toBe(404);
  });

  it("根路径未注册应返回 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(res.statusCode).toBe(404);
  });

  // ── JSON 响应 Content-Type ──

  it("错误响应应包含 application/json Content-Type", async () => {
    // 触发一个 ZodError（发送无效 JSON 到一个有 body 校验的路由）
    const res = await app.inject({
      method: "POST",
      url: "/api/tools/call-1/approve",
      payload: { approved: "not-a-boolean" },
    });

    // 验证 JSON 响应
    expect(res.headers["content-type"]).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// CORS 测试
// ---------------------------------------------------------------------------

describe("createServer CORS", () => {
  it("应包含 CORS 响应头", async () => {
    const app = await buildTestServer();

    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/sessions",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
      },
    });

    // CORS 预检请求应返回 204 或 200
    expect(res.statusCode).toBe(204);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// 多次创建独立实例
// ---------------------------------------------------------------------------

describe("createServer 隔离性", () => {
  it("每次调用应返回独立实例", async () => {
    const app1 = await buildTestServer();
    const app2 = await buildTestServer();

    expect(app1).not.toBe(app2);

    // 各自的 approvalStore 应独立
    const store1 = (app1 as any).approvalStore;
    const store2 = (app2 as any).approvalStore;
    expect(store1).not.toBe(store2);

    await app1.close();
    await app2.close();
  });
});
