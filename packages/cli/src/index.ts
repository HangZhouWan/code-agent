/**
 * code-agent —— CLI 入口
 *
 * 支持 Claude Code 式的调用方式：
 *   code-agent                          # 以当前目录为工作区，启动 REPL
 *   code-agent /path/to/project         # 以指定目录为工作区，启动 REPL
 *   code-agent "帮我分析这个项目"         # 非交互模式：执行单次查询后退出
 *   code-agent -p "分析项目"             # --print 模式：输出后退出
 *
 * 此模块负责：
 * - 解析 CLI 参数（工作区路径、查询文本、标志位）
 * - 分层加载配置（全局 → 项目 → 环境变量）
 * - 创建 LLM 模型实例
 * - 注册所有内置工具
 * - 初始化 Agent 基础设施
 * - 根据模式：启动 REPL 或执行单次查询
 */

import { getDataDir, getCheckpointDir } from "./paths.js";
import { loadConfig } from "./config.js";
import { parseArgs, printHelp, printVersion } from "./args.js";
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
  // Memory
  InMemoryShortTermMemory,
  InMemoryWorkingMemory,
  FileLongTermMemory,
} from "@code-agent/core";
import type { IMemoryManager } from "@code-agent/core";
import { startRepl } from "./repl.js";
import { createOrchestratorGraph } from "@code-agent/server/orchestrator";
import { HumanMessage } from "@langchain/core/messages";
import { formatToolStart, formatToolEnd, formatError, green, dim } from "./format.js";

// ─── Version ───────────────────────────────────────

export const CLI_VERSION = "0.1.0";

// ─── Infrastructure Bootstrap (shared) ─────────────

interface BootstrapOptions {
  /** Workspace path (resolved absolute path from CLI args) */
  workspacePath: string;
  /** Optional CLI model override (--model flag) */
  cliModel?: string;
}

interface BootstrapResult {
  model: ReturnType<typeof createChatModel>;
  toolRegistry: ToolRegistry;
  permRegistry: PermissionRegistry;
  agentRegistry: AgentRegistry;
  memoryManager: IMemoryManager;
  executionEngine: ExecutionEngine;
  checkpointManager: FileCheckpointManager;
}

/**
 * Initialize all shared infrastructure.
 *
 * Extracted so both REPL and non-interactive modes use the same setup.
 */
function bootstrap(options: BootstrapOptions): BootstrapResult {
  const { workspacePath, cliModel } = options;

  // 1. Load config (layered: global → project .code-agent/ → .env → process.env)
  const cfg = loadConfig({ workspacePath, cliModel });

  // 2. Create LLM model
  const model = createChatModel({
    provider: cfg.LLM_PROVIDER,
    model: cfg.LLM_MODEL,
    apiKey: cfg.LLM_API_KEY,
    baseURL: cfg.LLM_BASE_URL,
    maxRetries: cfg.LLM_MAX_RETRIES,
  });

  // 3. Register all built-in tools
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

  // 4. Register permission policies
  const permRegistry = PermissionRegistry.createDefault();

  // 5. Initialize Agent infrastructure
  const eventBus = new InMemoryEventBus();
  const stateManager = new InMemoryStateManager(eventBus);

  // 5a. Three-tier memory system
  const memoryManager: IMemoryManager = {
    shortTerm: new InMemoryShortTermMemory(),
    working: new InMemoryWorkingMemory(),
    longTerm: new FileLongTermMemory(getDataDir(workspacePath)),
  };

  // 5b. Checkpoint + ExecutionEngine
  const checkpointManager = new FileCheckpointManager(getCheckpointDir(workspacePath));
  const executionEngine = new ExecutionEngine(checkpointManager, memoryManager, eventBus);

  // 6. Register role agents
  const agentRegistry = new AgentRegistry(eventBus, stateManager, checkpointManager, memoryManager);

  return {
    model,
    toolRegistry,
    permRegistry,
    agentRegistry,
    memoryManager,
    executionEngine,
    checkpointManager,
  };
}

/**
 * Register built-in agents (code, test, doc).
 */
async function registerAgents(
  agentRegistry: AgentRegistry,
  model: ReturnType<typeof createChatModel>,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permRegistry: PermissionRegistry,
): Promise<void> {
  await agentRegistry.createAgent("code", model, toolRegistry, {
    workspacePath,
    permissionRegistry: permRegistry,
  });
  await agentRegistry.createAgent("test", model, toolRegistry, {
    workspacePath,
    permissionRegistry: permRegistry,
  });
  await agentRegistry.createAgent("doc", model, toolRegistry, {
    workspacePath,
    permissionRegistry: permRegistry,
  });
}

/**
 * Resume pending checkpoints (if any).
 */
async function resumePendingCheckpoints(
  checkpointManager: FileCheckpointManager,
  agentRegistry: AgentRegistry,
  model: ReturnType<typeof createChatModel>,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permRegistry: PermissionRegistry,
  memoryManager: IMemoryManager,
): Promise<void> {
  const eventBus = new InMemoryEventBus();
  const executionEngine = new ExecutionEngine(checkpointManager, memoryManager, eventBus);

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
          { workspacePath, sessionId: `recovery-${taskId}` },
          permRegistry,
        ),
        agent.role.systemPrompt,
        { maxIterations: 15, timeoutMs: 360000 },
      ).then((result) => {
        console.log(`[recovery] Task ${taskId} resumed: status=${result.status}`);
        if (result.status === "success" || result.status === "failed") {
          checkpointManager.purge(taskId).catch(() => {});
        }
      }).catch((err) => {
        console.error(`[recovery] Task ${taskId} resume failed:`, err);
      });
    }
  }
}

// ─── Non-Interactive Mode ──────────────────────────

/**
 * Run a single query in non-interactive mode and exit.
 *
 * Uses the Orchestrator Graph directly (not REPL) to process the query
 * and stream the result to stdout.
 */
async function runSingleQuery(
  query: string,
  options: BootstrapResult & { workspacePath: string },
): Promise<void> {
  const { model, toolRegistry, permRegistry, agentRegistry, workspacePath } = options;

  const graph = createOrchestratorGraph({
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry: permRegistry,
    agentRegistry,
  });

  const messages = [new HumanMessage(query)];
  let finalResponse = "";

  try {
    const stream = graph.streamEvents(
      { messages },
      { version: "v2" },
    );

    for await (const event of stream) {
      switch (event.event) {
        case "on_chat_model_stream": {
          const chunk = event.data?.chunk;
          if (chunk && typeof chunk.content === "string") {
            process.stdout.write(green(chunk.content));
          } else if (chunk && Array.isArray(chunk.content)) {
            const text = (chunk.content as Array<{ type: string; text?: string }>)
              .filter((block) => block.type === "text")
              .map((block) => block.text ?? "")
              .join("");
            if (text) process.stdout.write(green(text));
          }
          break;
        }
        case "on_tool_start": {
          const toolName = event.name || "unknown";
          const input = (event.data?.input ?? {}) as Record<string, unknown>;
          process.stdout.write(`\n${formatToolStart(toolName, input)}\n`);
          break;
        }
        case "on_tool_end": {
          const output = JSON.stringify(event.data?.output ?? "").slice(0, 200);
          process.stdout.write(`${formatToolEnd(output)}\n`);
          break;
        }
        case "on_chain_end": {
          if (event.name === "finalizer") {
            const output = event.data?.output as Record<string, unknown> | undefined;
            finalResponse = (output?.finalResponse as string) ?? "";
            process.stdout.write(`\n`);
          }
          break;
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\n${formatError(message)}\n`);
    process.exit(1);
  }

  // Ensure we end with a newline for clean terminal output
  if (!finalResponse.endsWith("\n")) {
    process.stdout.write("\n");
  }
}

// ─── Main ──────────────────────────────────────────

async function main(): Promise<void> {
  // 0. Parse CLI arguments
  const args = parseArgs(process.argv);

  // Handle --help
  if (args.showHelp) {
    printHelp();
    process.exit(0);
  }

  // Handle --version
  if (args.showVersion) {
    printVersion(CLI_VERSION);
    process.exit(0);
  }

  // ── Header ──
  console.log("=".repeat(50));
  console.log(`  code-agent cli v${CLI_VERSION}`);
  console.log("=".repeat(50));

  // 1. Workspace resolution
  const workspacePath = args.workspacePath;
  console.log(`[config] Workspace: ${workspacePath}`);

  // 2. Bootstrap infrastructure
  const infra = bootstrap({ workspacePath, cliModel: args.model });
  console.log(`[config] LLM: ${infra.model.constructor.name}`);
  console.log(
    `[tools] Registered ${infra.toolRegistry.listAll().length} built-in tools`,
  );
  console.log(
    `[sandbox] Registered ${infra.permRegistry.listAll().length} tool permissions`,
  );
  console.log("[memory] Three-tier memory system initialized");
  console.log("[agent] Infrastructure initialized");

  // 3. Register agents
  await registerAgents(
    infra.agentRegistry,
    infra.model,
    infra.toolRegistry,
    workspacePath,
    infra.permRegistry,
  );
  console.log("[AgentRegistry] Agents started:");
  for (const agent of infra.agentRegistry.getAllAgents()) {
    console.log(`  - ${agent.role.name} (${agent.id})`);
  }

  // 4. Resume pending checkpoints
  await resumePendingCheckpoints(
    infra.checkpointManager,
    infra.agentRegistry,
    infra.model,
    infra.toolRegistry,
    workspacePath,
    infra.permRegistry,
    infra.memoryManager,
  );

  // 5. Mode switch: non-interactive query vs REPL
  if (args.query) {
    // ── Non-interactive mode ──
    console.log(`[cli] Running query in non-interactive mode...\n`);
    await runSingleQuery(args.query, { ...infra, workspacePath });
    process.exit(0);
  }

  // ── Interactive REPL mode ──
  console.log(`[cli] Starting REPL...\n`);
  await startRepl({
    model: infra.model,
    toolRegistry: infra.toolRegistry,
    workspacePath,
    permissionRegistry: infra.permRegistry,
    agentRegistry: infra.agentRegistry,
  });
}

// ─── 启动 ──────────────────────────────────────────

main().catch((err) => {
  console.error("[cli] Fatal error during startup:");
  console.error(err);
  process.exit(1);
});
