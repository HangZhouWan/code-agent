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
      selectedProposalIds?: unknown;
      feedback?: unknown;
    };

    const selectedProposalIds = body.selectedProposalIds;
    const validSelection =
      selectedProposalIds === undefined ||
      (Array.isArray(selectedProposalIds) &&
        selectedProposalIds.every(
          (id): id is string => typeof id === "string" && id.length > 0,
        ));

    if (
      typeof body.sessionId !== "string" ||
      typeof body.approved !== "boolean" ||
      (body.feedback !== undefined && typeof body.feedback !== "string") ||
      !validSelection
    ) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION",
          message:
            "sessionId and approved are required; selectedProposalIds must be string[] and feedback must be a string",
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

    const resolved = session.approve(callId, {
      decision: body.approved ? "approved" : "denied",
      ...(selectedProposalIds
        ? { selectedProposalIds: selectedProposalIds as string[] }
        : {}),
      ...(typeof body.feedback === "string"
        ? { feedback: body.feedback }
        : {}),
    });
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
