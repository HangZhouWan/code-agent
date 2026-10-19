/**
 * 根组件 App
 *
 * 通用 AI Agent 平台的主界面入口。
 *
 * 启动时检查服务端配置状态：
 * - 未配置 → 渲染 SetupPage（首次配置引导）
 * - 已配置 → 渲染正常聊天界面（Sidebar + ChatArea）
 *
 * 布局：
 * ┌──────────────────────────────────────┐
 * │  Sidebar (w-64)  │  ChatArea (flex-1) │
 * │  bg-gray-900     │  bg-gray-950       │
 * │  border-r        │                    │
 * └──────────────────────────────────────┘
 */

import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { useSessions } from "./hooks/useSessions.js";
import { Sidebar } from "./components/Sidebar.js";
import { ChatArea } from "./components/ChatArea.js";
import { SetupPage } from "./components/SetupPage.js";

// CodeMirror 体积较大，仅在打开工作区时加载
const WorkspacePanel = lazy(() =>
  import("./components/workspace/WorkspacePanel.js").then((module) => ({
    default: module.WorkspacePanel,
  })),
);

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const { sessions, loading, createSession, deleteSession, updateTitle } =
    useSessions();

  // ── Check config status on mount ──
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/config/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSetupRequired(data.setupRequired);
      } catch {
        setSetupRequired(true);
      }
    }
    check();
  }, []);

  // ── WebSocket 推送标题时更新侧边栏 ──
  const handleTitleUpdated = useCallback(
    (sessionId: string, title: string) => {
      if (activeSessionId && activeSessionId === sessionId) {
        updateTitle(activeSessionId, title);
      }
    },
    [activeSessionId, updateTitle],
  );

  // ── Still checking ──
  if (setupRequired === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-400">正在检查配置...</p>
      </div>
    );
  }

  // ── Setup required ──
  if (setupRequired) {
    return <SetupPage />;
  }

  // ── Normal mode ──
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

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-end border-b border-gray-800 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setShowWorkspace((value) => !value)}
            className="rounded border border-gray-700 px-2.5 py-1 text-xs text-gray-300 hover:bg-gray-800"
          >
            {showWorkspace ? "Hide workspace" : "Workspace"}
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ── 聊天区域 ── */}
          <ChatArea
            sessionId={activeSessionId}
            onTitleUpdated={handleTitleUpdated}
          />

          {showWorkspace && (
            <Suspense
              fallback={
                <div className="flex w-[45%] min-w-[320px] items-center justify-center border-l border-gray-800 bg-gray-900 text-sm text-gray-500">
                  加载工作区...
                </div>
              }
            >
              <WorkspacePanel />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
