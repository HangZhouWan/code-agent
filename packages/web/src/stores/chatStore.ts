/**
 * 聊天状态管理 —— useReducer 模式
 *
 * 管理消息列表和流式更新，将 WebSocket 消息映射为 reducer action。
 *
 * ## 消息类型
 *
 * - `user`：用户发送的消息
 * - `assistant`：LLM 回复消息，包含 isStreaming 和 toolCalls
 *
 * ## 工具调用状态
 *
 * - `running`：工具正在执行
 * - `awaiting_approval`：需要用户审批
 * - `done`：工具执行完成
 * - `error`：工具执行出错
 */

import { useReducer } from "react";
import type { CodeProposal } from "@code-agent/protocol";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 工具调用状态枚举 */
export type ToolCallStatus = "running" | "done" | "error" | "awaiting_approval";

/** 单条工具调用状态 */
export interface ToolCallState {
  /** 工具调用 ID（新协议使用 callId 精确匹配） */
  callId?: string;
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  status: ToolCallStatus;
  /** 审批回调 ID（仅 awaiting_approval 状态时有值） */
  approvalId?: string;
  /** 工具执行耗时（毫秒） */
  durationMs?: number;
}

/** 待回答的用户问题 */
export interface QuestionPrompt {
  questionId: string;
  question: string;
  options?: string[];
  allowFreeText: boolean;
}

/** 聊天消息 */
export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** assistant 消息是否仍在流式输出 */
  isStreaming: boolean;
  /** assistant 消息关联的工具调用 */
  toolCalls: ToolCallState[];
}

/** 当前 run 的生命周期状态 */
export type RunStatus = "idle" | "running" | "completed" | "failed";

/** 计划模式下等待用户确认的方案集合 */
export interface PlanApprovalPrompt {
  callId: string;
  summary: string;
  proposals: CodeProposal[];
  expiresAt?: string;
}

/** 整个聊天状态 */
export interface ChatState {
  messages: Message[];
  pendingQuestion?: QuestionPrompt;
  /** 当前 run 状态；用于可靠地切换 Send/Stop 并提示任务结束 */
  runStatus?: RunStatus;
  /** 会话是否启用计划模式；缺省视为开启 */
  planMode?: boolean;
  /** 等待用户选择的改进方案；与工具审批分开渲染 */
  pendingPlanApproval?: PlanApprovalPrompt;
}

// ---------------------------------------------------------------------------
// DB 消息类型 & 转换
// ---------------------------------------------------------------------------

/**
 * GET /api/sessions/:id/history 返回的原始消息行
 *
 * 对应后端 Drizzle schema: packages/server/src/db/schema.ts
 */
export interface DBMessageRow {
  id: number | string;
  sessionId?: string;
  role: "human" | "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string | null;
  toolArgs?: string | null;
  toolResult?: string | null;
  createdAt: string;
}

/**
 * 将原始 DB 消息行转换为前端 Message 对象
 *
 * 转换规则：
 * - human → user
 * - assistant → assistant（保持）
 * - system / tool → 过滤（前端暂不展示）
 * - 所有历史消息 isStreaming = false, toolCalls = []
 */
export function dbMessagesToMessages(rows: DBMessageRow[]): Message[] {
  return rows
    .filter(
      (row) =>
        row.role === "human" ||
        row.role === "user" ||
        row.role === "assistant",
    )
    .map((row) => ({
      id: String(row.id),
      role:
        row.role === "assistant"
          ? ("assistant" as const)
          : ("user" as const),
      content: row.content,
      isStreaming: false,
      toolCalls: [],
    }));
}

// ---------------------------------------------------------------------------
// Action 类型
// ---------------------------------------------------------------------------

export type ChatAction =
  | { type: "SESSION_READY"; planMode: boolean }
  | { type: "PLAN_MODE_CHANGED"; enabled: boolean }
  | {
      type: "PLAN_APPROVAL_REQUIRED";
      callId: string;
      summary: string;
      proposals: CodeProposal[];
      expiresAt?: string;
    }
  | { type: "PLAN_APPROVAL_RESOLVED"; callId: string }
  | { type: "RUN_STARTED" }
  | { type: "ADD_USER_MESSAGE"; id: string; content: string }
  | { type: "ADD_ASSISTANT_MESSAGE"; id: string }
  | { type: "APPEND_TEXT"; delta: string }
  | {
      type: "TOOL_START";
      callId?: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "TOOL_END";
      callId?: string;
      tool: string;
      result: string;
      ok?: boolean;
      durationMs?: number;
    }
  | {
      type: "CONFIRM_REQUIRED";
      callId: string;
      tool: string;
      args: Record<string, unknown>;
    }
  | {
      type: "APPROVAL_RESOLVED";
      callId: string;
      decision: "approved" | "denied";
      reason?: string;
    }
  | { type: "FINALIZE_ASSISTANT"; id?: string; content: string }
  | { type: "QUESTION_REQUIRED"; question: QuestionPrompt }
  | { type: "QUESTION_RESOLVED"; questionId?: string }
  | { type: "DONE"; finalResponse: string }
  | { type: "ERROR"; message: string }
  | { type: "RESET_MESSAGES" }
  | { type: "LOAD_MESSAGES"; messages: Message[] };

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 生成唯一 ID（crypto.randomUUID 的简化封装） */
function uid(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * 聊天状态 reducer
 *
 * 纯函数：根据 action 类型返回新的 ChatState。
 * 所有修改最新 assistant 消息的操作（APPEND_TEXT、TOOL_START、TOOL_END、
 * CONFIRM_REQUIRED、DONE、ERROR）都需要边界检查 messages.length > 0。
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    // ── 连接就绪：同步服务端会话的计划模式 ──
    case "SESSION_READY":
      return { ...state, planMode: action.planMode };

    case "PLAN_MODE_CHANGED":
      return { ...state, planMode: action.enabled };

    // ── 计划模式：等待用户选择方案 ──
    case "PLAN_APPROVAL_REQUIRED":
      return {
        ...state,
        pendingPlanApproval: {
          callId: action.callId,
          summary: action.summary,
          proposals: action.proposals,
          ...(action.expiresAt ? { expiresAt: action.expiresAt } : {}),
        },
      };

    case "PLAN_APPROVAL_RESOLVED": {
      const pending = state.pendingPlanApproval;
      if (!pending) return state;
      // 重放旧事件时不要清掉当前仍在等待的另一个方案
      if (action.callId && pending.callId !== action.callId) return state;
      return { ...state, pendingPlanApproval: undefined };
    }

    // ── 服务端 run 开始（含重放） ──
    case "RUN_STARTED":
      return { ...state, runStatus: "running" };

    // ── 追加用户消息 ──
    case "ADD_USER_MESSAGE": {
      const userMsg: Message = {
        id: action.id,
        role: "user",
        content: action.content,
        isStreaming: false,
        toolCalls: [],
      };
      return { ...state, messages: [...state.messages, userMsg] };
    }

    // ── 追加空的 assistant 消息（isStreaming: true） ──
    case "ADD_ASSISTANT_MESSAGE": {
      const assistantMsg: Message = {
        id: action.id,
        role: "assistant",
        content: "",
        isStreaming: true,
        toolCalls: [],
      };
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        runStatus: "running",
      };
    }

    // ── 追加文本增量到最新 assistant 消息 ──
    case "APPEND_TEXT": {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = { ...msgs[msgs.length - 1] };
      last.content += action.delta;
      msgs[msgs.length - 1] = last;
      return { ...state, messages: msgs };
    }

    // ── 工具调用开始 ──
    case "TOOL_START": {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = { ...msgs[msgs.length - 1] };
      const toolCall: ToolCallState = {
        ...(action.callId ? { callId: action.callId } : {}),
        tool: action.tool,
        args: action.args,
        status: "running",
      };
      last.toolCalls = [...last.toolCalls, toolCall];
      msgs[msgs.length - 1] = last;
      return { ...state, messages: msgs };
    }

    // ── 工具调用结束（优先按 callId 匹配） ──
    case "TOOL_END": {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = { ...msgs[msgs.length - 1] };
      let idx = action.callId
        ? last.toolCalls.findIndex(
            (toolCall) => toolCall.callId === action.callId,
          )
        : -1;

      if (idx === -1) {
        for (let i = last.toolCalls.length - 1; i >= 0; i--) {
          if (last.toolCalls[i].tool === action.tool) {
            idx = i;
            break;
          }
        }
      }

      if (idx !== -1) {
        const updated = [...last.toolCalls];
        updated[idx] = {
          ...updated[idx],
          result: action.result,
          status: action.ok === false ? "error" : "done",
          ...(action.durationMs !== undefined
            ? { durationMs: action.durationMs }
            : {}),
        };
        last.toolCalls = updated;
      }
      msgs[msgs.length - 1] = last;
      return { ...state, messages: msgs };
    }

    // ── 需要用户确认 ──
    case "CONFIRM_REQUIRED": {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = { ...msgs[msgs.length - 1] };
      const existing = last.toolCalls.findIndex(
        (toolCall) =>
          toolCall.callId === action.callId ||
          (toolCall.tool === action.tool &&
            toolCall.status === "running"),
      );
      const toolCalls = [...last.toolCalls];

      if (existing !== -1) {
        toolCalls[existing] = {
          ...toolCalls[existing],
          status: "awaiting_approval",
          approvalId: action.callId,
        };
      } else {
        toolCalls.push({
          callId: action.callId,
          tool: action.tool,
          args: action.args,
          status: "awaiting_approval",
          approvalId: action.callId,
        });
      }

      last.toolCalls = toolCalls;
      msgs[msgs.length - 1] = last;
      return { ...state, messages: msgs };
    }

    // ── 完成最新 assistant 消息 ──
    case "FINALIZE_ASSISTANT": {
      const msgs = [...state.messages];

      // 服务端重连/切换会话时会重放历史事件，而历史消息已经通过 REST 加载。
      // 按服务端消息 ID 幂等更新，避免同一条消息被追加两次（React key 重复）。
      const existingIndex = action.id
        ? msgs.findIndex((message) => message.id === action.id)
        : -1;
      if (existingIndex !== -1) {
        const existing = msgs[existingIndex];
        msgs[existingIndex] = {
          ...existing,
          content: action.content || existing.content,
          isStreaming: false,
        };
        return { ...state, messages: msgs };
      }

      const last = msgs[msgs.length - 1];
      if (last?.role === "assistant" && last.isStreaming) {
        msgs[msgs.length - 1] = {
          ...last,
          // 与后端消息对齐 ID，后续重复事件即可命中幂等更新
          id: action.id ?? last.id,
          content: action.content || last.content,
          isStreaming: false,
        };
      } else {
        msgs.push({
          id: action.id ?? uid(),
          role: "assistant",
          content: action.content,
          isStreaming: false,
          toolCalls: [],
        });
      }
      return { ...state, messages: msgs };
    }

    // ── 审批已处理（用户操作或历史事件重放） ──
    case "APPROVAL_RESOLVED": {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];

      for (let i = msgs.length - 1; i >= 0; i--) {
        const message = msgs[i];
        const toolIndex = message.toolCalls.findIndex(
          (toolCall) =>
            toolCall.callId === action.callId ||
            toolCall.approvalId === action.callId,
        );
        if (toolIndex === -1) continue;

        const toolCalls = [...message.toolCalls];
        toolCalls[toolIndex] = {
          ...toolCalls[toolIndex],
          status: action.decision === "approved" ? "running" : "error",
          ...(action.decision === "denied"
            ? { result: action.reason ?? "已拒绝" }
            : {}),
        };
        msgs[i] = { ...message, toolCalls };
        return { ...state, messages: msgs };
      }
      return state;
    }

    // ── 用户问题 ──
    case "QUESTION_REQUIRED":
      return { ...state, pendingQuestion: action.question };

    case "QUESTION_RESOLVED":
      // 并发提问时只清理由该 questionId 对应的卡片
      if (
        state.pendingQuestion &&
        action.questionId &&
        state.pendingQuestion.questionId !== action.questionId
      ) {
        return state;
      }
      return { ...state, pendingQuestion: undefined };

    // ── 流式输出完成 ──
    case "DONE": {
      const msgs = [...state.messages];
      const last = msgs[msgs.length - 1];
      // 只更新仍在流式的消息：已完成的消息内容由 message.completed 写入，
      // 重放历史事件时不能把旧消息覆盖成另一次 run 的结果。
      if (last?.role === "assistant" && last.isStreaming) {
        msgs[msgs.length - 1] = {
          ...last,
          isStreaming: false,
          ...(action.finalResponse
            ? { content: action.finalResponse }
            : {}),
        };
      } else if (last?.role !== "assistant" && action.finalResponse) {
        msgs.push({
          id: uid(),
          role: "assistant",
          content: action.finalResponse,
          isStreaming: false,
          toolCalls: [],
        });
      }
      return {
        ...state,
        messages: msgs,
        pendingQuestion: undefined,
        pendingPlanApproval: undefined,
        runStatus: "completed",
      };
    }

    // ── 错误 ──
    case "ERROR": {
      const errMsg: Message = {
        id: uid(),
        role: "assistant",
        content: `❌ ${action.message}`,
        isStreaming: false,
        toolCalls: [],
      };
      // 将前一条未完成的 assistant 消息标记为完成
      const msgs = state.messages.map((m, i) => {
        if (i === state.messages.length - 1 && m.isStreaming) {
          return { ...m, isStreaming: false };
        }
        return m;
      });
      return {
        ...state,
        messages: [...msgs, errMsg],
        pendingQuestion: undefined,
        pendingPlanApproval: undefined,
        runStatus: "failed",
      };
    }

    // ── 清空消息（切换会话时使用） ──
    case "RESET_MESSAGES": {
      return {
        ...state,
        messages: [],
        pendingQuestion: undefined,
        pendingPlanApproval: undefined,
        runStatus: "idle",
      };
    }

    // ── 加载历史消息 ──
    case "LOAD_MESSAGES": {
      // 历史请求是异步的，期间可能已经收到 WebSocket 实时/重放事件。
      // 以历史快照为底，保留其中没有的消息，避免把刚完成的回复覆盖掉。
      const historyIds = new Set(action.messages.map((message) => message.id));
      const liveMessages = state.messages.filter(
        (message) => !historyIds.has(message.id),
      );
      // 不清空 pendingQuestion：加载期间到达的提问需要继续展示
      return {
        ...state,
        messages: [...action.messages, ...liveMessages],
      };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** 初始聊天状态 */
const initialChatState: ChatState = { messages: [], planMode: true };

/**
 * useChatStore hook
 *
 * 封装 useReducer，提供便捷的 dispatch 方法。
 * 在 ChatArea 中使用，从 WebSocket onMessage 回调 dispatch action。
 *
 * @example
 * ```tsx
 * const { state, dispatch } = useChatStore();
 * dispatch({ type: "APPEND_TEXT", delta: "Hello" });
 * ```
 */
export function useChatStore() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  return { state, dispatch } as const;
}
