/**
 * Fastify 实例工厂 —— createServer()
 *
 * 组装完整的 HTTP + WebSocket 服务：
 * - 注册 CORS 中间件
 * - 注册 WebSocket 支持
 * - 注册 RESTful 路由和 WebSocket 聊天通道
 * - 设置全局错误处理器
 *
 * 通过 AppOptions 注入外部依赖（模型、工具注册表、工作区路径），
 * 保持工厂函数的可测试性。
 */

import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ToolRegistry } from "@my-agent/core";

import { errorHandler } from "./middleware/error.js";
import sessionRoutes from "./routes/sessions.js";
import toolRoutes from "./routes/tools.js";
import { createChatWebSocket } from "./ws/chat.js";
import type { PendingApprovalItem, ApprovalStore } from "./ws/chat.js";

// ---------------------------------------------------------------------------
// 配置类型
// ---------------------------------------------------------------------------

/**
 * createServer 的配置选项
 *
 * 所有外部依赖通过此接口注入，避免工厂函数内部创建。
 */
export interface AppOptions {
  /** LLM 模型实例 */
  model: BaseChatModel;
  /** 工具注册表 */
  toolRegistry: ToolRegistry;
  /** 工作区根路径 */
  workspacePath: string;
}

// ---------------------------------------------------------------------------
// Approval Store 工厂
// ---------------------------------------------------------------------------

/**
 * 从 pendingApprovals Map 创建 ApprovalStore 适配器
 *
 * 封装 Map 操作，提供 resolve/cleanup 方法供 HTTP 路由和 WebSocket handler 使用。
 */
function createApprovalStore(
  pendingApprovals: Map<string, PendingApprovalItem>,
): ApprovalStore {
  return {
    /**
     * 解析指定 callId 的审批
     *
     * @returns true 表示找到并已解析，false 表示不存在
     */
    resolve(callId: string, approved: boolean): boolean {
      const pending = pendingApprovals.get(callId);
      if (!pending) return false;
      pendingApprovals.delete(callId);
      pending.resolve(approved);
      return true;
    },

    /**
     * 清理指定 WebSocket 的所有待审批项
     */
    cleanup(ws: unknown): void {
      for (const [callId, item] of pendingApprovals) {
        if (item.ws === ws) {
          pendingApprovals.delete(callId);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Fastify 应用实例
 *
 * 注册顺序：
 * 1. CORS（全开，开发阶段）
 * 2. WebSocket 支持
 * 3. 全局错误处理器
 * 4. RESTful 路由（sessions、tools）
 * 5. WebSocket 聊天通道
 *
 * @param options - 外部依赖配置
 * @returns 配置完成的 Fastify 实例（尚未 listen）
 *
 * @example
 * ```ts
 * const app = await createServer({ model, toolRegistry, workspacePath });
 * await app.listen({ host: "0.0.0.0", port: 3000 });
 * ```
 */
export async function createServer(options: AppOptions) {
  const { model, toolRegistry, workspacePath } = options;

  // ── 创建 Fastify 实例 ──
  const app = Fastify({ logger: true });

  // ── 共享的审批 Map ──
  const pendingApprovals = new Map<string, PendingApprovalItem>();
  const approvalStore = createApprovalStore(pendingApprovals);

  // ── 装饰共享实例 ──
  // db 实例由 index.ts 在 createServer 后通过 app.decorate("db", db) 挂载
  app.decorate("approvalStore", approvalStore);

  // ── 注册插件 ──
  // CORS 全开（开发阶段），生产需锁定 origin
  await app.register(fastifyCors, { origin: true });

  // WebSocket 支持
  await app.register(fastifyWebsocket);

  // ── 全局错误处理 ──
  app.setErrorHandler(errorHandler);

  // ── RESTful 路由 ──
  await app.register(sessionRoutes, { prefix: "/api" });
  await app.register(toolRoutes, { prefix: "/api" });

  // ── WebSocket 聊天通道 ──
  await app.register(async (scope) => {
    scope.get(
      "/api/sessions/:id/chat",
      { websocket: true },
      createChatWebSocket({
        model,
        toolRegistry,
        workspacePath,
        pendingApprovals,
      }),
    );
  });

  return app;
}
