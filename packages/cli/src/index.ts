/**
 * @code-agent/cli —— CLI REPL 入口
 *
 * 此模块负责：
 * - 加载环境变量配置
 * - 创建 LLM 模型实例
 * - 注册所有内置工具
 * - 初始化 Agent 基础设施（EventBus、StateManager、Memory、Checkpoint、ExecutionEngine）
 * - 创建 AgentRegistry 并注册三个内置角色 Agent
 * - 启动交互式 REPL 会话
 *
 * 启动命令：pnpm --filter @code-agent/cli dev
 */

import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// .env 位于 monorepo 根目录
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

import { loadConfig } from "./config.js";
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
  // Agent 基础设施
  InMemoryEventBus,
  InMemoryStateManager,
  AgentRegistry,
  FileCheckpointManager,
  ExecutionEngine,
  // Memory 三层记忆体系
  InMemoryShortTermMemory,
  InMemoryWorkingMemory,
  FileLongTermMemory,
} from "@code-agent/core";
import type { IMemoryManager } from "@code-agent/core";
import { startRepl } from "./repl.js";

// ─── Version ───────────────────────────────────────

export const CLI_VERSION = "0.1.0";

// ─── Main ──────────────────────────────────────────

/**
 * CLI 启动入口
 *
 * 启动流程（与 server/src/index.ts 共享初始化逻辑）：
 * 1. 加载并校验环境变量
 * 2. 创建 LLM 模型实例
 * 3. 注册所有内置工具（11 个）
 * 4. 初始化 Agent 基础设施（EventBus、StateManager、CheckpointManager、ExecutionEngine）
 * 5. 创建 AgentRegistry 并注册三个内置角色 Agent
 * 6. 启动交互式 REPL 会话
 */
async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log("  code-agent cli v" + CLI_VERSION);
  console.log("=".repeat(50));

  // 1. 加载配置
  const cfg = loadConfig();
  console.log(`[config] LLM: ${cfg.LLM_PROVIDER}/${cfg.LLM_MODEL}`);
  console.log(`[config] Workspace: ${cfg.WORKSPACE_PATH}`);

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

  // 注册权限策略
  const permRegistry = PermissionRegistry.createDefault();
  console.log(
    `[sandbox] Registered ${permRegistry.listAll().length} tool permissions`,
  );

  // 4. 初始化 Agent 基础设施
  const eventBus = new InMemoryEventBus();
  const stateManager = new InMemoryStateManager(eventBus);

  // 4a. 初始化三层记忆体系
  const memoryManager: IMemoryManager = {
    shortTerm: new InMemoryShortTermMemory(),
    working: new InMemoryWorkingMemory(),
    longTerm: new FileLongTermMemory("./data"),
  };
  console.log("[memory] Three-tier memory system initialized");

  // 4b. 初始化 Checkpoint + ExecutionEngine
  const checkpointManager = new FileCheckpointManager("./data/checkpoints");
  const executionEngine = new ExecutionEngine(checkpointManager, memoryManager, eventBus);
  console.log("[agent] Infrastructure initialized");

  // 5. 注册角色 Agent
  const agentRegistry = new AgentRegistry(eventBus, stateManager, checkpointManager, memoryManager);
  await agentRegistry.createAgent("code", model, toolRegistry, {
    workspacePath: cfg.WORKSPACE_PATH,
    permissionRegistry: permRegistry,
  });
  await agentRegistry.createAgent("test", model, toolRegistry, {
    workspacePath: cfg.WORKSPACE_PATH,
    permissionRegistry: permRegistry,
  });
  await agentRegistry.createAgent("doc", model, toolRegistry, {
    workspacePath: cfg.WORKSPACE_PATH,
    permissionRegistry: permRegistry,
  });
  console.log("[AgentRegistry] Agents started:");
  for (const agent of agentRegistry.getAllAgents()) {
    console.log(`  - ${agent.role.name} (${agent.id})`);
  }

  // 5a. 扫描并恢复未完成的 checkpoint
  const pendingTaskIds = await checkpointManager.listTasks();
  if (pendingTaskIds.length > 0) {
    console.log(`[recovery] Found ${pendingTaskIds.length} pending checkpoint(s), resuming...`);
    for (const taskId of pendingTaskIds) {
      const snapshot = await checkpointManager.load(taskId);
      if (!snapshot) continue;

      const agent = agentRegistry.getAgentById(snapshot.agentId);
      if (!agent) {
        console.log(`[recovery] Task ${taskId}: agent ${snapshot.agentId} not found, skipping`);
        continue;
      }

      executionEngine.resume(
        taskId,
        model,
        toolRegistry.getToolsForAgent(
          agent.capability,
          { workspacePath: cfg.WORKSPACE_PATH, sessionId: `recovery-${taskId}` },
          permRegistry,
        ),
        agent.role.systemPrompt,
        { maxIterations: 15, timeoutMs: 360000 },
      ).then((result) => {
        console.log(`[recovery] Task ${taskId} resumed: status=${result.status}`);
        if (result.status === 'success' || result.status === 'failed') {
          checkpointManager.purge(taskId).catch(() => {});
        }
      }).catch((err) => {
        console.error(`[recovery] Task ${taskId} resume failed:`, err);
      });
    }
  } else {
    console.log("[recovery] No pending checkpoints found");
  }

  // 6. 启动交互式 REPL 会话
  console.log(`[cli] Starting REPL...\n`);
  await startRepl({
    model,
    toolRegistry,
    workspacePath: cfg.WORKSPACE_PATH,
    permissionRegistry: permRegistry,
    agentRegistry,
  });
}

// ─── 启动 ──────────────────────────────────────────

main().catch((err) => {
  console.error("[cli] Fatal error during startup:");
  console.error(err);
  process.exit(1);
});
