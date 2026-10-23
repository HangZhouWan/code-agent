/**
 * InputBar 组件 —— 消息输入框
 *
 * 支持：
 * - Enter 发送（无 Shift）
 * - Shift+Enter 换行
 * - 输入法组合（选词）期间按 Enter 不触发发送
 * - 发送后自动清空并聚焦
 * - 内容为空、WebSocket 断开或 Agent 思考中时禁用发送按钮
 * - Agent 思考中时 Send 按钮切换为 Stop，可中断当前 run
 */

import { useState, useRef, useCallback, type KeyboardEvent } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InputBarProps {
  /** 发送消息回调 */
  onSend: (content: string) => void;
  /** 是否禁用输入（WebSocket 未连接或等待用户回答时） */
  disabled?: boolean;
  /** Agent 是否正在思考/响应中；为 true 时按钮切换为 Stop */
  isStreaming?: boolean;
  /** 停止当前 run 回调 */
  onStop?: () => void;
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
 * <InputBar
 *   onSend={handleSend}
 *   onStop={handleStop}
 *   disabled={status !== "connected"}
 *   isStreaming={isStreaming}
 * />
 * ```
 */
export function InputBar({
  onSend,
  disabled,
  isStreaming = false,
  onStop,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 输入法是否处于组合状态（用 ref 避免异步 state 造成的时序问题）
  const composingRef = useRef(false);

  // 流式期间禁止编辑/发送，但仍允许点击 Stop
  const inputDisabled = disabled || isStreaming;

  // ── 发送消息 ──
  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || inputDisabled) return;
    onSend(trimmed);
    setValue("");
    // 发送后聚焦输入框
    textareaRef.current?.focus();
  }, [value, inputDisabled, onSend]);

  // ── 停止当前 run ──
  const handleStop = useCallback(() => {
    if (disabled) return;
    onStop?.();
  }, [disabled, onStop]);

  // ── 键盘事件处理 ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Shift+Enter 交给浏览器换行
      if (e.key !== "Enter" || e.shiftKey) return;

      // 中文/日文等输入法选词阶段按 Enter 只是确认候选词：
      // - composingRef：compositionstart ~ compositionend 之间
      // - isComposing：Chrome/Firefox 的键盘事件标记
      // - keyCode 229：Safari 等浏览器在 IME 处理期间的标记
      if (
        composingRef.current ||
        e.nativeEvent.isComposing ||
        e.nativeEvent.keyCode === 229
      ) {
        return;
      }

      e.preventDefault();
      handleSend();
    },
    [handleSend],
  );

  // ── 占位文案 ──
  const placeholder = inputDisabled
    ? "Agent is thinking..."
    : "Type a message... (Enter to send, Shift+Enter for new line)";

  return (
    <div className="border-t border-gray-700 bg-gray-900 px-4 py-3">
      <div className="flex items-end gap-2 max-w-4xl mx-auto">
        {/* 文本输入 */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          disabled={inputDisabled}
          rows={2}
          placeholder={placeholder}
          className="flex-1 resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        />

        {/* 流式中显示 Stop，否则显示 Send */}
        {isStreaming ? (
          <button
            type="button"
            onClick={handleStop}
            disabled={disabled || !onStop}
            className="shrink-0 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || value.trim().length === 0}
            className="shrink-0 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
