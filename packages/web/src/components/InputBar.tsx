/**
 * InputBar 组件 —— 消息输入框
 *
 * 支持：
 * - Enter 发送（无 Shift）
 * - Shift+Enter 换行
 * - 发送后自动清空并聚焦
 * - 内容为空或 disabled 时禁用发送按钮
 * - WebSocket 断开时 disabled
 */

import { useState, useRef, useCallback, type KeyboardEvent } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InputBarProps {
  /** 发送消息回调 */
  onSend: (content: string) => void;
  /** 是否禁用（WebSocket 未连接时应禁用） */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * InputBar
 *
 * 固定在底部的消息输入区域，包含 textarea 和 Send 按钮。
 * 使用 ref 管理焦点，发送后自动聚焦。
 *
 * @example
 * ```tsx
 * <InputBar onSend={handleSend} disabled={status !== "connected"} />
 * ```
 */
export function InputBar({ onSend, disabled }: InputBarProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── 发送消息 ──
  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // 发送后聚焦输入框
    textareaRef.current?.focus();
  }, [value, disabled, onSend]);

  // ── 键盘事件处理 ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter 发送（不按 Shift）
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Shift+Enter 换行：使用默认行为，不处理
    },
    [handleSend],
  );

  return (
    <div className="border-t border-gray-700 bg-gray-900 px-4 py-3">
      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        {/* 文本输入 */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={2}
          placeholder={
            disabled ? "Connecting..." : "Type a message... (Enter to send, Shift+Enter for new line)"
          }
          className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />

        {/* 发送按钮 */}
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || value.trim().length === 0}
          className="shrink-0 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
