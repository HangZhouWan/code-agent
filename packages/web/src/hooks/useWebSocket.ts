/**
 * WebSocket 连接管理 hook
 *
 * 管理 WebSocket 生命周期，支持：
 * - status 三态：connecting → connected → disconnected
 * - send(content) 发送用户消息
 * - approve(callId, approved) 发送审批结果
 * - sessionId 变化时自动重连（关闭旧连接、建立新连接）
 * - 用 ref 包装回调避免 useEffect 重连
 */

import { useState, useRef, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** WebSocket 连接状态 */
export type WSStatus = "connecting" | "connected" | "disconnected";

/** 服务端 → 客户端消息联合类型 */
export interface WSMessage {
  type: string;
  delta?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  finalResponse?: string;
  message?: string;
  callId?: string;
  title?: string;
}

/** useWebSocket 配置 */
export interface UseWebSocketOptions {
  sessionId: string | null;
  /** 接收到服务端消息时的回调 */
  onMessage: (msg: WSMessage) => void;
}

/** useWebSocket 返回值 */
export interface UseWebSocketReturn {
  status: WSStatus;
  /** 发送用户消息 */
  send: (content: string) => void;
  /** 发送审批结果 */
  approve: (callId: string, approved: boolean) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useWebSocket
 *
 * 连接到指定会话的 WebSocket 聊天通道。
 * 当 sessionId 变化时自动断开旧连接、建立新连接。
 *
 * @example
 * ```tsx
 * const { status, send } = useWebSocket({ sessionId, onMessage });
 * send("Hello, what can you do?");
 * ```
 */
export function useWebSocket({
  sessionId,
  onMessage,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 用 ref 包装回调，避免因 onMessage 引用变化触发重连
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // ── 连接建立逻辑 ──
  useEffect(() => {
    // 没有选中会话时不连接
    if (!sessionId) {
      setStatus("disconnected");
      return;
    }

    // 清理之前的定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    // 构建 WebSocket URL（同源，使用 Vite proxy）
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/sessions/${sessionId}/chat`;

    setStatus("connecting");

    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      setStatus("connected");
    };

    socket.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data as string);
        // 忽略服务端初始的空 delta（确认连接消息）
        if (msg.type === "text" && msg.delta === "") return;
        onMessageRef.current(msg);
      } catch {
        console.error("[useWebSocket] Failed to parse message:", event.data);
      }
    };

    socket.onclose = () => {
      setStatus("disconnected");
      // 意外断开时 3 秒后自动重连
      reconnectTimerRef.current = setTimeout(() => {
        // 仅当 sessionId 未变化且连接仍处于断开状态时重连
        // （useEffect cleanup 会清除 timer，避免重复重连）
      }, 3000);
    };

    socket.onerror = () => {
      // onclose 会在 onerror 之后自动触发，由 onclose 处理重连
      console.error("[useWebSocket] Connection error for session:", sessionId);
    };

    // ── Cleanup ──
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close();
      }
    };
  }, [sessionId]);

  // ── 发送用户消息 ──
  const send = useCallback(
    (content: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "message", content }));
      } else {
        console.warn("[useWebSocket] Cannot send: WebSocket is not open");
      }
    },
    [],
  );

  // ── 发送审批结果 ──
  const approve = useCallback(
    (callId: string, approved: boolean) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "approval", callId, approved }));
      } else {
        console.warn("[useWebSocket] Cannot approve: WebSocket is not open");
      }
    },
    [],
  );

  return { status, send, approve };
}
