/**
 * ConfirmCard 组件 —— 审批确认卡片
 *
 * 黄色警告风格卡片，用于展示需要用户审批的工具调用。
 * 用户点击 Approve 或 Deny 按钮后回调 onApprove。
 */

import type { ToolCallState } from "../stores/chatStore.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConfirmCardProps {
  /** 工具调用状态（含 callId） */
  toolCall: ToolCallState;
  /** 审批回调：true=批准，false=拒绝 */
  onApprove: (callId: string, approved: boolean) => void;
  /** 是否正在提交审批结果 */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 安全 JSON 格式化 */
function safeJsonFormat(value: Record<string, unknown> | undefined): string {
  if (!value) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * ConfirmCard
 *
 * 黄色/amber 警告风格的审批卡片：
 * - 显示工具名称和参数
 * - Approve（绿色）/ Deny（红色）两个按钮
 * - 点击后调用 onApprove(callId, approved)
 *
 * @example
 * ```tsx
 * <ConfirmCard
 *   toolCall={{ tool: "delete_file", args: {...}, status: "awaiting_approval", callId: "abc" }}
 *   onApprove={(callId, approved) => ws.approve(callId, approved)}
 * />
 * ```
 */
export function ConfirmCard({ toolCall, onApprove, disabled }: ConfirmCardProps) {
  const handleApprove = () => {
    if (toolCall.callId) {
      onApprove(toolCall.callId, true);
    }
  };

  const handleDeny = () => {
    if (toolCall.callId) {
      onApprove(toolCall.callId, false);
    }
  };

  return (
    <div className="my-2 rounded-lg border-2 border-yellow-600 bg-yellow-900/20 overflow-hidden">
      {/* ── 标题 ── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/30 border-b border-yellow-700/50">
        <span className="text-base" aria-hidden="true">
          ⚠️
        </span>
        <span className="text-sm font-semibold text-yellow-300">
          Confirm Action:{" "}
          <span className="text-yellow-100 font-mono">{toolCall.tool}</span>
        </span>
      </div>

      {/* ── 参数展示 ── */}
      <div className="px-3 py-2">
        <h4 className="text-xs font-semibold text-gray-400 mb-1">
          Arguments
        </h4>
        <pre className="text-xs text-yellow-100/80 bg-gray-900/70 rounded p-2 overflow-x-auto max-h-32">
          {safeJsonFormat(toolCall.args)}
        </pre>
      </div>

      {/* ── 操作按钮 ── */}
      <div className="flex gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={handleApprove}
          disabled={disabled}
          className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
        >
          ✅ Approve
        </button>
        <button
          type="button"
          onClick={handleDeny}
          disabled={disabled}
          className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
        >
          ❌ Deny
        </button>
      </div>
    </div>
  );
}
