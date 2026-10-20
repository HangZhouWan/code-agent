/**
 * 会话 WebSocket 连接管理（新协议）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  safeParseServerWsMessage,
  type ClientWsMessage,
  type ServerWsMessage,
} from "@code-agent/protocol";

export type WSStatus = "connecting" | "connected" | "disconnected";

export interface UseWebSocketOptions {
  sessionId: string | null;
  onMessage: (message: ServerWsMessage) => void;
}

export interface UseWebSocketReturn {
  status: WSStatus;
  send: (content: string) => void;
  approve: (callId: string, approved: boolean) => void;
  answer: (questionId: string, answer: string) => void;
  /** 中断当前 run */
  abort: (reason?: string) => void;
}

function parseJson(data: unknown): unknown {
  const raw = typeof data === "string" ? data : String(data);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function useWebSocket({
  sessionId,
  onMessage,
}: UseWebSocketOptions): UseWebSocketReturn {
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const [reconnectKey, setReconnectKey] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const lastSeqRef = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);

  useEffect(() => {
    if (!sessionId) {
      setStatus("disconnected");
      lastSeqRef.current = 0;
      sessionRef.current = null;
      return;
    }

    if (sessionRef.current !== sessionId) {
      sessionRef.current = sessionId;
      lastSeqRef.current = 0;
    }
    intentionalCloseRef.current = false;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/sessions/${sessionId}/chat`;

    setStatus("connecting");
    const socket = new WebSocket(url);
    socketRef.current = socket;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    socket.onopen = () => {
      setStatus("connected");
    };

    socket.onmessage = (event) => {
      const parsed = safeParseServerWsMessage(parseJson(event.data));
      if (!parsed.success) {
        console.error("[useWebSocket] Invalid server message");
        return;
      }
      const message = parsed.data as ServerWsMessage;

      // 重连时服务端会重放历史，跳过已消费的 seq
      if (message.type === "event") {
        if (message.event.seq <= lastSeqRef.current) return;
        lastSeqRef.current = message.event.seq;

        if (
          message.event.event.type === "message.delta" &&
          !message.event.event.delta
        ) {
          return;
        }
      }

      onMessageRef.current(message);
    };

    socket.onclose = () => {
      setStatus("disconnected");
      if (!intentionalCloseRef.current) {
        reconnectTimer = setTimeout(() => {
          setReconnectKey((key) => key + 1);
        }, 3_000);
      }
    };

    socket.onerror = () => {
      console.error("[useWebSocket] Connection error:", sessionId);
    };

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
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
  }, [sessionId, reconnectKey]);

  const sendClient = useCallback((message: ClientWsMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    } else {
      console.warn("[useWebSocket] Cannot send: socket is not open");
    }
  }, []);

  const send = useCallback(
    (content: string) => sendClient({ type: "message", content }),
    [sendClient],
  );

  const approve = useCallback(
    (callId: string, approved: boolean) =>
      sendClient({ type: "approval", callId, approved }),
    [sendClient],
  );

  const answer = useCallback(
    (questionId: string, value: string) =>
      sendClient({ type: "answer", questionId, answer: value }),
    [sendClient],
  );

  const abort = useCallback(
    (reason?: string) =>
      sendClient({ type: "abort", ...(reason ? { reason } : {}) }),
    [sendClient],
  );

  return { status, send, approve, answer, abort };
}
