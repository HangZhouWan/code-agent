/**
 * WebSocket 聊天处理
 *
 * 这是整个 Gateway 的核心：通过 WebSocket 实现实时聊天，
 * 支持 LLM 流式输出推送、工具审批交互和多 Agent 状态推送。
 *
 * ## 消息协议
 *
 * ### 客户端 → 服务端
 * | 类型       | 字段                                     | 说明           |
 * |------------|------------------------------------------|----------------|
 * | 用户消息   | `{ type: "message", content: string }`   | 发送聊天内容   |
 * | 工具审批   | `{ type: "approval", callId: string, approved: boolean }` | 审批确认/拒绝  |
 *
 * ### 服务端 → 客户端
 * | 类型       | 字段                                     | 说明           |
 * |------------|------------------------------------------|----------------|
 * | 文本增量   | `{ type: "text", delta: string }`        | LLM 流式输出   |
 * | 请求确认   | `{ type: "confirm_required", callId, tool, args }` | 需要用户确认   |
 * | 工具开始   | `{ type: "tool_start", tool: string, args: object }` | 工具调用开始   |
 * | 工具结束   | `{ type: "tool_end", tool: string, result: string }` | 工具调用结果   |
 * | Agent 状态 | `{ type: "agent_status", agents: [...] }` | 多 Agent 状态  |
 * | 完成       | `{ type: "done", finalResponse: string }` | 汇总完成       |
 * | 标题更新   | `{ type: "title_updated", title: string, sessionId: string }` | AI 自动生成标题 |
 * | 错误       | `{ type: "error", message: string }`     | 错误通知       |
 *
 * ## 审批机制
 *
 * 使用内存 Map 管理待审批的工具调用：
 * - WorkerAgent 执行中遇到 confirm 级别工具 → 服务端生成 callId
 * - 将 Promise 存入 pendingApprovals，推送 confirm_required 到前端
 * - 前端通过 WebSocket/HTTP 发送审批结果 → resolve Promise
 * - 断线时自动清理该 socket 的所有待审批项
 */

import type { FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, AIMessageChunk } from "@langchain/core/messages";
import type { ToolRegistry, PermissionRegistry } from "@my-agent/core";
import {
  InMemoryEventBus,
  InMemoryStateManager,
  AgentRegistry,
} from "@my-agent/core";
import type {
  IEventBus,
  AgentRegistry as AgentRegistryType,
  InMemoryStateManager as InMemoryStateManagerType,
} from "@my-agent/core";
import { SessionRepository } from "../../db/repositories/sessions.js";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 服务端 → 客户端消息联合类型 */
type ServerMessage =
  | { type: "text"; delta: string }
  | { type: "confirm_required"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_start"; tool: string; args: Record<string, unknown> }
  | { type: "tool_end"; tool: string; result: string }
  | { type: "done"; finalResponse: string }
  | { type: "error"; message: string }
  | { type: "title_updated"; title: string; sessionId: string }
  | { type: "agent_status"; agents: Array<{ role: string; id: string; name: string; status: string; currentTask?: string }> };

/** 客户端 → 服务端消息联合类型 */
interface ClientMessage {
  type: string;
  content?: string;
  callId?: string;
  approved?: boolean;
}

/** 待审批项 */
export interface PendingApprovalItem {
  resolve: (approved: boolean) => void;
  ws: WebSocket;
}

/** 审批存储（供 HTTP 路由和 WebSocket handler 共享） */
export interface ApprovalStore {
  resolve(callId: string, approved: boolean): boolean;
  cleanup(ws: WebSocket): void;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 从 AIMessageChunk 中提取文本增量
 *
 * 处理 content 为字符串或内容块数组的情况。
 */
function extractDelta(chunk: AIMessageChunk): string {
  const content = chunk.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: "text"; text: string } =>
        typeof block === "object" && block !== null && "type" in block && block.type === "text",
      )
      .map((block) => block.text)
      .join("");
  }
  return "";
}

/**
 * 将未知值安全序列化为 JSON 字符串
 */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * 根据第一条用户消息生成中文标题（5-15 字）
 *
 * @param model - LLM 实例
 * @param firstHumanMessage - 第一条用户消息内容
 * @returns 生成的中文标题，失败时返回 null
 */
async function generateTitle(
  model: BaseChatModel,
  firstHumanMessage: string,
): Promise<string | null> {
  try {
    const response = await model.invoke([
      new HumanMessage(
        `根据用户的第一条消息，用 5-15 个中文字生成一个简洁的对话标题。只输出标题本身，不要加引号或额外说明。\n\n用户消息：${firstHumanMessage}`,
      ),
    ]);
    const title = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content ?? "").trim();
    // 确保标题在合理范围内
    if (!title || title.length < 3 || title.length > 50) return null;
    return title;
  } catch (err) {
    console.error("[WS] Title generation failed:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// WebSocket Handler 工厂
// ---------------------------------------------------------------------------

/** createChatWebSocket 的配置选项 */
export interface ChatWebSocketOptions {
  model: BaseChatModel;
  toolRegistry: ToolRegistry;
  workspacePath: string;
  /** 共享的待审批 Map（注入后可供 HTTP 路由查询） */
  pendingApprovals: Map<string, PendingApprovalItem>;
  /** 权限注册表（可选，传入后启用 SandboxGuard 工具级拦截） */
  permissionRegistry?: PermissionRegistry;
  /** EventBus 实例（可选，不提供则自动创建） */
  eventBus?: IEventBus;
  /** StateManager 实例（可选，不提供则自动创建） */
  stateManager?: InMemoryStateManagerType;
  /** Agent 注册表（可选，不提供则自动创建） */
  agentRegistry?: AgentRegistryType;
}

/**
 * 创建 WebSocket 聊天处理器
 *
 * 返回的函数符合 Fastify WebSocket handler 签名：`(socket, request) => void`。
 *
 * 支持多 Agent 协作：
 * - 自动创建或使用外部注入的 EventBus、StateManager、AgentRegistry
 * - 初始化三个内置角色 Agent（code、test、doc）
 * - 广播 agent_status 到所有连接的客户端
 * - 监听 Agent 状态变更并自动推送
 *
 * @param options - 包含 LLM 模型、工具注册表、工作区路径和审批 Map
 * @returns Fastify WebSocket handler 函数
 */
export function createChatWebSocket(options: ChatWebSocketOptions) {
  const {
    model,
    toolRegistry,
    workspacePath,
    pendingApprovals,
    permissionRegistry,
    eventBus: externalEventBus,
    stateManager: externalStateManager,
    agentRegistry: externalAgentRegistry,
  } = options;

  // 创建或使用外部提供的共享实例
  const eventBus = externalEventBus ?? new InMemoryEventBus();
  const stateManager =
    externalStateManager ?? new InMemoryStateManager(eventBus);
  const agentRegistry =
    externalAgentRegistry ?? new AgentRegistry(eventBus, stateManager);

  // 跟踪所有活跃的 WebSocket 连接，用于广播 agent_status
  const activeSockets = new Set<WebSocket>();

  /**
   * 构建当前 Agent 状态快照并广播给所有连接的客户端
   */
  function broadcastAgentStatus(): void {
    const agents = agentRegistry.getAllAgents().map((agent) => {
      const state = stateManager.agents.get(agent.id);
      return {
        id: agent.id,
        role: agent.role.id,
        name: agent.role.name,
        status: state?.status ?? "offline",
        currentTask: state?.currentTask,
      };
    });

    const msg: ServerMessage = { type: "agent_status", agents };
    for (const ws of activeSockets) {
      send(ws, msg);
    }
  }

  // 初始化 Agent 创建 Promise（后台完成，不阻塞 handler 返回）
  let agentsReady: Promise<void> | undefined;
  if (!externalAgentRegistry) {
    agentsReady = (async () => {
      try {
        await agentRegistry.createAgent("code", model, toolRegistry, {
          workspacePath,
          permissionRegistry,
        });
        await agentRegistry.createAgent("test", model, toolRegistry, {
          workspacePath,
          permissionRegistry,
        });
        await agentRegistry.createAgent("doc", model, toolRegistry, {
          workspacePath,
          permissionRegistry,
        });
        // 初始化完成后广播状态
        broadcastAgentStatus();
      } catch (err) {
        console.error("[WS] Failed to create agents:", err);
      }
    })();
  } else {
    // 外部注入时立即广播初始状态
    broadcastAgentStatus();
  }

  // 监听 Agent 状态变更，自动广播给前端
  // StateManager 的 task.onChange 在状态流转时触发
  // 我们同时也监听 EventBus 上的 Agent 状态变更事件
  eventBus.subscribe("agent.event.task_started" as any, async () => {
    broadcastAgentStatus();
  });
  eventBus.subscribe("agent.event.task_completed" as any, async () => {
    broadcastAgentStatus();
  });
  eventBus.subscribe("agent.event.task_failed" as any, async () => {
    broadcastAgentStatus();
  });

  return async function chatHandler(socket: WebSocket, request: FastifyRequest) {
    // 注册到活跃连接集合
    activeSockets.add(socket);

    // 发送当前 Agent 状态（如果已有 Agent 初始化完成）
    if (!agentsReady || externalAgentRegistry) {
      broadcastAgentStatus();
    }

    // 从 URL 路径参数中提取 sessionId
    const params = request.params as Record<string, string>;
    const sessionId = params.id;

    // 从 Fastify decorate 获取 db
    const db = (request.server as any).db;
    const repo = db ? new SessionRepository(db) : null;

    // 发送初始消息确认连接
    send(socket, { type: "text", delta: "" });

    // ── 消息处理循环 ──
    socket.on("message", async (rawData: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        send(socket, { type: "error", message: "Invalid JSON" });
        return;
      }

      switch (msg.type) {
        // ── 用户聊天消息 ──
        case "message": {
          const content = msg.content?.trim();
          if (!content) {
            send(socket, { type: "error", message: "Empty message content" });
            return;
          }

          // 持久化用户消息
          if (repo && sessionId) {
            try {
              repo.addMessage(sessionId, { role: "human", content });
            } catch {
              // 持久化失败不应阻断流程
            }
          }

          // 等待 Agent 初始化完成
          if (agentsReady) {
            await agentsReady;
          }

          // 运行 Orchestrator Graph 并流式推送
          await streamOrchestrator(socket, {
            model,
            toolRegistry,
            workspacePath,
            content,
            sessionId,
            repo,
            pendingApprovals,
            permissionRegistry,
            eventBus,
            agentRegistry,
          });

          // 任务完成后广播最新 Agent 状态
          broadcastAgentStatus();
          break;
        }

        // ── 工具审批 ──
        case "approval": {
          const callId = msg.callId;
          const approved = msg.approved === true;

          if (!callId) {
            send(socket, { type: "error", message: "Missing callId in approval" });
            return;
          }

          const pending = pendingApprovals.get(callId);
          if (pending) {
            pendingApprovals.delete(callId);
            pending.resolve(approved);
          } else {
            send(socket, {
              type: "error",
              message: `Approval "${callId}" not found or already resolved`,
            });
          }
          break;
        }

        default:
          send(socket, {
            type: "error",
            message: `Unknown message type: "${msg.type}"`,
          });
      }
    });

    // ── 断线清理 ──
    socket.on("close", () => {
      // 从活跃连接集合中移除
      activeSockets.delete(socket);

      // 移除该 socket 的所有待审批项
      for (const [callId, item] of pendingApprovals) {
        if (item.ws === socket) {
          pendingApprovals.delete(callId);
        }
      }
    });

    // ── 错误处理（WebSocket 层面） ──
    socket.on("error", (err: Error) => {
      console.error(`[WS] Socket error for session ${sessionId}:`, err.message);
    });
  };
}

// ---------------------------------------------------------------------------
// Graph 流式执行
// ---------------------------------------------------------------------------

/** streamOrchestrator 的上下文参数 */
interface StreamContext {
  model: BaseChatModel;
  toolRegistry: ToolRegistry;
  workspacePath: string;
  content: string;
  sessionId: string;
  repo: SessionRepository | null;
  pendingApprovals: Map<string, PendingApprovalItem>;
  permissionRegistry?: PermissionRegistry;
  eventBus: IEventBus;
  agentRegistry: AgentRegistryType;
}

/**
 * 运行 Orchestrator 状态图并流式推送事件到 WebSocket
 *
 * 使用 LangGraph 的 streamEvents (v2) 获取细粒度事件：
 * - on_chat_model_stream → type: "text"（所有 LLM 流式输出）
 * - on_tool_start       → type: "tool_start"（工具调用开始）
 * - on_tool_end         → type: "tool_end"（工具调用结果）
 * - on_chain_end        → type: "done"（仅 finalizer 节点）
 */
async function streamOrchestrator(
  socket: WebSocket,
  ctx: StreamContext,
): Promise<void> {
  // 动态导入避免循环依赖（graph 依赖 orchestrator 模块）
  const { createOrchestratorGraph } = await import(
    "../../orchestrator/graph.js"
  );

  const graph = createOrchestratorGraph({
    model: ctx.model,
    toolRegistry: ctx.toolRegistry,
    workspacePath: ctx.workspacePath,
    permissionRegistry: ctx.permissionRegistry,
    eventBus: ctx.eventBus,
    agentRegistry: ctx.agentRegistry,
    onConfirmRequired: (toolName: string, args: Record<string, unknown>): Promise<boolean> => {
      const callId = crypto.randomUUID();
      send(socket, { type: "confirm_required", callId, tool: toolName, args });
      return new Promise((resolve) => {
        // 2 分钟超时后自动拒绝，避免 Agent 永久挂起
        const timeout = setTimeout(() => {
          ctx.pendingApprovals.delete(callId);
          resolve(false);
        }, 120_000);
        ctx.pendingApprovals.set(callId, {
          resolve: (approved: boolean) => {
            clearTimeout(timeout);
            resolve(approved);
          },
          ws: socket,
        });
      });
    },
  });

  try {
    const stream = graph.streamEvents(
      { messages: [new HumanMessage(ctx.content)] },
      { version: "v2" },
    );

    for await (const event of stream) {
      switch (event.event) {
        // ── LLM 流式输出 ──
        case "on_chat_model_stream": {
          const chunk = event.data?.chunk;
          if (chunk instanceof AIMessageChunk) {
            const delta = extractDelta(chunk);
            if (delta) {
              send(socket, { type: "text", delta });
            }
          }
          break;
        }

        // ── 工具调用开始 ──
        case "on_tool_start": {
          const toolName = event.name || "unknown";
          const input = (event.data?.input ?? {}) as Record<string, unknown>;
          send(socket, { type: "tool_start", tool: toolName, args: input });
          break;
        }

        // ── 工具调用结束 ──
        case "on_tool_end": {
          const toolName = event.name || "unknown";
          const output = safeJsonStringify(event.data?.output);
          send(socket, { type: "tool_end", tool: toolName, result: output });
          break;
        }

        // ── 节点完成 ──
        case "on_chain_end": {
          // 仅 finalizer 节点完成时发送 done
          if (event.name === "finalizer") {
            const output = event.data?.output as Record<string, unknown> | undefined;
            const finalResponse =
              (output?.finalResponse as string) ?? "No response generated.";

            // 持久化 assistant 回复
            if (ctx.repo && ctx.sessionId) {
              try {
                ctx.repo.addMessage(ctx.sessionId, {
                  role: "assistant",
                  content: finalResponse,
                });
              } catch {
                // 持久化失败不应阻断流程
              }
            }

            send(socket, { type: "done", finalResponse });

            // ── 自动生成标题（首条消息完成后） ──
            if (ctx.repo && ctx.sessionId) {
              try {
                const session = ctx.repo.getById(ctx.sessionId);
                if (session && session.title === "New Chat") {
                  const allMessages = ctx.repo.getMessages(ctx.sessionId);
                  // 仅首轮对话（≤2 条消息）时生成标题
                  if (allMessages.length <= 2) {
                    const firstHuman = allMessages.find(
                      (m) => m.role === "human",
                    );
                    if (firstHuman) {
                      const title = await generateTitle(
                        ctx.model,
                        firstHuman.content,
                      );
                      if (title) {
                        ctx.repo.updateTitle(ctx.sessionId, title);
                        send(socket, {
                          type: "title_updated",
                          title,
                          sessionId: ctx.sessionId,
                        });
                      }
                    }
                  }
                }
              } catch {
                // 标题生成失败不阻断主流程
              }
            }
          }
          break;
        }
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.error(`[WS] Orchestrator error for session ${ctx.sessionId}:`, message);
    send(socket, { type: "error", message });
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 向 WebSocket 发送 JSON 消息
 *
 * 仅在连接打开时发送，避免 closed 状态的错误。
 */
function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}
