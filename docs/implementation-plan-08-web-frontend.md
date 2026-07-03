# 实现计划 08：Web 前端实现

**对应技术文档**：[2026-07-02-technical-implementation.md](./2026-07-02-technical-implementation.md) 第九节

**预计工时**：5-7 天（第 5-6 周）

**前置模块**：[01-Monorepo](./implementation-plan-01-monorepo.md)、[06-API Gateway](./implementation-plan-06-api-gateway.md)

---

## 1. 目标

构建基于 React 19 + Vite 7 + Tailwind CSS 4 的单页聊天应用，支持：
- 会话管理（列表/新建/切换）
- 实时流式聊天（WebSocket）
- Markdown 渲染 + 代码语法高亮
- 工具调用状态可视化
- 敏感操作审批卡片

## 2. 依赖

```json
{
  "react": "^19",
  "react-dom": "^19",
  "react-markdown": "^9",
  "remark-gfm": "^4",
  "tailwindcss": "^4",
  "@tailwindcss/vite": "^4",
  "vite": "^7",
  "@vitejs/plugin-react": "^4"
}
```

## 3. 产出物清单

```
packages/web/
├── index.html
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.tsx
    ├── App.tsx                    # 根布局（Sidebar + ChatArea）
    ├── components/
    │   ├── Sidebar.tsx            # 会话列表 + 新建按钮
    │   ├── ChatArea.tsx           # 聊天区，串联 WS + Store
    │   ├── MessageList.tsx        # 消息列表（含工具卡片）
    │   ├── TextMessage.tsx        # Markdown 渲染组件
    │   ├── ToolCallCard.tsx       # 工具调用状态卡片
    │   ├── ConfirmCard.tsx        # 审批确认卡片
    │   └── InputBar.tsx           # 消息输入框
    ├── hooks/
    │   ├── useWebSocket.ts        # WebSocket 连接管理
    │   └── useSessions.ts         # 会话列表数据获取
    └── stores/
        └── chatStore.ts           # useReducer 聊天状态管理
```

---

## 4. 组件树

```
App
├── Sidebar
│   ├── "+ New Chat" 按钮
│   └── 会话列表（可点击切换）
└── ChatArea
    ├── MessageList
    │   ├── TextMessage (×N)
    │   │   └── ReactMarkdown + remarkGfm
    │   ├── ToolCallCard (×N)
    │   │   └── 状态图标 + 参数/结果展示
    │   └── ConfirmCard (×N)
    │       └── Approve / Deny 按钮
    ├── 自动滚动的锚点 div
    └── InputBar
        ├── textarea（支持 Enter 发送、Shift+Enter 换行）
        └── Send 按钮
```

---

## 5. 实现步骤

### 步骤 5.1：Vite 配置

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",  // 代理到后端
    },
  },
});
```

**注意**：WebSocket 代理需确保 Vite dev server 支持 WS 转发（默认支持）。

### 步骤 5.2：WebSocket Hook (`hooks/useWebSocket.ts`)

```typescript
export function useWebSocket({ sessionId, onMessage }: UseWebSocketOptions) {
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  ...

  return { status, send, approve };
}
```

**功能**：
| 功能 | 说明 |
|------|------|
| `status` | `connecting` → `connected` → `disconnected` 三态 |
| `send(content)` | 发送用户消息 `{ type: "message", content }` |
| `approve(callId, approved)` | 发送审批结果 `{ type: "approval", callId, approved }` |
| 自动重连 | `sessionId` 变化时关闭旧连接、建立新连接 |
| `onMessageRef` | 用 ref 包装回调避免 useEffect 重连 |

**WS 消息类型处理**：在 `ChatArea` 的 `onMessage` 回调中将 `WSMessage` 映射为 store 的 `dispatch` action。

### 步骤 5.3：聊天状态管理 (`stores/chatStore.ts`)

使用 `useReducer` 管理消息列表状态：

**State 类型**：
```typescript
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming: boolean;
  toolCalls: ToolCallState[];
}

interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "running" | "done" | "error" | "awaiting_approval";
}
```

**Action 类型**：

| Action | 触发时机 | 效果 |
|--------|------|------|
| `ADD_USER_MESSAGE` | 用户点击 Send | 追加 user 消息 |
| `ADD_ASSISTANT_MESSAGE` | 用户点击 Send | 追加空的 assistant 消息（isStreaming: true） |
| `APPEND_TEXT` | WS `type: "text"` | 追加文本增量到最新 assistant 消息 |
| `TOOL_START` | WS `type: "tool_start"` | 追加 ToolCallState 到最新消息 |
| `TOOL_END` | WS `type: "tool_end"` | 更新对应 ToolCallState 的 result + status |
| `DONE` | WS `type: "done"` | 标记 isStreaming 为 false |
| `ERROR` | WS `type: "error"` | 追加错误信息 |

**reducer 实现要点**：
- 所有修改最新 assistant 消息的操作（APPEND_TEXT、TOOL_START、TOOL_END、DONE）需要边界检查 `messages.length > 0`
- `TOOL_END` 通过 `toolName` 匹配而非 `id`（因为 WS 事件中的 tool 是名称）
- `DONE` 的 `finalResponse` 为空时保留已流式累积的 content

### 步骤 5.4：App 根组件 (`App.tsx`)

```
┌────────────────────────────────────┐
│  Sidebar (w-64)  │  ChatArea (flex-1) │
│  bg-gray-900     │  bg-gray-950       │
│  border-r        │                    │
└────────────────────────────────────┘
```

- 状态：`activeSessionId`
- 无活跃会话时 ChatArea 显示引导文字
- 选择/创建会话时切换 ChatArea

### 步骤 5.5：Sidebar 组件

**功能**：
- **新建按钮**：`POST /api/sessions`，成功后选中新会话
- **会话列表**：`GET /api/sessions`，显示标题，高亮当前活跃
- **加载状态**：首次获取时显示 loading；失败时静默处理

**交互**：
- 点击会话 → `onSelectSession(id)`
- 长按/右键 → 删除会话（基础实现可省略）

### 步骤 5.6：ChatArea 组件

核心控制器，负责串联 WebSocket、Store 和子组件：

```
handleSend(content):
  1. dispatch ADD_USER_MESSAGE
  2. dispatch ADD_ASSISTANT_MESSAGE
  3. ws.send(content)

onMessage(wsMsg):
  switch msg.type:
    "text"       → dispatch APPEND_TEXT
    "tool_start" → dispatch TOOL_START
    "tool_end"   → dispatch TOOL_END
    "done"       → dispatch DONE
    "error"      → dispatch ERROR

useEffect → messagesEndRef.scrollIntoView({ behavior: "smooth" })
```

- 自动滚到底部（消息变化时）
- 无 `sessionId` 时显示空白引导

### 步骤 5.7：MessageList 组件

按消息列表渲染，每条消息包含：
1. `TextMessage`：Markdown 内容
2. 该消息关联的 `toolCalls`：
   - `status === "awaiting_approval"` → `ConfirmCard`
   - 其他 → `ToolCallCard`

**布局**：
- user 消息右对齐（`bg-blue-600`）
- assistant 消息左对齐（`bg-gray-800`）
- 最大宽度 80%

### 步骤 5.8：TextMessage 组件

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>
  {content}
</ReactMarkdown>
{isStreaming && <cursor动画 />}
```

- 使用 `prose prose-invert` 实现暗色主题 Markdown 样式
- 流式输出时显示闪烁光标指示器
- 代码块语法高亮（后续接入 Shiki）

### 步骤 5.9：ToolCallCard 组件

三态可视化：

| 状态 | 图标 | 色彩 |
|------|------|------|
| `running` | ⏳ | 灰色 |
| `done` | ✅ | 蓝色（工具名） |
| `error` | ❌ | 红色 |

展开内容：
- 工具参数摘要（截断 80 字符）
- 工具结果（截断 500 字符，`<pre>` 格式）

### 步骤 5.10：ConfirmCard 组件

黄色警告风格卡片：
- 标题：⚠️ Confirm Action: {toolName}
- 参数 JSON 格式化展示
- Approve（绿色）/ Deny（红色）两个按钮
- 点击后回调 `onApprove(true/false)`

### 步骤 5.11：InputBar 组件

- `<textarea>`：2 行，自动高度
- Enter 发送（无 Shift）
- Shift+Enter 换行
- Send 按钮：内容为空或 disabled 时禁用
- `disabled` 状态接收自 WebSocket 连接状态

---

## 6. Tailwind CSS 配置

使用 Tailwind CSS 4 的 Vite 插件方式（零配置）：

```css
/* 入口 CSS（在 main.tsx 中 import） */
@import "tailwindcss";
```

暗色主题：
- 背景：`bg-gray-950`（最深）、`bg-gray-900`（侧栏）、`bg-gray-800`（消息气泡）
- 文字：`text-gray-100`（主）、`text-gray-400`（次要）、`text-gray-500`（占位）
- 强调：`bg-blue-600`（用户气泡）、`text-blue-400`（工具名）

---

## 7. 代码高亮（后续优化）

基础实现使用 `react-markdown` 的默认代码块渲染。接入 Shiki 后：
- 服务端/构建时生成高亮 HTML
- 或使用 `@shikijs/rehype` 插件集成到 `react-markdown`

---

## 8. 验收标准

- [ ] Vite dev server 正常启动，代理 `/api` 到后端
- [ ] 侧栏可创建新会话、切换会话
- [ ] 发送消息后流式显示 LLM 回复
- [ ] Markdown 正确渲染（标题、列表、代码块、粗体、链接）
- [ ] GFM 表格正确渲染
- [ ] 工具调用显示状态卡片（running → done/error）
- [ ] 审批卡片 Approve/Deny 按钮功能正常
- [ ] 消息发送后输入框自动清空并聚焦
- [ ] 消息列表自动滚动到最新消息
- [ ] Enter 发送、Shift+Enter 换行正常
- [ ] WebSocket 断开时输入框 disabled
- [ ] 刷新页面后会话列表仍有数据（持久化）
- [ ] 深色主题整体视觉一致
