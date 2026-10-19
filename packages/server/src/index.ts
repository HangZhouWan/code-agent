/**
 * @code-agent/server —— Runtime Fastify 入口
 */

import { fileURLToPath } from "node:url";
import {
  GlobalConfigManager,
  createMutex,
  createRuntime,
  createRuntimeBootstrap,
} from "@code-agent/runtime";
import { loadConfig } from "./config.js";
import { createServerDatabase } from "./db/server-db.js";
import { createSqlitePorts } from "./stores/index.js";
import { SessionService } from "./session/session-service.js";
import { WorkspaceService } from "./workspace/workspace-service.js";
import { WorkspaceWatcher } from "./workspace/watcher.js";
import {
  createRuntimeServer,
  createSetupServer,
} from "./gateway/runtime-server.js";

export const SERVER_VERSION = "0.1.0";

async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log(`  code-agent server v${SERVER_VERSION}`);
  console.log("=".repeat(50));

  const configManager = new GlobalConfigManager();
  if (!configManager.isConfigured()) {
    const app = await createSetupServer();
    const host = process.env.HOST ?? "127.0.0.1";
    const port = Number(process.env.PORT ?? 3000);
    await app.listen({ host, port });
    console.log(
      `[server] Setup mode — configure via http://${host}:${port}`,
    );

    const shutdown = async () => {
      await app.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const cfg = loadConfig();
  console.log(`[config] LLM: ${cfg.LLM_PROVIDER}/${cfg.LLM_MODEL}`);
  console.log(`[config] Server: ${cfg.HOST}:${cfg.PORT}`);
  console.log(`[config] Workspace: ${cfg.WORKSPACE_PATH}`);
  console.log(`[config] Database: ${cfg.DB_PATH}`);

  const bootstrap = createRuntimeBootstrap({
    config: cfg,
    writeLock: createMutex(),
  });
  const db = createServerDatabase(cfg.DB_PATH);
  const ports = createSqlitePorts(db, bootstrap.checkpointStore);
  const runtime = createRuntime(bootstrap.harness, {
    ports,
    orchestration: true,
  });

  const sessionService = new SessionService(
    runtime,
    cfg.WORKSPACE_PATH,
  );
  const workspace = new WorkspaceService(cfg.WORKSPACE_PATH);
  const watcher = new WorkspaceWatcher(cfg.WORKSPACE_PATH);
  watcher.start();

  const app = await createRuntimeServer({
    sessions: ports.sessions,
    sessionService,
    workspace,
    watcher,
  });

  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  console.log(`[server] Running at http://${cfg.HOST}:${cfg.PORT}`);

  const shutdown = async () => {
    console.log("\n[server] Shutting down gracefully...");
    watcher.stop();
    await sessionService.disposeAll();
    await runtime.dispose();
    try {
      db.close();
    } catch {
      // ignore
    }
    await app.close();
    console.log("[server] Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const runningFile = fileURLToPath(import.meta.url);
const isEntryPoint =
  process.argv[1] === runningFile ||
  process.argv[1]?.endsWith("/server/dist/index.js") ||
  process.argv[1]?.endsWith("/server/src/index.ts");

if (isEntryPoint) {
  main().catch((error) => {
    console.error("[server] Fatal error during startup:");
    console.error(error);
    process.exit(1);
  });
}
