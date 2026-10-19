/**
 * 长期记忆管理 / 审核面板
 */

import { useCallback, useEffect, useState } from "react";
import type { MemoryRecord, MemoryStatus } from "@code-agent/protocol";
import {
  deleteMemory,
  fetchMemories,
  searchMemories,
  updateMemory,
} from "../api/memory.js";

export interface MemoryPanelProps {
  onClose: () => void;
}

type FilterStatus = "pending_review" | "active" | "archived" | "all";

function statusLabel(status: MemoryStatus): string {
  switch (status) {
    case "active":
      return "已生效";
    case "pending_review":
      return "待审核";
    case "archived":
      return "已归档";
  }
}

function statusClass(status: MemoryStatus): string {
  switch (status) {
    case "active":
      return "bg-green-500/10 text-green-300 border-green-500/30";
    case "pending_review":
      return "bg-yellow-500/10 text-yellow-300 border-yellow-500/30";
    case "archived":
      return "bg-gray-500/10 text-gray-400 border-gray-600";
  }
}

export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const [status, setStatus] = useState<FilterStatus>("pending_review");
  const [query, setQuery] = useState("");
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const records = query.trim()
        ? await searchMemories(query.trim())
        : await fetchMemories({
            ...(status === "all" ? {} : { status }),
            limit: 200,
          });
      setMemories(records);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(
    async (
      id: string,
      patch: {
        status?: MemoryStatus;
        pinned?: boolean;
      },
    ) => {
      try {
        await updateMemory(id, patch);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm("确定删除这条记忆？")) return;
      try {
        await deleteMemory(id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-100">
              长期记忆
            </h2>
            <p className="text-xs text-gray-500">
              审核自动提炼的记忆，或删除不准确的内容
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-700 px-2 py-1 text-sm text-gray-300 hover:bg-gray-800"
          >
            关闭
          </button>
        </div>

        <div className="flex gap-2 border-b border-gray-800 px-5 py-3">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load();
            }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索记忆..."
              className="flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-800"
            >
              搜索
            </button>
          </form>

          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as FilterStatus)
            }
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-200"
          >
            <option value="pending_review">待审核</option>
            <option value="active">已生效</option>
            <option value="archived">已归档</option>
            <option value="all">全部</option>
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error && (
            <p className="mb-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-300">
              {error}
            </p>
          )}
          {loading ? (
            <p className="text-sm text-gray-500">加载中...</p>
          ) : memories.length === 0 ? (
            <p className="text-sm text-gray-500">(没有符合条件的记忆)</p>
          ) : (
            <div className="space-y-3">
              {memories.map((memory) => (
                <div
                  key={memory.id}
                  className="rounded-lg border border-gray-800 bg-gray-950 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`rounded border px-1.5 py-0.5 ${statusClass(
                        memory.status,
                      )}`}
                    >
                      {statusLabel(memory.status)}
                    </span>
                    <span className="text-gray-500">
                      [{memory.scope}] {memory.kind}
                    </span>
                    <span className="text-gray-500">
                      置信度 {(memory.confidence * 100).toFixed(0)}%
                    </span>
                    {memory.pinned && (
                      <span className="text-blue-300">📌 已置顶</span>
                    )}
                    <span className="text-gray-600">
                      {new Date(memory.updatedAt).toLocaleString()}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap text-sm text-gray-200">
                    {memory.content}
                  </p>

                  {memory.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {memory.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    {memory.status === "pending_review" && (
                      <button
                        type="button"
                        onClick={() =>
                          void apply(memory.id, { status: "active" })
                        }
                        className="rounded bg-green-600/80 px-2 py-1 text-xs text-white hover:bg-green-500"
                      >
                        通过
                      </button>
                    )}
                    {memory.status !== "archived" && (
                      <button
                        type="button"
                        onClick={() =>
                          void apply(memory.id, { status: "archived" })
                        }
                        className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
                      >
                        归档
                      </button>
                    )}
                    {memory.status === "archived" && (
                      <button
                        type="button"
                        onClick={() =>
                          void apply(memory.id, { status: "active" })
                        }
                        className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
                      >
                        恢复
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void apply(memory.id, { pinned: !memory.pinned })
                      }
                      className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
                    >
                      {memory.pinned ? "取消置顶" : "置顶"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(memory.id)}
                      className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
