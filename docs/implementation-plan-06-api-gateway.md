# 实现计划 06：API Gateway 实现

**对应技术文档**：[2026-07-02-technical-implementation.md](./2026-07-02-technical-implementation.md) 第七、十一、十二节

**预计工时**：5-7 天（第 4-5 周）

**前置模块**：[01-Monorepo](./implementation-plan-01-monorepo.md)、[02-LLM 抽象层](./implementation-plan-02-llm-abstraction.md)、[05-Agent 编排层](./implementation-plan-05-agent-orchestration.md)、[07-数据库](./implementation-plan-07-database.md)

---

## 1. 目标

构建 Fastify 5 驱动的 HTTP + WebSocket 服务层，提供：
- RESTful 会话管理 API
- WebSocket 实时聊天通道（含流式输出）
- 工具审批 HTTP 端点
- 环境变量加载与校验
- 全局错误处理

## 2. 依赖

```json
{
  "fastify": "^5",
  "@fastify/websocket": "^11",
  "@fastify/cors": "^10",
  "@fastify/env": "^5",
  "zod": "^3",
  "dotenv": "^16"
}
```

## 3. 产出物清单

```
packages/server/src/
├── index.ts                         # 服务入口
├── config.ts                        # 环境变量加载与 Zod 校验
├── gateway/
│   ├── server.ts                    # createServer() Fastify 工厂
│   ├── routes/
│   │   ├── sessions.ts              # CRUD /api/sessions
│   │   └── tools.ts                 # POST /api/tools/:callId/approve
│   ├── ws/
│   │   └── chat.ts                  # WebSocket 聊天处理
│   └── middleware/
│       └── error.ts                 # 全局错误处理
```

---

## 4. 实现步骤

### 步骤 4.1：环境变量配置 (`config.ts`)

```typescript
import { z } from "zod";

const envSchema = z.object({
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]).default("openai"),
  LLM_MODEL: z.string().default("gpt-4o"),
  LLM_API_KEY: z.string(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MAX_RETRIES: z.coerce.number().default(3),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(3000),
  WORKSPACE_PATH: z.string().default("./workspace"),
  DB_PATH: z.string().default("./data/my-agent.db"),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadConfig(): EnvConfig {
  return envSchema.parse(process.env);
}
```

**要点**：
- 使用 `z.coerce.number()` 处理字符串环境变量 → 数字转换
- `LLM_API_KEY` 为必填，缺失时 Zod 自动报错退出
- `LLM_BASE_URL` 为可选，用于代理或兼容服务

### 步骤 4.2：Fastify 实例工厂 (`gateway/server.ts`)

```typescript
export interface AppOptions {
  model: BaseChatModel;
  toolRegistry: ToolRegistry;
  workspacePath: string;
}

export async function createServer(options: AppOptions) {
  const app = Fastify({ logger: true });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  app.setErrorHandler(errorHandler);

  await app.register(sessionRoutes, { prefix: "/api" });
  await app.register(toolRoutes, { prefix: "/api" });

  await app.register(async (scope) => {
    scope.get("/api/sessions/:id/chat", { websocket: true },
      createChatWebSocket(options));
  });

  return app;
}
```

**关键**：
- CORS 全开（开发阶段），生产需锁定 origin
- WebSocket 路由使用 `{ websocket: true }` 选项
- 错误处理器通过 `setErrorHandler` 全局注册

### 步骤 4.3：WebSocket 聊天 (`gateway/ws/chat.ts`)

这是整个 Gateway 的核心。

**消息协议**：

| 客户端 → 服务端 | 字段 | 说明 |
|------|------|------|
| 用户消息 | `{ type: "message", content: string }` | 发送聊天内容 |
| 工具审批 | `{ type: "approval", callId: string, approved: boolean }` | 审批确认/拒绝 |

| 服务端 → 客户端 | 字段 | 说明 |
|------|------|------|
| 文本增量 | `{ type: "text", delta: string }` | LLM 流式输出增量 |
| 工具开始 | `{ type: "tool_start", tool: string, args: object }` | 工具调用开始 |
| 工具结束 | `{ type: "tool_end", tool: string, result: string }` | 工具调用结果 |
| 完成 | `{ type: "done", finalResponse: string }` | 汇总完成 |
| 错误 | `{ type: "error", message: string }` | 错误通知 |

**流式推送实现**：

使用 LangGraph 的 `graph.streamEvents()` 方法：

```typescript
const stream = graph.streamEvents(
  { messages: [new HumanMessage(msg.content)] },
  { version: "v2" },
);

for await (const event of stream) {
  switch (event.event) {
    case "on_chat_model_stream":  // LLM 流式输出 → type: "text"
    case "on_tool_start":         // 工具开始 → type: "tool_start"
    case "on_tool_end":           // 工具结束 → type: "tool_end"
    case "on_chain_end":          // 节点完成 → type: "done"（仅 summarizer）
  }
}
```

**审批机制**：

使用内存 Map 管理待审批的工具调用：

```typescript
const pendingApprovals = new Map<string, {
  resolve: (approved: boolean) => void;
  ws: WebSocket;
}>();
```

当 WorkerAgent 抛出 `ConfirmRequiredError` 时：
1. 服务端生成 `callId`，创建 Promise 存入 `pendingApprovals`
2. 通过 WebSocket 推送 `{ type: "confirm_required", callId, tool, args }` 到前端
3. 前端用户点击 Approve/Deny
4. 前端通过 WebSocket 发送 `{ type: "approval", callId, approved }`
5. 服务端 `resolve(approved)`，Worker 的 SandboxGuard 获得审批结果

**断线清理**：`socket.on("close")` 时移除该 socket 的所有待审批项。

### 步骤 4.4：HTTP 路由 — 会话管理 (`gateway/routes/sessions.ts`)

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/sessions` | 创建会话（title 可选，默认 "New Chat"） |
| `GET` | `/api/sessions` | 列表查询（按 updatedAt 降序） |
| `GET` | `/api/sessions/:id/history` | 获取会话消息历史 |
| `DELETE` | `/api/sessions/:id` | 删除会话（级联删除消息） |

使用 Zod 校验请求体，委托 `SessionRepository` 操作数据库。

### 步骤 4.5：HTTP 路由 — 工具审批 (`gateway/routes/tools.ts`)

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/tools/:callId/approve` | 工具审批（HTTP 备用通道） |

当前审批主要通过 WebSocket 的 `pendingApprovals` map 传递，HTTP 端点为备用。

### 步骤 4.6：全局错误处理 (`gateway/middleware/error.ts`)

三层错误分类：

| 错误类型 | HTTP 状态码 | 示例 |
|------|------|------|
| `ZodError` | 400 | 请求体校验失败 |
| 配置错误（API Key 相关） | 503 | 模型认证失败 |
| 其他未知错误 | 500 | 内部异常 |

响应格式统一为：
```json
{ "error": "ErrorType", "message": "...", "details?": [...] }
```

### 步骤 4.7：服务入口 (`index.ts`)

```typescript
import { config } from "dotenv";
config();

async function main() {
  const cfg = loadConfig();                          // 1. 加载配置
  const model = createChatModel({...});               // 2. 创建 LLM
  const toolRegistry = ToolRegistry.createDefault();  // 3. 注册所有工具
  // 注册 12 个内置工具...
  const db = createDb(cfg.DB_PATH);                   // 4. 初始化数据库
  const app = await createServer({...});              // 5. 创建服务
  app.decorate("db", db);                             // 6. 挂载 db 实例
  await app.listen({ host: cfg.HOST, port: cfg.PORT }); // 7. 启动
}

main().catch((err) => { process.exit(1); });
```

---

## 5. 数据流总览

```
浏览器 WebSocket ──→ createChatWebSocket()
  │
  ├─ "message" ──→ Orchestrator Graph
  │                  ├─ planner (LLM)
  │                  ├─ dispatcher (WorkerAgent × N)
  │                  └─ summarizer (LLM)
  │                       │
  │                       └─ streamEvents ──→ WebSocket push
  │
  └─ "approval" ──→ pendingApprovals.get(callId).resolve(approved)
```

---

## 6. 验收标准

- [ ] 服务正常启动，监听指定 HOST:PORT
- [ ] `POST /api/sessions` 创建会话返回 201
- [ ] `GET /api/sessions` 返回会话列表
- [ ] `GET /api/sessions/:id/history` 返回消息历史
- [ ] `DELETE /api/sessions/:id` 删除成功返回 204
- [ ] WebSocket 连接建立成功
- [ ] 发送用户消息后，流式收到 `text`、`tool_start`、`tool_end`、`done` 事件
- [ ] Zod 校验失败时返回 400 + ValidationError
- [ ] API Key 无效时返回 503 + ConfigurationError
- [ ] 环境变量缺少 `LLM_API_KEY` 时启动报错
- [ ] 断线重连不丢失会话状态
