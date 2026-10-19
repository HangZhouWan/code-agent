/**
 * Runtime Fastify 服务
 */

import Fastify, { type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import type {
  MemoryService,
  SessionStore,
} from "@code-agent/runtime";
import { errorHandler } from "./middleware/error.js";
import runtimeAgents from "./routes/runtime-agents.js";
import runtimeConfig from "./routes/runtime-config.js";
import runtimeMemory from "./routes/runtime-memory.js";
import runtimeSessions from "./routes/runtime-sessions.js";
import runtimeTools from "./routes/runtime-tools.js";
import runtimeWorkspace from "./routes/runtime-workspace.js";
import { createRuntimeChatWebSocket } from "./ws/runtime-chat.js";
import type { SessionService } from "../session/session-service.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { WorkspaceWatcher } from "../workspace/watcher.js";

export interface RuntimeServerOptions {
  sessions: SessionStore;
  sessionService: SessionService;
  workspace: WorkspaceService;
  watcher?: WorkspaceWatcher;
  memory?: MemoryService;
}

export async function createRuntimeServer(
  options: RuntimeServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);
  app.setErrorHandler(errorHandler);

  app.get("/api/health", async () => ({ ok: true }));

  await app.register(runtimeConfig, { prefix: "/api/config" });
  await app.register(runtimeSessions, {
    prefix: "/api/sessions",
    sessions: options.sessions,
    sessionService: options.sessionService,
  });
  await app.register(runtimeWorkspace, {
    prefix: "/api/workspace",
    workspace: options.workspace,
  });
  await app.register(runtimeAgents, { prefix: "/api/agents" });
  await app.register(runtimeTools, {
    prefix: "/api/tools",
    sessionService: options.sessionService,
  });
  if (options.memory) {
    await app.register(runtimeMemory, {
      prefix: "/api/memory",
      memory: options.memory,
    });
  }

  app.get(
    "/api/sessions/:id/chat",
    { websocket: true },
    createRuntimeChatWebSocket({
      sessionService: options.sessionService,
    }),
  );

  app.get(
    "/api/workspace/events",
    { websocket: true },
    (socket) => {
      const unsubscribe = options.watcher?.onChange((change) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(change));
        }
      });
      socket.on("close", () => {
        unsubscribe?.();
      });
    },
  );

  return app;
}

/** 首次配置模式：只暴露 config/providers 路由 */
export async function createSetupServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(fastifyCors, { origin: true });
  app.setErrorHandler(errorHandler);
  await app.register(runtimeConfig, { prefix: "/api/config" });
  return app;
}
