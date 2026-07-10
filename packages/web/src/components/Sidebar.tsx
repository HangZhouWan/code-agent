/**
 * Sidebar 组件 —— 会话列表 + 新建按钮
 *
 * 功能：
 * - 新建按钮：POST /api/sessions，成功后选中新会话
 * - 会话列表：GET /api/sessions，显示标题，高亮当前活跃
 * - 加载状态：首次获取时显示 loading
 * - 右键删除：长按/右键 → 删除会话
 */

import { useState } from "react";
import type { SessionSummary } from "../hooks/useSessions.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SidebarProps {
  /** 当前活跃的会话 ID */
  activeSessionId: string | null;
  /** 选中会话回调 */
  onSelectSession: (id: string) => void;
  /** 会话列表 */
  sessions: SessionSummary[];
  /** 是否正在加载 */
  loading: boolean;
  /** 创建新会话 */
  onCreateSession: (title?: string) => Promise<SessionSummary | null>;
  /** 删除会话 */
  onDeleteSession: (id: string) => Promise<boolean>;
  /** 更新会话标题 */
  onUpdateTitle: (id: string, title: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 格式化时间为简短显示 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays === 0) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * Sidebar
 *
 * 固定在左侧的会话管理侧边栏，宽度 w-64。
 *
 * @example
 * ```tsx
 * <Sidebar activeSessionId={activeId} onSelectSession={setActiveId} />
 * ```
 */
export function Sidebar({
  activeSessionId,
  onSelectSession,
  sessions,
  loading,
  onCreateSession,
  onDeleteSession,
  onUpdateTitle,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // ── 新建会话 ──
  const handleNewSession = async () => {
    const session = await onCreateSession();
    if (session) {
      onSelectSession(session.id);
    }
  };

  // ── 右键删除 ──
  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    if (window.confirm("Delete this conversation?")) {
      onDeleteSession(id);
      if (activeSessionId === id) {
        onSelectSession("");
      }
    }
  };

  // ── 开始编辑标题 ──
  const handleStartEdit = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation(); // 不触发选中会话
    setEditingId(id);
    setEditValue(title);
  };

  // ── 保存编辑 ──
  const handleSaveEdit = async () => {
    if (editingId && editValue.trim()) {
      try {
        const ok = await onUpdateTitle(editingId, editValue.trim());
        if (!ok) return; // 失败时保持输入打开
      } catch {
        return; // 失败时保持输入打开，让用户重试
      }
    }
    setEditingId(null);
    setEditValue("");
  };

  // ── 取消编辑 ──
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  // ── 编辑中按 Enter 保存，Escape 取消 ──
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  return (
    <aside className="w-64 flex flex-col bg-gray-900 border-r border-gray-700/50 h-full">
      {/* ── 顶部：新建按钮 ── */}
      <div className="p-3 border-b border-gray-700/50">
        <button
          type="button"
          onClick={handleNewSession}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-100 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
        >
          <span className="text-lg">+</span>
          <span>New Chat</span>
        </button>
      </div>

      {/* ── 会话列表 ── */}
      <nav className="flex-1 overflow-y-auto">
        {loading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-gray-500">
            <span className="animate-pulse">Loading sessions...</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            <p>No conversations yet</p>
            <p className="mt-1 text-xs text-gray-600">
              Click "+ New Chat" to start
            </p>
          </div>
        ) : (
          <ul className="p-2 space-y-0.5">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelectSession(s.id)}
                  onContextMenu={(e) => handleContextMenu(e, s.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    activeSessionId === s.id
                      ? "bg-gray-700 text-gray-100"
                      : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                  }`}
                >
                  {editingId === s.id ? (
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleSaveEdit}
                      onKeyDown={handleEditKeyDown}
                      className="w-full bg-gray-800 text-gray-100 text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-gray-500"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      maxLength={200}
                    />
                  ) : (
                    <p
                      className="truncate font-medium cursor-pointer hover:underline"
                      onClick={(e) => handleStartEdit(e, s.id, s.title)}
                      title="Click to edit title"
                    >
                      {s.title}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">
                    {formatTime(s.updatedAt)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* ── 底部：状态信息 ── */}
      <div className="p-3 border-t border-gray-700/50">
        <p className="text-xs text-gray-600 text-center">
          {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
        </p>
      </div>
    </aside>
  );
}
