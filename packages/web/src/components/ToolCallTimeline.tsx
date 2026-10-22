/**
 * ToolCallTimeline —— 一条消息内所有工具调用的紧凑时间线
 *
 * 默认展示最近 N 条，更早的调用折叠为一行提示；
 * 整组也可以收起，避免长任务把聊天区堆满。
 */

import { useState } from "react";
import type { ToolCallState } from "../stores/chatStore.js";
import { ToolCallCard } from "./ToolCallCard.js";

export interface ToolCallTimelineProps {
  toolCalls: ToolCallState[];
  /** 默认展示的最近调用条数 */
  recentLimit?: number;
}

export function ToolCallTimeline({
  toolCalls,
  recentLimit = 5,
}: ToolCallTimelineProps) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const errors = toolCalls.filter(
    (toolCall) => toolCall.status === "error",
  ).length;
  const hiddenCount = Math.max(0, toolCalls.length - recentLimit);
  const visibleCalls =
    showAll || hiddenCount === 0
      ? toolCalls
      : toolCalls.slice(toolCalls.length - recentLimit);

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-gray-700/50 bg-gray-900/40">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="shrink-0 text-[10px] text-gray-500">
            {open ? "▾" : "▸"}
          </span>
          <span className="text-xs font-medium text-gray-300">
            工具调用 · {toolCalls.length} 次
          </span>
          {errors > 0 && (
            <span className="text-[11px] text-red-400">
              {errors} 个失败
            </span>
          )}
        </button>

        {open && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="shrink-0 text-[11px] text-blue-300 hover:text-blue-200"
          >
            {showAll
              ? `只看最近 ${recentLimit} 条`
              : `还有 ${hiddenCount} 条更早的调用`}
          </button>
        )}
      </div>

      {open && (
        <div className="divide-y divide-gray-700/40 border-t border-gray-700/40">
          {visibleCalls.map((toolCall, index) => (
            <ToolCallCard
              key={toolCall.callId ?? `${toolCall.tool}-${index}`}
              toolCall={toolCall}
            />
          ))}
        </div>
      )}
    </div>
  );
}
