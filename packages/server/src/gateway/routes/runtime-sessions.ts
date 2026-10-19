/**
 * Runtime 会话路由
 */

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { asSessionId } from "@code-agent/protocol";
import type { SessionStore } from "@code-agent/runtime";
import type {
  SessionHistoryResponse,
  SessionListResponse,
} from "@code-agent/protocol";
import type { SessionService } from "../../session/session-service.js";

export interface RuntimeSessionRoutesOptions {
  sessions: SessionStore;
  sessionService: SessionService;
}

function notFound(reply: FastifyReply, message: string) {
  return reply.status(404).send({
    error: { code: "VALIDATION", message, retryable: false },
  });
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    error: { code: "VALIDATION", message, retryable: false },
  });
}

const routes: FastifyPluginAsync<RuntimeSessionRoutesOptions> = async (
  app,
  options,
) => {
  app.get("/", async () => {
    const response: SessionListResponse = {
      sessions: await options.sessions.list(),
    };
    return response;
  });

  app.post("/", async (request, reply) => {
    const body = (request.body ?? {}) as { title?: unknown };
    if (body.title !== undefined && typeof body.title !== "string") {
      return badRequest(reply, "title must be a string");
    }

    const sessionId = asSessionId(randomUUID());
    await options.sessionService.getOrCreate(
      sessionId,
      typeof body.title === "string" ? body.title : undefined,
    );
    const session = await options.sessions.get(sessionId);
    if (!session) return badRequest(reply, "failed to create session");
    return reply.status(201).send(session);
  });

  app.get("/:id/history", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessionId = asSessionId(id);
    const session = await options.sessions.get(sessionId);
    if (!session) return notFound(reply, `Session not found: ${id}`);

    const response: SessionHistoryResponse = {
      session,
      messages: await options.sessions.listMessages(sessionId),
    };
    return response;
  });

  app.patch("/:id/title", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { title?: unknown };
    if (typeof body.title !== "string" || body.title.trim() === "") {
      return badRequest(reply, "title must be a non-empty string");
    }

    const sessionId = asSessionId(id);
    const session = await options.sessions.get(sessionId);
    if (!session) return notFound(reply, `Session not found: ${id}`);

    await options.sessions.updateTitle(
      sessionId,
      body.title.trim(),
      new Date().toISOString(),
    );
    return options.sessions.get(sessionId);
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const sessionId = asSessionId(id);
    await options.sessionService.disposeSession(sessionId);
    await options.sessions.delete(sessionId);
    return { success: true };
  });
};

export default routes;
