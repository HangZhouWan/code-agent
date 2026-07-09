# Auto Session Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically generate Chinese session titles (5-15 chars) after the first exchange, with WebSocket push and manual inline editing.

**Architecture:** Backend generates titles via LLM after the first summarizer completion, pushes via new WebSocket message type `title_updated`. Frontend lifts `useSessions` to App, wires WS-driven title updates and Sidebar inline editing through a single `updateTitle` data path.

**Tech Stack:** TypeScript, Fastify WebSocket, React, Drizzle ORM (SQLite)

## Global Constraints

- Title max 200 characters, cannot be empty after trim
- Language: Chinese (5-15 chars)
- Reuse existing LLM model instance for title generation
- Title generation failure must not affect main chat flow
- Only generate title once per session (skip if title is no longer "New Chat")
- Trigger: first exchange complete (message count ≤ 2 after summarizer saves assistant message)

---

### Task 1: Backend — Add PATCH /api/sessions/:id endpoint

**Files:**
- Modify: `packages/server/src/gateway/routes/sessions.ts`

**Interfaces:**
- Consumes: `SessionRepository.updateTitle(id, title)`, `SessionRepository.getById(id)` (existing)
- Produces: `PATCH /api/sessions/:id` — body `{ title: string }`, returns updated session object

- [ ] **Step 1: Add Zod schema for PATCH request body**

In `packages/server/src/gateway/routes/sessions.ts`, add after the existing schemas (after line 33):

```ts
/** 更新会话标题请求体 */
const updateTitleSchema = z.object({
  title: z.string().min(1).max(200),
});
```

- [ ] **Step 2: Add PATCH route handler**

In the same file, add the route before `export default sessionRoutes;` (before line 134):

```ts
  /**
   * PATCH /api/sessions/:id —— 更新会话标题
   *
   * Path Params: id (会话 UUID)
   * Request Body: { title: string }
   * Response 200: 更新后的会话对象
   * Response 404: 会话不存在
   */
  app.patch("/sessions/:id", async (request, reply) => {
    const { id } = sessionIdParams.parse(request.params);
    const body = updateTitleSchema.parse(request.body);
    const db = getDb(app);
    const repo = new SessionRepository(db);

    const session = repo.getById(id);
    if (!session) {
      reply.status(404).send({
        error: "NotFound",
        message: `Session "${id}" not found`,
      });
      return;
    }

    repo.updateTitle(id, body.title);
    const updated = repo.getById(id);
    reply.status(200).send(updated);
  });
```

- [ ] **Step 3: Verify TypeScript compiles for server package**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors related to the new route.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/gateway/routes/sessions.ts
git commit -m "feat: add PATCH /api/sessions/:id endpoint for title editing"
```

---

### Task 2: Backend — Title generation in WebSocket handler

**Files:**
- Modify: `packages/server/src/gateway/ws/chat.ts`

**Interfaces:**
- Consumes: `SessionRepository.getMessages()` (existing, used to check if first exchange), `SessionRepository.updateTitle()` (existing), `BaseChatModel.invoke()` (existing LLM interface)
- Produces: new `ServerMessage` variant `{ type: "title_updated"; title: string }`

- [ ] **Step 1: Add `title_updated` to ServerMessage type**

In `packages/server/src/gateway/ws/chat.ts`, add the new variant to the `ServerMessage` union type (after line 51):

```ts
  | { type: "title_updated"; title: string }
```

- [ ] **Step 2: Add `generateTitle` helper function**

Add the function after the `safeJsonStringify` helper (after line 108):

```ts
/**
 * 根据第一条用户消息生成中文标题（5-15 字）
 *
 * @param model - LLM 实例
 * @param firstHumanMessage - 第一条用户消息内容
 * @returns 生成的中文标题，失败时返回 null
 */
async function generateTitle(
  model: BaseChatModel,
  firstHumanMessage: string,
): Promise<string | null> {
  try {
    const response = await model.invoke([
      new HumanMessage(
        `根据用户的第一条消息，用 5-15 个中文字生成一个简洁的对话标题。只输出标题本身，不要加引号或额外说明。\n\n用户消息：${firstHumanMessage}`,
      ),
    ]);
    const title = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content ?? "").trim();
    // 确保标题在合理范围内
    if (!title || title.length > 50) return null;
    return title;
  } catch (err) {
    console.error("[WS] Title generation failed:", err);
    return null;
  }
}
```

- [ ] **Step 3: Trigger title generation after summarizer completes**

In the `streamOrchestrator` function, inside the `on_chain_end` case for `"summarizer"` (inside the existing if block, after line 355 `send(socket, { type: "done", finalResponse });`), add the title generation logic:

```ts
            // ── 自动生成标题（首条消息完成后） ──
            if (ctx.repo && ctx.sessionId) {
              try {
                const session = ctx.repo.getById(ctx.sessionId);
                if (session && session.title === "New Chat") {
                  const allMessages = ctx.repo.getMessages(ctx.sessionId);
                  // 仅首轮对话（≤2 条消息）时生成标题
                  if (allMessages.length <= 2) {
                    const firstHuman = allMessages.find(
                      (m) => m.role === "human",
                    );
                    if (firstHuman) {
                      const title = await generateTitle(
                        ctx.model,
                        firstHuman.content,
                      );
                      if (title) {
                        ctx.repo.updateTitle(ctx.sessionId, title);
                        send(socket, {
                          type: "title_updated",
                          title,
                        });
                      }
                    }
                  }
                }
              } catch {
                // 标题生成失败不阻断主流程
              }
            }
```

Note: insert this after the existing `send(socket, { type: "done", finalResponse });` call but still inside the `if (event.name === "summarizer")` block (after line 355).

- [ ] **Step 4: Verify TypeScript compiles for server package**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/gateway/ws/chat.ts
git commit -m "feat: auto-generate session title after first exchange via WebSocket"
```

---

### Task 3: Frontend — Data layer changes (useSessions + useWebSocket)

**Files:**
- Modify: `packages/web/src/hooks/useSessions.ts`
- Modify: `packages/web/src/hooks/useWebSocket.ts`

**Interfaces:**
- Consumes: (none new)
- Produces: `UseSessionsReturn.updateTitle(id: string, title: string) => Promise<boolean>`, `WSMessage.title?: string`

- [ ] **Step 1: Add `title` field to WSMessage interface**

In `packages/web/src/hooks/useWebSocket.ts`, add to the `WSMessage` interface (after the `callId?` line at line 30):

```ts
  title?: string;
```

The full interface becomes:

```ts
export interface WSMessage {
  type: string;
  delta?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  finalResponse?: string;
  message?: string;
  callId?: string;
  title?: string;
}
```

- [ ] **Step 2: Add `updateTitle` to UseSessionsReturn interface**

In `packages/web/src/hooks/useSessions.ts`, add to the `UseSessionsReturn` interface (after the `refresh` line at line 33):

```ts
  /** 更新会话标题 */
  updateTitle: (id: string, title: string) => Promise<boolean>;
```

- [ ] **Step 3: Implement `updateTitle` in the hook**

In the same file, add the `updateTitle` callback after the `deleteSession` callback (after line 126):

```ts
  // ── 更新会话标题 ──
  const updateTitle = useCallback(
    async (id: string, title: string): Promise<boolean> => {
      const trimmed = title.trim();
      if (!trimmed || trimmed.length > 200) return false;
      try {
        const res = await fetch(`/api/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        if (!res.ok) {
          console.error("[useSessions] Failed to update title:", res.status);
          return false;
        }
        const updated: SessionSummary = await res.json();
        // 乐观更新：替换列表中对应会话的标题
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, title: updated.title } : s)),
        );
        return true;
      } catch (err) {
        console.error("[useSessions] Error updating title:", err);
        return false;
      }
    },
    [],
  );
```

- [ ] **Step 4: Add `updateTitle` to the return statement**

In the same file, update the return statement (line 128):

```ts
  return { sessions, loading, createSession, deleteSession, updateTitle, refresh };
```

- [ ] **Step 5: Verify TypeScript compiles for web package**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/hooks/useSessions.ts packages/web/src/hooks/useWebSocket.ts
git commit -m "feat: add updateTitle to useSessions and title field to WSMessage"
```

---

### Task 4: Frontend — ChatArea onTitleUpdated handling

**Files:**
- Modify: `packages/web/src/components/ChatArea.tsx`

**Interfaces:**
- Consumes: `WSMessage.title` (from Task 3)
- Produces: `ChatAreaProps.onTitleUpdated?: (title: string) => void`

- [ ] **Step 1: Add `onTitleUpdated` to ChatAreaProps**

In `packages/web/src/components/ChatArea.tsx`, add to `ChatAreaProps` interface (after line 39):

```ts
  /** WebSocket 推送标题更新时的回调 */
  onTitleUpdated?: (title: string) => void;
```

- [ ] **Step 2: Handle `title_updated` in onMessage callback**

In the same file, inside the `onMessage` callback, add a new case in the switch statement (after the `"error"` case, before `default`, around line 115):

```ts
        case "title_updated":
          if (msg.title) {
            onTitleUpdated?.(msg.title);
          }
          break;
```

- [ ] **Step 3: Destructure onTitleUpdated from props**

In the same file, update the component function signature (line 59):

```ts
export function ChatArea({ sessionId, onTitleUpdated }: ChatAreaProps) {
```

- [ ] **Step 4: Verify TypeScript compiles for web package**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/ChatArea.tsx
git commit -m "feat: handle title_updated WebSocket message in ChatArea"
```

---

### Task 5: Frontend — Sidebar inline editing + props restructure

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `UseSessionsReturn` fields (from Task 3)
- Produces: Updated Sidebar with inline editing, props changed to receive all data from App

- [ ] **Step 1: Rewrite SidebarProps to accept sessions data**

Replace the existing `SidebarProps` interface (lines 17-22) with:

```ts
import type { SessionSummary } from "../hooks/useSessions.js";

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
```

- [ ] **Step 2: Rewrite Sidebar component**

Replace the entire component (lines 61-144) with the updated version:

```tsx
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
  const handleSaveEdit = () => {
    if (editingId && editValue.trim()) {
      onUpdateTitle(editingId, editValue.trim());
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
```

- [ ] **Step 3: Add `useState` import**

Update the React import on line 11 if not already importing `useState`. The component uses `useState` for `editingId` and `editValue`. Update to:

```tsx
import { useState } from "react";
```

But since the current file doesn't import `useState` (only `useSessions`), check and add it. Actually, the rewritten component above uses `useState`, so make sure the import is correct. Replace line 11:

```tsx
import { useState } from "react";
```

- [ ] **Step 4: Verify TypeScript compiles for web package**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors (note: App.tsx will have errors since it hasn't been updated yet — that's expected and will be fixed in Task 6).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Sidebar.tsx
git commit -m "feat: add inline title editing and restructure Sidebar props"
```

---

### Task 6: Frontend — App.tsx wiring

**Files:**
- Modify: `packages/web/src/App.tsx`

**Interfaces:**
- Consumes: `useSessions` (Task 3), `Sidebar` new props (Task 5), `ChatArea` new prop (Task 4)
- Produces: Wired app with title updates flowing through single data path

- [ ] **Step 1: Rewrite App.tsx**

Replace the entire file content:

```tsx
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
    (title: string) => {
      if (activeSessionId) {
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
```

- [ ] **Step 2: Verify TypeScript compiles for the entire web package**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors. All type checks pass.

- [ ] **Step 3: Quick manual verification**

Run the build to ensure everything compiles:

```bash
cd packages/web && npx vite build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "feat: wire auto title generation in App with useSessions lift"
```

---

### Task 7: End-to-end verification

**Files:**
- Test: manual end-to-end flow verification

- [ ] **Step 1: Start the server and verify the PATCH endpoint**

Start the server, then test with curl:

```bash
# Create a session
curl -s -X POST http://localhost:3001/api/sessions -H "Content-Type: application/json" -d '{"title":"New Chat"}' | head -c 200

# Update its title (replace <id> with actual UUID from above)
curl -s -X PATCH http://localhost:3001/api/sessions/<id> -H "Content-Type: application/json" -d '{"title":"测试标题"}' | head -c 200
```

Expected: PATCH returns 200 with updated session object.

- [ ] **Step 2: Verify title auto-generation via WebSocket**

Start the app (frontend + backend), open the browser:
1. Create a new chat
2. Send a Chinese message like "帮我写一个Python脚本处理CSV文件"
3. Wait for assistant to finish responding
4. Check sidebar: title should change from "New Chat" to a generated Chinese title (e.g., "CSV文件处理脚本")

Expected: Title auto-updates after first exchange completes.

- [ ] **Step 3: Verify inline editing**

1. Click on a session title in the sidebar
2. Title text should become an input field
3. Type a new title, press Enter
4. Title should update in the sidebar

Expected: Inline edit saves and displays new title.

- [ ] **Step 4: Verify no duplicate generation**

1. Take a session that already has a generated title
2. Send another message
3. Title should NOT change (since it's no longer "New Chat")

Expected: Title remains unchanged after subsequent messages.

- [ ] **Step 5: Commit any final tweaks**

```bash
git status
# If clean, no commit needed. If fixes were made:
git add -A && git commit -m "fix: e2e verification tweaks"
```
