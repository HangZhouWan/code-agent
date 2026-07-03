/**
 * 工具审批 HTTP 路由
 *
 * 提供工具审批的 HTTP 备用通道：
 *
 * | 方法 | 路径                           | 说明                                 |
 * |------|--------------------------------|--------------------------------------|
 * | POST | /api/tools/:callId/approve     | 工具审批（HTTP 备用通道）             |
 *
 * 当前审批主要通过 WebSocket 的 pendingApprovals map 传递，
 * HTTP 端点为备用通道（用于非 WebSocket 客户端或断线重连场景）。
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

/** 审批请求体 */
const approveBodySchema = z.object({
  approved: z.boolean(),
});

/** 路径参数 */
const approveParamsSchema = z.object({
  callId: z.string(),
});

// ---------------------------------------------------------------------------
// 共享状态引用
// ---------------------------------------------------------------------------

/**
 * 待审批项的类型
 *
 * 与 chat.ts 中 pendingApprovals Map 的值类型保持一致。
 */
export interface PendingApproval {
  resolve: (approved: boolean) => void;
  /** 关联的 WebSocket（用于清理） */
  ws: unknown;
}

/**
 * 审批存储的接口
 *
 * 由 WebSocket handler (chat.ts) 提供实际的 Map 实例。
 * 放在 Fastify decorate 中共享。
 */
export interface ApprovalStore {
  resolve(callId: string, approved: boolean): boolean;
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

/**
 * 工具审批路由插件
 *
 * @param app - Fastify 实例（作用域）
 */
const toolRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * POST /api/tools/:callId/approve —— 工具审批（HTTP 备用）
   *
   * Path Params: callId (string)
   * Request Body: { approved: boolean }
   * Response 200: { callId, approved }
   * Response 404: 审批项不存在或已过期
   */
  app.post("/tools/:callId/approve", async (request, reply) => {
    const { callId } = approveParamsSchema.parse(request.params);
    const { approved } = approveBodySchema.parse(request.body);

    // 从 Fastify decorate 获取审批存储
    const approvalStore: ApprovalStore | undefined = (app as any).approvalStore;

    if (!approvalStore) {
      reply.status(503).send({
        error: "Unavailable",
        message: "Approval store is not initialized",
      });
      return;
    }

    const resolved = approvalStore.resolve(callId, approved);

    if (!resolved) {
      reply.status(404).send({
        error: "NotFound",
        message: `Approval "${callId}" not found or already resolved`,
      });
      return;
    }

    reply.status(200).send({ callId, approved });
  });
};

export default toolRoutes;
