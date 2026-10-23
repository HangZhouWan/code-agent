/**
 * ToolCallCard —— 工具调用紧凑行
 *
 * 默认只占一行：状态、工具名、关键参数、耗时。
 * 点击后才展开完整参数与结果，避免多次工具调用堆满聊天区。
 */

import { useState } from "react";
import type { ToolCallState } from "../stores/chatStore.js";

export interface ToolCallCardProps {
  /** 工具调用状态 */
  toolCall: ToolCallState;
}

const STATUS_CONFIG: Record<
  ToolCallState["status"],
  { icon: string; label: string; textColor: string }
> = {
  running: {
    icon: "⏳",
    label: "Running",
    textColor: "text-gray-400",
  },
  done: {
    icon: "✅",
    label: "Done",
    textColor: "text-green-400",
  },
  error: {
    icon: "❌",
    label: "Error",
    textColor: "text-red-400",
  },
  awaiting_approval: {
    icon: "⚠️",
    label: "Awaiting Approval",
    textColor: "text-yellow-300",
  },
};

/** 截断字符串到指定长度 */
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

function stringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 提取一行参数摘要，让用户不展开也能看懂这次调用做了什么。
 *
 * 输入：工具名与参数
 * 输出：单行摘要；没有可用参数时返回空串
 */
export function summarizeToolArgs(
  tool: string,
  args: Record<string, unknown>,
): string {
  const path = stringArg(args, "path");
  switch (tool) {
    case "file_read":
    case "file_write":
    case "file_edit":
      return path ?? "";
    case "file_list":
    case "file_glob":
      return path ?? stringArg(args, "pattern") ?? "";
    case "code_search":
      return (
        stringArg(args, "query") ??
        stringArg(args, "pattern") ??
        stringArg(args, "q") ??
        ""
      );
    case "shell_exec":
    case "run_tests":
      return stringArg(args, "command") ?? stringArg(args, "cmd") ?? "";
    case "git_add":
    case "git_diff":
    case "git_status":
      return path ?? "";
    case "git_commit":
      return stringArg(args, "message") ?? "";
    case "git_branch":
      return stringArg(args, "branch") ?? stringArg(args, "name") ?? "";
    case "delegate_task":
      return [stringArg(args, "role"), stringArg(args, "description")]
        .filter(Boolean)
        .join(" ");
    case "ask_user":
      return stringArg(args, "question") ?? "";
    case "submit_proposals": {
      const proposals = args.proposals;
      return Array.isArray(proposals)
        ? `${proposals.length} 个方案`
        : "";
    }
    default: {
      const first = Object.entries(args).find(
        ([, value]) => typeof value === "string" && value.length > 0,
      );
      return first ? String(first[1]) : "";
    }
  }
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[toolCall.status];
  const summary = summarizeToolArgs(toolCall.tool, toolCall.args);

  return (
    <div className="text-xs">
      {/* ── 单行摘要 ── */}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        <span className="shrink-0" aria-hidden="true">
          {cfg.icon}
        </span>
        <span className="shrink-0 font-medium text-blue-400">
          {toolCall.tool}
        </span>
        {summary ? (
          <span
            className="min-w-0 flex-1 truncate font-mono text-gray-500"
            title={summary}
          >
            {summary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <span className={`shrink-0 text-[11px] ${cfg.textColor}`}>
          {cfg.label}
        </span>
        {toolCall.durationMs !== undefined && (
          <span className="shrink-0 text-[11px] text-gray-600">
            {toolCall.durationMs}ms
          </span>
        )}
        <span className="shrink-0 text-[10px] text-gray-600">
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* ── 展开的详情 ── */}
      {expanded && (
        <div className="border-t border-gray-700/40 bg-gray-950/40 px-3 py-2">
          <h4 className="mb-1 text-[11px] font-semibold text-gray-400">
            Arguments
          </h4>
          <pre className="scrollbar-thin max-h-32 overflow-auto rounded bg-gray-900/60 p-2 text-[11px] text-gray-300">
            {truncate(safeJsonFormat(toolCall.args), 500)}
          </pre>

          {(toolCall.status === "done" || toolCall.status === "error") &&
            toolCall.result !== undefined && (
              <div className="mt-2">
                <h4 className="mb-1 text-[11px] font-semibold text-gray-400">
                  Result
                </h4>
                <pre className="scrollbar-thin max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-900/60 p-2 text-[11px] text-gray-300">
                  {truncate(toolCall.result, 500)}
                </pre>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
