/**
 * ToolCallCard 组件 —— 工具调用状态可视化
 *
 * 展示工具调用的名称、参数、状态和结果。
 * 支持三态显示：running / done / error。
 *
 * 状态  | 图标 | 色彩
 * -------|------|------
 * running | ⏳  | gray
 * done    | ✅  | blue
 * error   | ❌  | red
 */

import { useState } from "react";
import type { ToolCallState } from "../stores/chatStore.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ToolCallCardProps {
  /** 工具调用状态 */
  toolCall: ToolCallState;
}

// ---------------------------------------------------------------------------
// 状态配置
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  ToolCallState["status"],
  { icon: string; label: string; borderColor: string; bgColor: string }
> = {
  running: {
    icon: "⏳",
    label: "Running",
    borderColor: "border-gray-600",
    bgColor: "bg-gray-800/50",
  },
  done: {
    icon: "✅",
    label: "Done",
    borderColor: "border-blue-600",
    bgColor: "bg-blue-900/20",
  },
  error: {
    icon: "❌",
    label: "Error",
    borderColor: "border-red-600",
    bgColor: "bg-red-900/20",
  },
  awaiting_approval: {
    icon: "⚠️",
    label: "Awaiting Approval",
    borderColor: "border-yellow-600",
    bgColor: "bg-yellow-900/20",
  },
};

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 截断字符串到指定长度，超出部分用 ... 替换 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

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
 * ToolCallCard
 *
 * 可展开/折叠的工具调用卡片，显示参数摘要和完整结果。
 *
 * @example
 * ```tsx
 * <ToolCallCard toolCall={{ tool: "read_file", args: {...}, status: "running" }} />
 * ```
 */
export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[toolCall.status];

  return (
    <div
      className={`my-2 rounded-lg border ${cfg.borderColor} ${cfg.bgColor} overflow-hidden`}
    >
      {/* ── 摘要行（始终可见，可点击展开） ── */}
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-sm" aria-hidden="true">
          {cfg.icon}
        </span>
        <span className="text-sm font-medium text-blue-400">
          {toolCall.tool}
        </span>
        <span className="text-xs text-gray-500 ml-auto">{cfg.label}</span>
        <span className="text-xs text-gray-600">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* ── 展开的详情 ── */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-700/50">
          {/* 参数 */}
          <div className="mt-2">
            <h4 className="text-xs font-semibold text-gray-400 mb-1">
              Arguments
            </h4>
            <pre className="text-xs text-gray-300 bg-gray-900/50 rounded p-2 overflow-x-auto max-h-32">
              {truncate(safeJsonFormat(toolCall.args), 500)}
            </pre>
          </div>

          {/* 结果（仅 done 或 error 时显示） */}
          {(toolCall.status === "done" || toolCall.status === "error") &&
            toolCall.result !== undefined && (
              <div className="mt-2">
                <h4 className="text-xs font-semibold text-gray-400 mb-1">
                  Result
                </h4>
                <pre className="text-xs text-gray-300 bg-gray-900/50 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                  {truncate(toolCall.result, 500)}
                </pre>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
