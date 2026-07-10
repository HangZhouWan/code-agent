/**
 * ChatArea 组件 —— 聊天区核心控制器
 *
 * 负责串联 WebSocket、Store 和子组件：
 *
 * ```
 * handleSend(content):
 *   1. dispatch ADD_USER_MESSAGE
 *   2. dispatch ADD_ASSISTANT_MESSAGE
 *   3. ws.send(content)
 *
 * onMessage(wsMsg):
 *   switch msg.type:
 *     "text"             → dispatch APPEND_TEXT
 *     "tool_start"       → dispatch TOOL_START
 *     "tool_end"         → dispatch TOOL_END
 *     "confirm_required" → dispatch CONFIRM_REQUIRED
 *     "done"             → dispatch DONE
 *     "error"            → dispatch ERROR
 *
 * useEffect → messagesEndRef.scrollIntoView({ behavior: "smooth" })
 * ```
 */

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { useChatStore, dbMessagesToMessages, type DBMessageRow } from "../stores/chatStore.js";
import { useWebSocket } from "../hooks/useWebSocket.js";
import type { WSMessage } from "../hooks/useWebSocket.js";
import { MessageList } from "./MessageList.js";
import { InputBar } from "./InputBar.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChatAreaProps {
  /** 当前活跃的会话 ID（null 时显示引导页） */
  sessionId: string | null;

  /** WebSocket 推送标题更新时的回调 */
  onTitleUpdated?: (sessionId: string, title: string) => void;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * ChatArea
 *
 * 聊天区域的主控制器。负责：
 * - 管理聊天状态（useChatStore）
 * - 管理 WebSocket 连接（useWebSocket）
 * - 将 WS 消息映射为 store dispatch action
 * - 自动滚动到底部
 *
 * @example
 * ```tsx
 * <ChatArea sessionId={activeSessionId} />
 * ```
 */
export function ChatArea({ sessionId, onTitleUpdated }: ChatAreaProps) {
  const { state, dispatch } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── WS 消息 → dispatch 映射 ──
  const onMessage = useCallback(
    (msg: WSMessage) => {
      switch (msg.type) {
        case "text":
          if (msg.delta) {
            dispatch({ type: "APPEND_TEXT", delta: msg.delta });
          }
          break;

        case "tool_start":
          if (msg.tool) {
            dispatch({
              type: "TOOL_START",
              tool: msg.tool,
              args: msg.args ?? {},
            });
          }
          break;

        case "tool_end":
          if (msg.tool) {
            dispatch({
              type: "TOOL_END",
              tool: msg.tool,
              result: msg.result ?? "",
            });
          }
          break;

        case "confirm_required":
          dispatch({
            type: "CONFIRM_REQUIRED",
            callId: msg.callId ?? "",
            tool: msg.tool ?? "unknown",
            args: msg.args ?? {},
          });
          break;

        case "done":
          dispatch({
            type: "DONE",
            finalResponse: msg.finalResponse ?? "",
          });
          break;

        case "error":
          dispatch({
            type: "ERROR",
            message: msg.message ?? "Unknown error",
          });
          break;

        case "title_updated":
          if (msg.title) {
            onTitleUpdated?.(msg.sessionId ?? "", msg.title);
          }
          break;

        default:
          // 忽略未知类型的消息
          break;
      }
    },
    [dispatch, onTitleUpdated],
  );

  // ── WebSocket 连接 ──
  const { status, send, approve } = useWebSocket({
    sessionId: sessionId ?? null,
    onMessage,
  });

  // ── 发送消息 ──
  const handleSend = useCallback(
    (content: string) => {
      // 1. dispatch ADD_USER_MESSAGE
      dispatch({
        type: "ADD_USER_MESSAGE",
        id: crypto.randomUUID(),
        content,
      });
      // 2. dispatch ADD_ASSISTANT_MESSAGE
      dispatch({
        type: "ADD_ASSISTANT_MESSAGE",
        id: crypto.randomUUID(),
      });
      // 3. ws.send(content)
      send(content);
    },
    [dispatch, send],
  );

  // ── 审批回调 ──
  const handleApprove = useCallback(
    (callId: string, approved: boolean) => {
      approve(callId, approved);
    },
    [approve],
  );

  // ── 自动滚到底部 ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  // ── 判断 Agent 是否正在思考/响应 ──
  const isStreaming = useMemo(() => {
    if (state.messages.length === 0) return false;
    const last = state.messages[state.messages.length - 1];
    return last.role === "assistant" && last.isStreaming;
  }, [state.messages]);

  // ── 历史消息加载状态 ──
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── sessionId 变化时加载历史消息 ──
  useEffect(() => {
    if (!sessionId) {
      // 无会话时清空消息
      dispatch({ type: "LOAD_MESSAGES", messages: [] });
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      // 立即清空旧消息，避免短暂显示上一会话内容
      dispatch({ type: "LOAD_MESSAGES", messages: [] });
      setHistoryLoading(true);

      try {
        const res = await fetch(`/api/sessions/${sessionId}/history`);

        if (!res.ok) {
          // 404 = 会话不存在；其他错误记录日志
          if (res.status !== 404) {
            console.error(
              `[ChatArea] Failed to load history for ${sessionId}: HTTP ${res.status}`,
            );
          }
          return;
        }

        const rows: DBMessageRow[] = await res.json();

        if (cancelled) return;

        const messages = dbMessagesToMessages(rows);
        dispatch({ type: "LOAD_MESSAGES", messages });
      } catch (err) {
        if (cancelled) return;
        console.error(
          `[ChatArea] Error loading history for ${sessionId}:`,
          err,
        );
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [sessionId, dispatch]);

  // ── 无活跃会话时的引导页 ──
  if (!sessionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-gray-950">
        <div className="text-center max-w-md px-6">
          <h2 className="text-2xl font-bold text-gray-300 mb-3">
            My Agent
          </h2>
          <p className="text-gray-500">
            Select a conversation from the sidebar or create a new one to get
            started.
          </p>
        </div>
      </div>
    );
  }

  // ── 历史消息加载中 ──
  if (historyLoading) {
    return (
      <div className="flex-1 flex flex-col bg-gray-950 h-full">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 animate-pulse">
            Loading messages...
          </p>
        </div>
        <InputBar
          onSend={handleSend}
          disabled={true}
          isStreaming={false}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-950 h-full">
      {/* ── 消息列表 ── */}
      <MessageList messages={state.messages} onApprove={handleApprove} />

      {/* ── 自动滚动锚点 ── */}
      <div ref={messagesEndRef} />

      {/* ── 输入栏 ── */}
      <InputBar
        onSend={handleSend}
        disabled={status !== "connected" || isStreaming}
        isStreaming={isStreaming}
      />
    </div>
  );
}
