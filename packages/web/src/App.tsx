/**
 * 根组件 App
 *
 * 通用 AI Agent 平台的主界面入口。
 *
 * 布局：
 * ┌──────────────────────────────────────┐
 * │  Sidebar (w-64)  │  ChatArea (flex-1) │
 * │  bg-gray-900     │  bg-gray-950       │
 * │  border-r        │                    │
 * └──────────────────────────────────────┘
 *
 * 状态管理：
 * - activeSessionId：当前选中的会话
 * - useSessions 提升到 App 层，统一管理会话数据和标题更新
 * - WebSocket 推送标题 → updateTitle → Sidebar 自动刷新
 */

import { useState, useCallback } from "react";
import { useSessions } from "./hooks/useSessions.js";
import { Sidebar } from "./components/Sidebar.js";
import { ChatArea } from "./components/ChatArea.js";

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const { sessions, loading, createSession, deleteSession, updateTitle } =
    useSessions();

  // ── WebSocket 推送标题时更新侧边栏 ──
  const handleTitleUpdated = useCallback(
    (sessionId: string, title: string) => {
      if (activeSessionId && activeSessionId === sessionId) {
        updateTitle(activeSessionId, title);
      }
    },
    [activeSessionId, updateTitle],
  );

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* ── 侧边栏 ── */}
      <Sidebar
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        sessions={sessions}
        loading={loading}
        onCreateSession={createSession}
        onDeleteSession={deleteSession}
        onUpdateTitle={updateTitle}
      />

      {/* ── 聊天区域 ── */}
      <ChatArea
        sessionId={activeSessionId}
        onTitleUpdated={handleTitleUpdated}
      />
    </div>
  );
}
