/**
 * ChatArea —— 聊天区控制器（新 SessionEvent 协议）
 */

import { useRef, useEffect, useCallback, useState } from "react";
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
import { PlanApprovalCard } from "./PlanApprovalCard.js";

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
      if (message.type === "ready") {
        dispatch({ type: "SESSION_READY", planMode: message.planMode });
        return;
      }
      if (message.type !== "event") return;

      const event = message.event.event;
      switch (event.type) {
        case "run.started":
          dispatch({ type: "RUN_STARTED" });
          break;

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
          if (event.request.kind === "plan" && event.request.plan) {
            dispatch({
              type: "PLAN_APPROVAL_REQUIRED",
              callId: event.request.callId,
              summary: event.request.plan.summary,
              proposals: event.request.plan.proposals,
              ...(event.request.expiresAt
                ? { expiresAt: event.request.expiresAt }
                : {}),
            });
          } else {
            dispatch({
              type: "CONFIRM_REQUIRED",
              callId: event.request.callId,
              tool: event.request.toolName,
              args: event.request.args as Record<string, unknown>,
            });
          }
          break;

        case "approval.resolved":
          if (event.kind === "plan") {
            dispatch({
              type: "PLAN_APPROVAL_RESOLVED",
              callId: event.callId,
            });
          } else {
            dispatch({
              type: "APPROVAL_RESOLVED",
              callId: event.callId,
              decision: event.decision,
              ...(event.reason ? { reason: event.reason } : {}),
            });
          }
          break;

        case "plan.mode.changed":
          dispatch({ type: "PLAN_MODE_CHANGED", enabled: event.enabled });
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
          dispatch({
            type: "QUESTION_RESOLVED",
            questionId: event.questionId,
          });
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

  const { status, send, approve, answer, abort, setPlanMode } = useWebSocket({
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

  const handlePlanApprove = useCallback(
    (callId: string, selectedProposalIds: string[]) => {
      approve(callId, true, { selectedProposalIds });
    },
    [approve],
  );

  const handlePlanReject = useCallback(
    (callId: string, feedback: string) => {
      approve(callId, false, feedback ? { feedback } : {});
    },
    [approve],
  );

  // ── 停止当前 run ──
  const handleStop = useCallback(() => {
    abort("用户停止");
  }, [abort]);

  const handleAnswer = useCallback(
    (value: string) => {
      const pending = state.pendingQuestion;
      if (!pending) return;
      answer(pending.questionId, value);
      dispatch({ type: "QUESTION_RESOLVED", questionId: pending.questionId });
    },
    [answer, dispatch, state.pendingQuestion],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  // 以 run 生命周期为准切换 Send/Stop，避免个别消息状态异常时按钮卡住
  const isStreaming = state.runStatus === "running";
  const planMode = state.planMode ?? true;

  useEffect(() => {
    if (!sessionId) {
      dispatch({ type: "RESET_MESSAGES" });
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      dispatch({ type: "RESET_MESSAGES" });
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
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-gray-950">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-2">
        <div className="min-w-0">
          <span className="text-xs font-medium text-gray-300">计划模式</span>
          <span className="ml-2 text-[11px] text-gray-500">
            先扫描并提交方案，确认后再改文件
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={planMode}
          aria-label="切换计划模式"
          disabled={status !== "connected" || isStreaming}
          onClick={() => setPlanMode(!planMode)}
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            planMode
              ? "border-purple-500/60 bg-purple-500/15 text-purple-200"
              : "border-gray-700 bg-gray-900 text-gray-400"
          }`}
        >
          {planMode ? "已开启" : "已关闭"}
        </button>
      </div>

      <MessageList messages={state.messages} onApprove={handleApprove} />

      <div ref={messagesEndRef} />

      {state.pendingPlanApproval && (
        <PlanApprovalCard
          key={state.pendingPlanApproval.callId}
          callId={state.pendingPlanApproval.callId}
          summary={state.pendingPlanApproval.summary}
          proposals={state.pendingPlanApproval.proposals}
          {...(state.pendingPlanApproval.expiresAt
            ? { expiresAt: state.pendingPlanApproval.expiresAt }
            : {})}
          disabled={status !== "connected"}
          onApprove={handlePlanApprove}
          onReject={handlePlanReject}
        />
      )}

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

      {/* 任务结束提示：明确告知本轮 run 已结束 */}
      {state.runStatus === "completed" && (
        <p className="px-4 pt-2 text-center text-xs text-green-400">
          ✓ 本轮任务已结束
        </p>
      )}
      {state.runStatus === "failed" && (
        <p className="px-4 pt-2 text-center text-xs text-red-400">
          ✕ 本轮任务失败
        </p>
      )}

      <InputBar
        onSend={handleSend}
        onStop={handleStop}
        disabled={status !== "connected" || state.pendingQuestion !== undefined}
        isStreaming={isStreaming}
      />
    </div>
  );
}
