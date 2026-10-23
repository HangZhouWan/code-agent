/**
 * 工作区只读 API
 */

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { PathEscapeError } from "@code-agent/runtime";
import type {
  GitStatusResponse,
  WorkspaceDiffResponse,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
} from "@code-agent/protocol";
import type { WorkspaceService } from "../../workspace/workspace-service.js";

export interface RuntimeWorkspaceRoutesOptions {
  workspace: WorkspaceService;
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({
    error: { code: "VALIDATION", message, retryable: false },
  });
}

async function guard<T>(
  reply: FastifyReply,
  fn: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PathEscapeError) {
      return badRequest(reply, error.message);
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return reply.status(404).send({
        error: {
          code: "VALIDATION",
          message: "Path not found",
          retryable: false,
        },
      });
    }
    throw error;
  }
}

const routes: FastifyPluginAsync<RuntimeWorkspaceRoutesOptions> = async (
  app,
  options,
) => {
  app.get("/tree", async (request, reply) => {
    const query = request.query as { path?: unknown };
    const path = typeof query.path === "string" ? query.path : ".";
    return guard(reply, async () => {
      const response: WorkspaceTreeResponse = {
        path,
        entries: await options.workspace.listTree(path),
      };
      return response;
    });
  });

  app.get("/file", async (request, reply) => {
    const query = request.query as { path?: unknown };
    if (typeof query.path !== "string" || !query.path) {
      return badRequest(reply, "path is required");
    }
    return guard(reply, async () => {
      const response: WorkspaceFileResponse = {
        file: await options.workspace.readFile(query.path as string),
      };
      return response;
    });
  });

  app.get("/diff", async (request, reply) => {
    const query = request.query as { path?: unknown };
    if (typeof query.path !== "string" || !query.path) {
      return badRequest(reply, "path is required");
    }
    return guard(reply, async () => {
      const response: WorkspaceDiffResponse = {
        diff: await options.workspace.diff(query.path as string),
      };
      return response;
    });
  });

  app.get("/git/status", async (request, reply) => {
    return guard(reply, async () => {
      const response: GitStatusResponse = {
        files: await options.workspace.gitStatus(),
      };
      return response;
    });
  });
};

export default routes;
