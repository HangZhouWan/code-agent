/**
 * @my-agent/server —— Fastify API 服务端入口
 *
 * 此模块负责：
 * - 加载环境变量配置
 * - 创建 LLM 模型实例
 * - 注册所有内置工具
 * - 初始化数据库连接
 * - 构建并启动 Fastify HTTP + WebSocket 服务
 *
 * 启动命令：pnpm --filter @my-agent/server dev
 */

import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// .env 位于 monorepo 根目录，而非 packages/server
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });
import { loadConfig } from "./config.js";
import { createServer } from "./gateway/server.js";
import { createDb } from "./db/index.js";
import {
  createChatModel,
  ToolRegistry,
  // 内置工具
  fileReadTool,
  fileWriteTool,
  fileListTool,
  shellExecTool,
  codeSearchTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
  webFetchTool,
  // 沙箱
  PermissionRegistry,
} from "@my-agent/core";

// ---------------------------------------------------------------------------
// 服务端版本标识
// ---------------------------------------------------------------------------

export const SERVER_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// 重新导出（供外部引用）
// ---------------------------------------------------------------------------

// 数据库层
export { createDb } from "./db/index.js";
export { sessions, messages } from "./db/index.js";
export { SessionRepository, MessageRepository } from "./db/index.js";
export type { MessageRole, CreateMessageInput } from "./db/index.js";

// Orchestrator（Agent 编排层）
export { createOrchestratorGraph } from "./orchestrator/graph.js";
export { OrchestratorState } from "./orchestrator/state.js";
export type { SubTask, NextAction, TaskResult } from "./orchestrator/types.js";

// Gateway
export { createServer } from "./gateway/server.js";
export { loadConfig } from "./config.js";
export type { EnvConfig } from "./config.js";
export type { AppOptions } from "./gateway/server.js";

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

/**
 * 服务启动入口
 *
 * 启动流程：
 * 1. 加载并校验环境变量
 * 2. 创建 LLM 模型实例
 * 3. 注册所有内置工具（11 个）
 * 4. 初始化数据库连接（SQLite + Drizzle ORM）
 * 5. 构建 Fastify 服务实例
 * 6. 挂载数据库实例到 Fastify
 * 7. 监听 HOST:PORT 启动服务
 */
async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log("  my-agent server v" + SERVER_VERSION);
  console.log("=".repeat(50));

  // 1. 加载配置
  const cfg = loadConfig();
  console.log(`[config] LLM: ${cfg.LLM_PROVIDER}/${cfg.LLM_MODEL}`);
  console.log(`[config] Server: ${cfg.HOST}:${cfg.PORT}`);
  console.log(`[config] Workspace: ${cfg.WORKSPACE_PATH}`);
  console.log(`[config] Database: ${cfg.DB_PATH}`);

  // 2. 创建 LLM 模型
  const model = createChatModel({
    provider: cfg.LLM_PROVIDER,
    model: cfg.LLM_MODEL,
    apiKey: cfg.LLM_API_KEY,
    baseURL: cfg.LLM_BASE_URL,
    maxRetries: cfg.LLM_MAX_RETRIES,
  });

  // 3. 注册所有内置工具
  const toolRegistry = ToolRegistry.createDefault();
  toolRegistry.register(fileReadTool);
  toolRegistry.register(fileWriteTool);
  toolRegistry.register(fileListTool);
  toolRegistry.register(shellExecTool);
  toolRegistry.register(codeSearchTool);
  toolRegistry.register(gitStatusTool);
  toolRegistry.register(gitDiffTool);
  toolRegistry.register(gitLogTool);
  toolRegistry.register(gitCommitTool);
  toolRegistry.register(gitBranchTool);
  toolRegistry.register(webFetchTool);
  console.log(
    `[tools] Registered ${toolRegistry.listAll().length} built-in tools`,
  );

  // 注册权限策略（供 SandboxGuard 查询）
  const permRegistry = PermissionRegistry.createDefault();
  console.log(
    `[sandbox] Registered ${permRegistry.listAll().length} tool permissions`,
  );

  // 4. 初始化数据库
  const db = createDb(cfg.DB_PATH);
  console.log(`[db] SQLite database initialized at ${cfg.DB_PATH}`);

  // 5. 创建 Fastify 服务
  const app = await createServer({
    model,
    toolRegistry,
    workspacePath: cfg.WORKSPACE_PATH,
  });

  // 6. 挂载共享实例到 Fastify
  app.decorate("db", db);
  app.decorate("permissionRegistry", permRegistry);

  // 7. 启动服务
  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  console.log(`[server] Running at http://${cfg.HOST}:${cfg.PORT}`);

  // 优雅关闭
  const shutdown = async () => {
    console.log("\n[server] Shutting down gracefully...");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("[server] Fatal error during startup:");
  console.error(err);
  process.exit(1);
});
