# 对话历史标题自动生成

**日期**：2026-07-09  
**状态**：设计完成，待实现

## 目标

将侧边栏对话历史标题从固定的 "New Chat" 改为根据对话内容自动生成的中文标题（5-15 字）。同时支持用户手动编辑标题。

## 方案

**后端 WebSocket 驱动**：首轮对话（human + assistant）完成后，后端异步调用同一 LLM 生成标题，通过 WebSocket 推送到前端。前端同时支持点击标题内联编辑。

### 时机

- 在 `summarizer` 节点完成后，检查是否为会话第一条消息（`messageCount ≤ 2`）
- 检查当前 title 是否仍为 `"New Chat"`（防止重复生成）
- 生成失败静默 catch，不影响主流程

### 标题生成

- 用第一条 human 消息作为输入
- System prompt：`"根据用户的第一条消息，用 5-15 个中文字生成一个简洁的对话标题。只输出标题本身，不要加引号或额外说明。"`
- 复用现有 LLM model 实例

## 数据流

```
用户发消息 → summarizer 完成 → 检测首条消息 → LLM 生成标题
                                             ↓
Sidebar 更新 ← App.onTitleUpdated ← WS { type: "title_updated", title }
```

## 涉及文件

### 后端（packages/server）

| 文件 | 改动 |
|---|---|
| `src/gateway/ws/chat.ts` | ServerMessage 加 `title_updated` 类型；`streamOrchestrator` 中首条消息完成后触发标题生成 |
| `src/gateway/routes/sessions.ts` | 新增 `PATCH /api/sessions/:id` 端点，支持手动编辑标题 |

### 前端（packages/web）

| 文件 | 改动 |
|---|---|
| `src/hooks/useWebSocket.ts` | WSMessage 接口加 `title?: string` |
| `src/hooks/useSessions.ts` | 新增 `updateTitle(id, title)` 方法 |
| `src/components/ChatArea.tsx` | Props 加 `onTitleUpdated`；onMessage 处理 `title_updated` |
| `src/components/Sidebar.tsx` | 点击标题进入内联编辑（input）；props 改为从 App 传入 |
| `src/App.tsx` | 提升 `useSessions`，串联 WebSocket 标题推送和 Sidebar 编辑 |

## UI 行为

- **自动标题**：用户发送消息后，首轮对话完成时标题从 "New Chat" 自动变为生成的标题
- **手动编辑**：点击侧边栏标题 → 变为 input 框 → Enter/blur 保存（PATCH API），Escape 取消
- **标题校验**：trim 后不能为空，max 200 字符
