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

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 工具调用状态枚举 */
export type ToolCallStatus = "running" | "done" | "error" | "awaiting_approval";

/** 单条工具调用状态 */
export interface ToolCallState {
  /** 通过 tool 名称匹配（WS 事件中不传 id） */
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  status: ToolCallStatus;
  /** 审批回调 ID（仅 awaiting_approval 状态时有值） */
  callId?: string;
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

/** 整个聊天状态 */
export interface ChatState {
  messages: Message[];
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
  id: number;
  sessionId: string;
  role: "human" | "assistant" | "system" | "tool";
  content: string;
  toolName: string | null;
  toolArgs: string | null;
  toolResult: string | null;
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
    .filter((row) => row.role === "human" || row.role === "assistant")
    .map((row) => ({
      id: String(row.id),
      role: (row.role === "human" ? "user" : "assistant") as "user" | "assistant",
      content: row.content,
      isStreaming: false,
      toolCalls: [],
    }));
}

// ---------------------------------------------------------------------------
// Action 类型
// ---------------------------------------------------------------------------

export type ChatAction =
  | { type: "ADD_USER_MESSAGE"; id: string; content: string }
  | { type: "ADD_ASSISTANT_MESSAGE"; id: string }
  | { type: "APPEND_TEXT"; delta: string }
  | { type: "TOOL_START"; tool: string; args: Record<string, unknown> }
  | { type: "TOOL_END"; tool: string; result: string }
  | { type: "CONFIRM_REQUIRED"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "DONE"; finalResponse: string }
  | { type: "ERROR"; message: string }
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
      return { ...state, messages: [...state.messages, assistantMsg] };
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
        tool: action.tool,
        args: action.args,
        status: "running",
      };
      last.toolCalls = [...last.toolCalls, toolCall];
      msgs[msgs.length - 1] = last;
      return { ...state, messages: msgs };
    }

    // ── 工具调用结束（通过 tool 名称匹配） ──
    case "TOOL_END": {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = { ...msgs[msgs.length - 1] };
      // 从后往前查找匹配的 tool call（同名称取最近的）
      // 使用手动反向遍历代替 Array.findLastIndex（需要 ES2023+）
      let idx = -1;
      for (let i = last.toolCalls.length - 1; i >= 0; i--) {
        if (last.toolCalls[i].tool === action.tool) {
          idx = i;
          break;
        }
      }
      if (idx !== -1) {
        const updated = [...last.toolCalls];
        updated[idx] = {
          ...updated[idx],
          result: action.result,
          status: "done",
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
      const toolCall: ToolCallState = {
        tool: action.tool,
        args: action.args,
        status: "awaiting_approval",
        callId: action.callId,
      };
      last.toolCalls = [...last.toolCalls, toolCall];
      msgs[msgs.length - 1] = last;
      return { ...state, messages: msgs };
    }

    // ── 流式输出完成 ──
    case "DONE": {
      if (state.messages.length === 0) return state;
      const msgs = [...state.messages];
      const last = { ...msgs[msgs.length - 1] };
      last.isStreaming = false;
      // finalResponse 为空时保留已流式累积的 content
      if (action.finalResponse) {
        last.content = action.finalResponse;
      }
      msgs[msgs.length - 1] = last;
      return { ...state, messages: msgs };
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
      return { ...state, messages: [...msgs, errMsg] };
    }

    // ── 批量加载历史消息（替换整个 messages 数组） ──
    case "LOAD_MESSAGES": {
      return { ...state, messages: action.messages };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** 初始聊天状态 */
const initialChatState: ChatState = { messages: [] };

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
