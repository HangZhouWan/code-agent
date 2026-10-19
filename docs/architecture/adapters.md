# 适配器：Server / CLI / Web

适配器只负责协议转换和 I/O，不包含编排、Agent 执行或配置合并逻辑。

## 1. Server

```
bootstrap: loadConfig → createHarness → createRuntime → createDb → createServer
```

- 薄 WS：解析 protocol → 获取/创建 AgentSession → run/resume → 转发事件；socket 关闭按配置 abort。
- REST：sessions / history / runs / config / providers / agents / approvals / workspace / memory（list / search / update / delete）。
- Fastify decorations 使用 module augmentation 强类型，禁止 `(app as any)`。
- setup/downgrade 模式复用同一 app factory，只挂 setup 所需路由。
- 默认绑定 127.0.0.1，校验 Origin；审批/回答必须属于当前 session/run。
- SQLite：schema 为唯一真相，迁移权威；WAL、foreign_keys、busy_timeout；事务回调同步。
- workspace 只读 API + path guard + chokidar watcher。

## 2. CLI

```
main → args → loadConfig / setup wizard → createHarness → createRuntime
     → modes/{repl,print,setup}
```

- 依赖 runtime + protocol，不依赖 server。
- REPL 固定 sessionId；历史真正传入 planner/agent。
- 事件由 `render/renderer.ts` 映射到终端；审批和 `ask_user` 走交互 prompt。
- Ctrl+C → abort；退出走完整 dispose。
- bundle 只包含 cli + core + runtime + protocol；`test:bundle` 守卫。
- 发布清单只含外部第三方依赖。

## 3. Web

- 只依赖 protocol；WS/REST 消息用 zod 解析。
- `useAgentSession(sessionId)` 统一负责连接、`afterSeq` 重连、reducer、审批、回答、abort。
- API client 统一 fetch/错误处理。
- 工具调用按 `callId` 关联；历史包含 tool calls，刷新不丢工具卡片。
- Setup 只请求一次状态；provider 元数据来自 protocol。
- 组件以展示为主，避免 god component 与 prop drilling。

## 4. 工作区浏览（只读）

- 文件树：`@headless-tree/react`，懒加载、虚拟化、Tailwind 自绘。
- 查看器：`@uiw/react-codemirror`（CodeMirror 6），只读扩展，按需加载语言包。
- Diff：`@codemirror/merge`。
- `WorkspacePanel = FileTree + EditorTabs + CodeViewer + DiffView`。
- 打开文件/tab/滚动位置可恢复（localStorage）。

### Server 只读 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workspace/tree?path=` | 懒加载子节点 |
| GET | `/api/workspace/file?path=` | content/language/encoding/size/isBinary/truncated |
| GET | `/api/workspace/diff?path=` | git diff 或工具前后快照 |
| GET | `/api/workspace/git/status` | M/A/U/?? |

### 安全

- `resolveWorkspacePath`：resolve + realpath + root 前缀校验；拒绝 `..`、symlink 逃逸、null 字节。
- 默认忽略 `.git`、`node_modules`、构建产物、`.env`、私钥。
- 二进制/大文件只返回元数据；单文件上限 1–2 MB。
- chokidar 事件 debounce；Agent 写文件后触发同一事件。
- 本期不做编辑/保存，因此不需要 etag；后续编辑版再加乐观锁。

## 5. 协议映射

- 域事件 `SessionEvent` 是唯一来源；WS 发送 `{ type: 'event', event: EventEnvelope }`。
- 客户端消息：`message` / `approval` / `answer` / `abort` / `resume`。
- 错误统一 `SerializedError` + `ApiError` envelope。
- 不把 LangGraph `streamEvents` 的结构直接暴露给客户端。
