/**
 * ChatArea —— 聊天区控制器（新 SessionEvent 协议）
 */

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { ServerWsMessage } from "@code-agent/protocol";
import {
  useChatStore,
  dbMessagesToMessages,
  type DBMessageRow,
} from "../stores/chatStore.js";
import { useWebSocket } from "../hooks/useWebSocket.js";
import { MessageList } from "./MessageList.js";
import { InputBar } from "./InputBar.js";
import { QuestionCard } from "./QuestionCard.js";

export interface ChatAreaProps {
  sessionId: string | null;
  onTitleUpdated?: (sessionId: string, title: string) => void;
}

export function ChatArea({ sessionId, onTitleUpdated }: ChatAreaProps) {
  const { state, dispatch } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const onMessage = useCallback(
    (message: ServerWsMessage) => {
      if (message.type === "error") {
        dispatch({ type: "ERROR", message: message.error.message });
        return;
      }
      if (message.type !== "event") return;

      const event = message.event.event;
      switch (event.type) {
        case "message.delta":
          if (event.delta) {
            dispatch({ type: "APPEND_TEXT", delta: event.delta });
          }
          break;

        case "message.completed":
          if (event.message.role === "assistant") {
            dispatch({
              type: "FINALIZE_ASSISTANT",
              id: event.message.id,
              content: event.message.content,
            });
          }
          break;

        case "tool.started":
          dispatch({
            type: "TOOL_START",
            callId: event.callId,
            tool: event.toolName,
            args: event.args as Record<string, unknown>,
          });
          break;

        case "tool.finished":
          dispatch({
            type: "TOOL_END",
            callId: event.callId,
            tool: "",
            result: event.resultPreview,
            ok: event.ok,
          });
          break;

        case "approval.required":
          dispatch({
            type: "CONFIRM_REQUIRED",
            callId: event.request.callId,
            tool: event.request.toolName,
            args: event.request.args as Record<string, unknown>,
          });
          break;

        case "approval.resolved":
          dispatch({
            type: "APPROVAL_RESOLVED",
            callId: event.callId,
            decision: event.decision,
            ...(event.reason ? { reason: event.reason } : {}),
          });
          break;

        case "user.question.required":
          dispatch({
            type: "QUESTION_REQUIRED",
            question: {
              questionId: event.question.questionId,
              question: event.question.question,
              allowFreeText: event.question.allowFreeText,
              ...(event.question.options
                ? { options: event.question.options }
                : {}),
            },
          });
          break;

        case "user.question.resolved":
          dispatch({ type: "QUESTION_RESOLVED" });
          break;

        case "session.title.updated":
          onTitleUpdated?.(event.sessionId, event.title);
          break;

        case "run.completed":
          dispatch({
            type: "DONE",
            finalResponse: event.result.finalResponse ?? "",
          });
          break;

        case "run.failed":
          dispatch({ type: "ERROR", message: event.error.message });
          break;

        case "run.aborted":
          dispatch({ type: "ERROR", message: `已取消: ${event.reason}` });
          break;

        default:
          break;
      }
    },
    [dispatch, onTitleUpdated],
  );

  const { status, send, approve, answer } = useWebSocket({
    sessionId: sessionId ?? null,
    onMessage,
  });

  const handleSend = useCallback(
    (content: string) => {
      dispatch({
        type: "ADD_USER_MESSAGE",
        id: crypto.randomUUID(),
        content,
      });
      dispatch({
        type: "ADD_ASSISTANT_MESSAGE",
        id: crypto.randomUUID(),
      });
      send(content);
    },
    [dispatch, send],
  );

  const handleApprove = useCallback(
    (callId: string, approved: boolean) => {
      approve(callId, approved);
    },
    [approve],
  );

  const handleAnswer = useCallback(
    (value: string) => {
      const pending = state.pendingQuestion;
      if (!pending) return;
      answer(pending.questionId, value);
      dispatch({ type: "QUESTION_RESOLVED" });
    },
    [answer, dispatch, state.pendingQuestion],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  const isStreaming = useMemo(() => {
    if (state.messages.length === 0) return false;
    const last = state.messages[state.messages.length - 1];
    return last.role === "assistant" && last.isStreaming;
  }, [state.messages]);

  useEffect(() => {
    if (!sessionId) {
      dispatch({ type: "LOAD_MESSAGES", messages: [] });
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      dispatch({ type: "LOAD_MESSAGES", messages: [] });
      setHistoryLoading(true);

      try {
        const res = await fetch(`/api/sessions/${sessionId}/history`);
        if (!res.ok) {
          if (res.status !== 404) {
            console.error(
              `[ChatArea] Failed to load history: HTTP ${res.status}`,
            );
          }
          return;
        }

        const data = (await res.json()) as
          | { messages?: DBMessageRow[] }
          | DBMessageRow[];
        const rows = Array.isArray(data) ? data : (data.messages ?? []);
        if (cancelled) return;
        dispatch({
          type: "LOAD_MESSAGES",
          messages: dbMessagesToMessages(rows),
        });
      } catch (error) {
        if (!cancelled) {
          console.error("[ChatArea] Failed to load history", error);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [sessionId, dispatch]);

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

  if (historyLoading) {
    return (
      <div className="flex-1 flex flex-col bg-gray-950 h-full">
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 animate-pulse">
            Loading messages...
          </p>
        </div>
        <InputBar onSend={handleSend} disabled isStreaming={false} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-950 h-full min-w-0">
      <MessageList messages={state.messages} onApprove={handleApprove} />

      <div ref={messagesEndRef} />

      {state.pendingQuestion && (
        <QuestionCard
          question={state.pendingQuestion.question}
          {...(state.pendingQuestion.options
            ? { options: state.pendingQuestion.options }
            : {})}
          allowFreeText={state.pendingQuestion.allowFreeText}
          onSubmit={handleAnswer}
        />
      )}

      <InputBar
        onSend={handleSend}
        disabled={
          status !== "connected" ||
          isStreaming ||
          state.pendingQuestion !== undefined
        }
        isStreaming={isStreaming}
      />
    </div>
  );
}
