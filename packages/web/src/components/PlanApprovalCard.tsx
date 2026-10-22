/**
 * 计划模式方案确认卡片
 *
 * 展示 agent 只读调研后提交的 1-4 个改进方案，用户可多选后批准，
 * 或填写反馈后拒绝。方案只包含文件与修改点，不包含代码预览。
 */

import { useState } from "react";
import type { CodeProposal } from "@code-agent/protocol";

export interface PlanApprovalCardProps {
  callId: string;
  summary: string;
  proposals: CodeProposal[];
  expiresAt?: string;
  disabled?: boolean;
  onApprove: (callId: string, selectedProposalIds: string[]) => void;
  onReject: (callId: string, feedback: string) => void;
}

const EFFORT_LABEL: Record<string, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

export function PlanApprovalCard({
  callId,
  summary,
  proposals,
  expiresAt,
  disabled,
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

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  return (
    <div className="mx-auto mb-3 flex max-h-[55dvh] w-[calc(100%-2rem)] max-w-4xl flex-col rounded-lg border border-purple-500/40 bg-purple-500/5 p-4">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-purple-200">
          计划确认：选择要执行的方案
        </h3>
        {expiresAt && (
          <span className="text-[11px] text-gray-500">
            截止 {new Date(expiresAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      <p className="mb-3 shrink-0 whitespace-pre-wrap break-words text-sm text-gray-200">
        {summary}
      </p>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {proposals.map((proposal) => {
          const checked = selected.includes(proposal.id);
          return (
            <label
              key={proposal.id}
              className={`block cursor-pointer rounded-md border p-3 transition-colors ${
                checked
                  ? "border-purple-400 bg-purple-500/10"
                  : "border-gray-700 bg-gray-900/60 hover:border-gray-600"
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(proposal.id)}
                  className="mt-1 h-4 w-4 cursor-pointer accent-purple-500"
                />
                <div className="min-w-0 flex-1">
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
                        工作量：{EFFORT_LABEL[proposal.effort] ?? proposal.effort}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-400">
                    {proposal.summary}
                  </p>

                  <ul className="mt-2 space-y-1.5">
                    {proposal.files.map((file) => (
                      <li key={file.path} className="text-xs text-gray-300">
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
                    <p className="mt-2 break-words text-xs text-gray-400">
                      理由：{proposal.rationale}
                    </p>
                  )}
                  {proposal.risks && (
                    <p className="mt-1 break-words text-xs text-amber-400/90">
                      风险：{proposal.risks}
                    </p>
                  )}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        rows={2}
        placeholder="拒绝时说明原因，或补充对方案的要求（可选）"
        className="mt-3 w-full shrink-0 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-purple-500 focus:outline-none"
      />

      <div className="mt-3 flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => onApprove(callId, selected)}
          disabled={disabled || selected.length === 0}
          className="flex-1 rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          批准并执行
        </button>
        <button
          type="button"
          onClick={() => onReject(callId, feedback.trim())}
          disabled={disabled}
          className="flex-1 rounded-md bg-gray-700 px-4 py-2 text-sm font-semibold text-gray-100 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          拒绝并反馈
        </button>
      </div>
    </div>
  );
}
