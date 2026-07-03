/**
 * tools.ts 路由测试
 *
 * 覆盖：
 * - POST /api/tools/:callId/approve —— 正常审批、拒绝审批
 * - 审批项不存在 → 404
 * - approvalStore 未初始化 → 503
 * - 请求体 Zod 校验（缺少 approved、无效类型）
 */

import { describe, it, expect, afterAll } from "vitest";
import Fastify from "fastify";
import type { ApprovalStore } from "../../ws/chat.js";
import { errorHandler } from "../../middleware/error.js";
import toolRoutes from "../tools.js";

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

/** 模拟 ApprovalStore（支持预填充待审批项） */
function createMockApprovalStore(
  prefill: Array<{ callId: string }> = [],
): { store: ApprovalStore; resolved: Map<string, boolean> } {
  const pending = new Map<string, { resolve: (approved: boolean) => void; ws: unknown }>();
  const resolved = new Map<string, boolean>();

  // 预填充
  for (const item of prefill) {
    pending.set(item.callId, {
      resolve: (approved: boolean) => {
        resolved.set(item.callId, approved);
      },
      ws: {},
    });
  }

  const store: ApprovalStore = {
    resolve(callId: string, approved: boolean): boolean {
      const item = pending.get(callId);
      if (!item) return false;
      pending.delete(callId);
      resolved.set(callId, approved);
      item.resolve(approved);
      return true;
    },
    cleanup(_ws: unknown): void {
      // noop for test
    },
  };

  return { store, resolved };
}

async function buildTestApp(approvalStore?: ApprovalStore) {
  const app = Fastify({ logger: false });

  if (approvalStore) {
    app.decorate("approvalStore", approvalStore);
  }

  app.setErrorHandler(errorHandler);
  await app.register(toolRoutes, { prefix: "/api" });

  return app;
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("Tools Routes", () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  afterAll(async () => {
    if (app) await app.close();
  });

  // ── 正常审批 ──

  describe("POST /api/tools/:callId/approve", () => {
    it("审批成功时应返回 200", async () => {
      const { store } = createMockApprovalStore([{ callId: "call-123" }]);
      app = await buildTestApp(store);

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/call-123/approve",
        payload: { approved: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ callId: "call-123", approved: true });
    });

    it("拒绝审批时也应返回 200", async () => {
      const { store } = createMockApprovalStore([{ callId: "call-456" }]);
      app = await buildTestApp(store);

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/call-456/approve",
        payload: { approved: false },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ callId: "call-456", approved: false });
    });

    it("审批应 resolve 正确的值", async () => {
      const { store, resolved } = createMockApprovalStore([
        { callId: "call-resolve" },
      ]);
      app = await buildTestApp(store);

      await app.inject({
        method: "POST",
        url: "/api/tools/call-resolve/approve",
        payload: { approved: true },
      });

      expect(resolved.get("call-resolve")).toBe(true);
    });

    // ── 审批项不存在 ──

    it("审批项不存在时应返回 404", async () => {
      const { store } = createMockApprovalStore();
      app = await buildTestApp(store);

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/nonexistent/approve",
        payload: { approved: true },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("NotFound");
    });

    // ── approvalStore 未初始化 ──

    it("approvalStore 未初始化时应返回 503", async () => {
      const noStoreApp = await buildTestApp(undefined);

      const res = await noStoreApp.inject({
        method: "POST",
        url: "/api/tools/any-call/approve",
        payload: { approved: true },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe("Unavailable");
      await noStoreApp.close();
    });

    // ── Zod 校验 ──

    it("缺少 approved 字段时应返回 400", async () => {
      const { store } = createMockApprovalStore();
      app = await buildTestApp(store);

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/call-789/approve",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("ValidationError");
    });

    it("approved 为字符串时应返回 400", async () => {
      const { store } = createMockApprovalStore();
      app = await buildTestApp(store);

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/call-789/approve",
        payload: { approved: "yes" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("ValidationError");
    });

    it("Zod 校验错误响应应包含 details", async () => {
      const { store } = createMockApprovalStore();
      app = await buildTestApp(store);

      const res = await app.inject({
        method: "POST",
        url: "/api/tools/call-1/approve",
        payload: { approved: 123 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().details).toBeDefined();
    });
  });
});
