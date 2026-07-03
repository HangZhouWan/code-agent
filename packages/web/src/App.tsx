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
 * 状态：
 * - activeSessionId：当前选中的会话
 * - 无活跃会话时 ChatArea 显示引导文字
 * - 选择/创建会话时切换 ChatArea
 */

import { useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { ChatArea } from "./components/ChatArea.js";

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* ── 侧边栏 ── */}
      <Sidebar
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
      />

      {/* ── 聊天区域 ── */}
      <ChatArea sessionId={activeSessionId} />
    </div>
  );
}
