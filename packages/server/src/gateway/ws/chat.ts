/**
 * WebSocket 聊天处理
 *
 * 这是整个 Gateway 的核心：通过 WebSocket 实现实时聊天，
 * 支持 LLM 流式输出推送和工具审批交互。
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
 * | 完成       | `{ type: "done", finalResponse: string }` | 汇总完成       |
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
import type { ToolRegistry } from "@my-agent/core";
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
  | { type: "error"; message: string };

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
}

/**
 * 创建 WebSocket 聊天处理器
 *
 * 返回的函数符合 Fastify WebSocket handler 签名：`(socket, request) => void`。
 *
 * @param options - 包含 LLM 模型、工具注册表、工作区路径和审批 Map
 * @returns Fastify WebSocket handler 函数
 */
export function createChatWebSocket(options: ChatWebSocketOptions) {
  const { model, toolRegistry, workspacePath, pendingApprovals } = options;

  return async function chatHandler(socket: WebSocket, request: FastifyRequest) {
    // 从 URL 路径参数中提取 sessionId
    // Fastify WebSocket: request.params 在 handler 中可用
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

          // 运行 Orchestrator Graph 并流式推送
          await streamOrchestrator(socket, {
            model,
            toolRegistry,
            workspacePath,
            content,
            sessionId,
            repo,
            pendingApprovals,
          });
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
}

/**
 * 运行 Orchestrator 状态图并流式推送事件到 WebSocket
 *
 * 使用 LangGraph 的 streamEvents (v2) 获取细粒度事件：
 * - on_chat_model_stream → type: "text"（所有 LLM 流式输出）
 * - on_tool_start       → type: "tool_start"（工具调用开始）
 * - on_tool_end         → type: "tool_end"（工具调用结果）
 * - on_chain_end        → type: "done"（仅 summarizer 节点）
 */
async function streamOrchestrator(
  socket: WebSocket,
  ctx: StreamContext,
): Promise<void> {
  // 动态导入避免循环依赖（graph 依赖 orchestrator 模块）
  const { createOrchestratorGraph } = await import(
    "../../orchestrator/graph.js"
  );

  const graph = createOrchestratorGraph(
    ctx.model,
    ctx.toolRegistry,
    ctx.workspacePath,
  );

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
          // 仅 summarizer 节点完成时发送 done
          if (event.name === "summarizer") {
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
