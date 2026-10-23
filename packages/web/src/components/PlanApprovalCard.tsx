/**
 * 计划模式方案确认模态框
 *
 * 展示 agent 只读调研后提交的 1-4 个改进方案，用户可多选后批准，
 * 或填写反馈后拒绝。方案详情默认折叠，避免内容过多撑满屏幕。
 */

import { useEffect, useState } from "react";
import type { CodeProposal } from "@code-agent/protocol";

export interface PlanApprovalCardProps {
  callId: string;
  summary: string;
  proposals: CodeProposal[];
  expiresAt?: string;
  disabled?: boolean;
  /** 是否收起到聊天底部的悬浮条 */
  minimized?: boolean;
  onMinimize?: () => void;
  onRestore?: () => void;
  onApprove: (callId: string, selectedProposalIds: string[]) => void;
  onReject: (callId: string, feedback: string) => void;
}

const EFFORT_LABEL: Record<string, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

/** 统计方案涉及的文件数与修改点数 */
function describeScope(proposal: CodeProposal): string {
  const changes = proposal.files.reduce(
    (sum, file) => sum + file.changes.length,
    0,
  );
  return `${proposal.files.length} 个文件 · ${changes} 处修改`;
}

export function PlanApprovalCard({
  callId,
  summary,
  proposals,
  expiresAt,
  disabled,
  minimized,
  onMinimize,
  onRestore,
  onApprove,
  onReject,
}: PlanApprovalCardProps) {
  const defaultId =
    proposals.find((proposal) => proposal.recommended)?.id ??
    proposals[0]?.id;
  const [selected, setSelected] = useState<string[]>(
    defaultId ? [defaultId] : [],
  );
  const [feedback, setFeedback] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const toggleExpanded = (id: string) => {
    setExpanded((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  // 模态框打开时锁定背景滚动，避免内外两层滚动叠加
  useEffect(() => {
    if (minimized) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [minimized]);

  // Esc 收起而不是拒绝，避免误操作丢掉方案
  useEffect(() => {
    if (minimized) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMinimize?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [minimized, onMinimize]);

  if (minimized) {
    return (
      <div className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-lg border border-purple-500/40 bg-purple-500/10 px-4 py-2">
        <div className="min-w-0">
          <span className="text-sm text-purple-100">
            计划待确认：{proposals.length} 个方案
          </span>
          <span className="ml-2 text-xs text-gray-400">
            批准后在同一轮任务中执行
          </span>
        </div>
        <button
          type="button"
          onClick={onRestore}
          className="shrink-0 rounded-md border border-purple-500/50 px-3 py-1 text-xs text-purple-200 hover:bg-purple-500/10"
        >
          查看方案
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
      onClick={onMinimize}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-approval-title"
        className="flex h-[min(85dvh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-purple-500/40 bg-gray-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* ── 固定头部 ── */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-800 px-5 py-3">
          <div>
            <h3
              id="plan-approval-title"
              className="text-base font-semibold text-purple-200"
            >
              计划确认
            </h3>
            <p className="mt-0.5 text-xs text-gray-500">
              选择一个或多个方案后批准，Agent 将在同一轮任务中执行
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {expiresAt && (
              <span className="text-[11px] text-gray-500">
                截止 {new Date(expiresAt).toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={onMinimize}
              className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
            >
              最小化
            </button>
          </div>
        </div>

        {/* ── 唯一滚动区域 ── */}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <p className="mb-3 whitespace-pre-wrap break-words text-sm text-gray-200">
            {summary}
          </p>

          <div className="space-y-2">
            {proposals.map((proposal) => {
              const checked = selected.includes(proposal.id);
              const isExpanded = expanded.includes(proposal.id);
              return (
                <div
                  key={proposal.id}
                  className={`rounded-md border p-3 transition-colors ${
                    checked
                      ? "border-purple-400 bg-purple-500/10"
                      : "border-gray-700 bg-gray-900/60 hover:border-gray-600"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      id={`proposal-${proposal.id}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(proposal.id)}
                      className="mt-1 h-4 w-4 cursor-pointer accent-purple-500"
                    />
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={`proposal-${proposal.id}`}
                        className="block cursor-pointer"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-100">
                            {proposal.title}
                          </span>
                          {proposal.recommended && (
                            <span className="rounded bg-purple-600/30 px-1.5 py-0.5 text-[10px] text-purple-200">
                              推荐
                            </span>
                          )}
                          {proposal.effort && (
                            <span className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300">
                              工作量：
                              {EFFORT_LABEL[proposal.effort] ?? proposal.effort}
                            </span>
                          )}
                        </div>

                        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-400">
                          {proposal.summary}
                        </p>
                      </label>

                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-gray-500">
                          {describeScope(proposal)}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(proposal.id)}
                          aria-expanded={isExpanded}
                          className="shrink-0 text-[11px] text-purple-300 hover:text-purple-200"
                        >
                          {isExpanded ? "收起详情" : "展开详情"}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="mt-2 space-y-2 border-t border-gray-800 pt-2">
                          <ul className="space-y-1.5">
                            {proposal.files.map((file) => (
                              <li
                                key={file.path}
                                className="text-xs text-gray-300"
                              >
                                <span className="break-all font-mono text-gray-200">
                                  {file.path}
                                </span>
                                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-gray-500">
                                  {file.changes.map((change, index) => (
                                    <li key={index} className="break-words">
                                      {change}
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                          </ul>

                          {proposal.rationale && (
                            <p className="break-words text-xs text-gray-400">
                              理由：{proposal.rationale}
                            </p>
                          )}
                          {proposal.risks && (
                            <p className="break-words text-xs text-amber-400/90">
                              风险：{proposal.risks}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── 固定底部操作区 ── */}
        <div className="shrink-0 border-t border-gray-800 px-5 py-3">
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            rows={2}
            placeholder="拒绝时说明原因，或补充对方案的要求（可选）"
            className="scrollbar-thin mb-3 w-full resize-none rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-purple-500 focus:outline-none"
          />

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">
              已选 {selected.length} 个方案
            </span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => onReject(callId, feedback.trim())}
                disabled={disabled}
                className="rounded-md bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-100 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                拒绝并反馈
              </button>
              <button
                type="button"
                onClick={() => onApprove(callId, selected)}
                disabled={disabled || selected.length === 0}
                className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                批准并执行
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
