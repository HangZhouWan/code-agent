/**
 * Runtime 审批 fallback 路由
 */

import type { FastifyPluginAsync } from "fastify";
import { asSessionId } from "@code-agent/protocol";
import type { SessionService } from "../../session/session-service.js";

export interface RuntimeToolRoutesOptions {
  sessionService: SessionService;
}

const routes: FastifyPluginAsync<RuntimeToolRoutesOptions> = async (
  app,
  options,
) => {
  app.post("/:callId/approve", async (request, reply) => {
    const { callId } = request.params as { callId: string };
    const body = (request.body ?? {}) as {
      sessionId?: unknown;
      approved?: unknown;
    };

    if (
      typeof body.sessionId !== "string" ||
      typeof body.approved !== "boolean"
    ) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION",
          message: "sessionId and approved are required",
          retryable: false,
        },
      });
    }

    const session = options.sessionService.get(
      asSessionId(body.sessionId),
    );
    if (!session) {
      return reply.status(404).send({
        error: {
          code: "SESSION_BUSY",
          message: "Session is not active",
          retryable: false,
        },
      });
    }

    const resolved = session.approve(
      callId,
      body.approved ? "approved" : "denied",
    );
    if (!resolved) {
      return reply.status(404).send({
        error: {
          code: "APPROVAL_NOT_FOUND",
          message: "Approval not found",
          retryable: false,
        },
      });
    }
    return { success: true };
  });
};

export default routes;
