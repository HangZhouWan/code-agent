/**
 * MessageList 组件 —— 消息列表
 *
 * 按消息列表渲染，每条消息包含：
 * 1. TextMessage：Markdown 内容
 * 2. 该消息关联的 toolCalls：
 *    - status === "awaiting_approval" → ConfirmCard
 *    - 其他 → ToolCallCard
 *
 * 布局：
 * - user 消息右对齐（bg-blue-600）
 * - assistant 消息左对齐（bg-gray-800）
 * - 最大宽度 80%
 */

import type { Message } from "../stores/chatStore.js";
import { TextMessage } from "./TextMessage.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { ConfirmCard } from "./ConfirmCard.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MessageListProps {
  /** 消息列表 */
  messages: Message[];
  /** 审批回调（转发到 useWebSocket.approve） */
  onApprove: (callId: string, approved: boolean) => void;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * MessageList
 *
 * 渲染消息列表，区分用户/助手消息样式。
 *
 * @example
 * ```tsx
 * <MessageList messages={state.messages} onApprove={ws.approve} />
 * ```
 */
export function MessageList({ messages, onApprove }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>Send a message to start the conversation.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} onApprove={onApprove} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 单条消息气泡
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: Message;
  onApprove: (callId: string, approved: boolean) => void;
}

function MessageBubble({ message, onApprove }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-800 text-gray-100 border border-gray-700/50"
        }`}
      >
        {/* ── 消息文本（使用 prose-invert 仅在 assistant 消息上） ── */}
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap break-words">
            {message.content}
          </p>
        ) : (
          <TextMessage
            content={message.content}
            isStreaming={message.isStreaming}
          />
        )}

        {/* ── 工具调用卡片 ── */}
        {message.toolCalls.length > 0 && (
          <div className="mt-2 border-t border-gray-700/50 pt-2">
            {message.toolCalls.map((tc, idx) => {
              if (tc.status === "awaiting_approval") {
                return (
                  <ConfirmCard
                    key={tc.callId ?? `confirm-${idx}`}
                    toolCall={tc}
                    onApprove={onApprove}
                  />
                );
              }
              return (
                <ToolCallCard
                  key={`${tc.tool}-${idx}`}
                  toolCall={tc}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
