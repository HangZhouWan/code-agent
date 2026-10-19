/**
 * 长期记忆管理 API
 */

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  asMemoryId,
  type MemoryKind,
  type MemoryListResponse,
  type MemoryScope,
  type MemoryStatus,
} from "@code-agent/protocol";
import type { MemoryService } from "@code-agent/runtime";

export interface RuntimeMemoryRoutesOptions {
  memory: MemoryService;
}

const SCOPES: MemoryScope[] = ["workspace", "user"];
const STATUSES: MemoryStatus[] = ["active", "pending_review", "archived"];
const KINDS: MemoryKind[] = [
  "convention",
  "preference",
  "architecture",
  "command",
  "pitfall",
  "fact",
];

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    error: { code: "VALIDATION", message, retryable: false },
  });
}

function notFound(reply: FastifyReply) {
  return reply.status(404).send({
    error: {
      code: "VALIDATION",
      message: "Memory not found",
      retryable: false,
    },
  });
}

const routes: FastifyPluginAsync<RuntimeMemoryRoutesOptions> = async (
  app,
  options,
) => {
  app.get("/", async (request, reply) => {
    const query = request.query as {
      scope?: string;
      status?: string;
      kinds?: string;
      limit?: string;
    };

    if (query.scope && !SCOPES.includes(query.scope as MemoryScope)) {
      return badRequest(reply, "invalid scope");
    }
    if (
      query.status &&
      !STATUSES.includes(query.status as MemoryStatus)
    ) {
      return badRequest(reply, "invalid status");
    }

    const kinds = query.kinds
      ? query.kinds
          .split(",")
          .filter((kind): kind is MemoryKind =>
            KINDS.includes(kind as MemoryKind),
          )
      : undefined;
    const limit = query.limit
      ? Math.max(1, Math.min(500, Number(query.limit) || 100))
      : 100;

    const memories = await options.memory.list({
      ...(query.scope ? { scope: query.scope as MemoryScope } : {}),
      ...(query.status ? { status: query.status as MemoryStatus } : {}),
      ...(kinds && kinds.length > 0 ? { kinds } : {}),
      limit,
    });

    const response: MemoryListResponse = { memories };
    return response;
  });

  app.get("/search", async (request, reply) => {
    const query = request.query as {
      query?: string;
      topK?: string;
      scope?: string;
    };
    if (!query.query?.trim()) {
      return badRequest(reply, "query is required");
    }
    if (query.scope && !SCOPES.includes(query.scope as MemoryScope)) {
      return badRequest(reply, "invalid scope");
    }

    const memories = await options.memory.search({
      query: query.query,
      topK: query.topK
        ? Math.max(1, Math.min(50, Number(query.topK) || 10))
        : 10,
      ...(query.scope ? { scope: query.scope as MemoryScope } : {}),
    });

    const response: MemoryListResponse = { memories };
    return response;
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      content?: unknown;
      tags?: unknown;
      confidence?: unknown;
      status?: unknown;
      pinned?: unknown;
    };

    if (
      body.content !== undefined &&
      typeof body.content !== "string"
    ) {
      return badRequest(reply, "content must be a string");
    }
    if (
      body.tags !== undefined &&
      (!Array.isArray(body.tags) ||
        !body.tags.every((tag) => typeof tag === "string"))
    ) {
      return badRequest(reply, "tags must be string[]");
    }
    if (
      body.confidence !== undefined &&
      typeof body.confidence !== "number"
    ) {
      return badRequest(reply, "confidence must be a number");
    }
    if (
      body.status !== undefined &&
      !STATUSES.includes(body.status as MemoryStatus)
    ) {
      return badRequest(reply, "invalid status");
    }
    if (
      body.pinned !== undefined &&
      typeof body.pinned !== "boolean"
    ) {
      return badRequest(reply, "pinned must be a boolean");
    }

    const updated = await options.memory.update(asMemoryId(id), {
      ...(typeof body.content === "string"
        ? { content: body.content }
        : {}),
      ...(Array.isArray(body.tags)
        ? { tags: body.tags as string[] }
        : {}),
      ...(typeof body.confidence === "number"
        ? { confidence: body.confidence }
        : {}),
      ...(body.status ? { status: body.status as MemoryStatus } : {}),
      ...(typeof body.pinned === "boolean"
        ? { pinned: body.pinned }
        : {}),
    });

    if (!updated) return notFound(reply);
    return updated;
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await options.memory.delete(asMemoryId(id));
    if (!deleted) return notFound(reply);
    return { success: true };
  });
};

export default routes;
