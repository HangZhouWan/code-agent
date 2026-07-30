# Code Agent

角色分工型多 Agent 协作平台 —— 用户以自然语言下达指令，Orchestrator 自动规划并派发任务给各角色 Agent（Code / Test / Doc），Agent 之间通过 Event Bus 互相发现、通信、协作，支持动态任务分配和中途恢复。

项目以学习为核心目的，重点关注 **运行时基础设施（Harness Engineering）**：权限沙箱、Hooks 机制、上下文管理、Event Bus 通信、Checkpoint 恢复。

---

## 架构概览

```
                       User
                        │
              ┌─────────┴─────────┐
              │                   │
         Web Chat UI         CLI REPL
              │                   │
         API Gateway              │
              │                   │
┌────────────────────────▼──────────────────────────┐
│                   Orchestrator                      │
│                                                     │
│  Planner ──→ Dispatcher ──→ Replanner              │
│                                                     │
│                   Finalizer                         │
└────────────────────────┬──────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────┐
│                   State Manager                     │
│  Task State │ Workflow State │ Agent State │ Artifact│
└────────────────────────┬──────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────┐
│                    Event Bus                        │
│  Command Topics: agent.command.*                    │
│  Event Topics:  agent.event.*                       │
└──────┬────────────────┬──────────────────┬──────────┘
       │                │                  │
┌──────▼──────┐  ┌──────▼──────┐  ┌───────▼──────┐
│  Code Agent │  │ Test Agent  │  │  Doc Agent   │ ...
│             │  │             │  │              │
│ Role        │  │ Role        │  │ Role         │
│ Reasoning   │  │ Reasoning   │  │ Reasoning    │
│ Runtime     │  │ Runtime     │  │ Runtime      │
│ Capability  │  │ Capability  │  │ Capability   │
└─────────────┘  └─────────────┘  └──────────────┘

┌────────────────────────────────────────────────────┐
│                 Agent Runtime (横向)                 │
│                                                     │
│  Execution Engine ──→ Checkpoint Manager            │
│         │                                           │
│    Context Mgr ──→ Memory (short/long/working)      │
│         │                                           │
│    Tool Runtime ──→ Permission ──→ Hooks            │
└────────────────────────────────────────────────────┘
```

### 五层架构

| 层级 | 组件 | 职责 |
|------|------|------|
| **第一层** | Orchestrator | Planner 规划 → Dispatcher 双通道派发 → Replanner 修正 → Finalizer 报告 |
| **第二层** | State Manager | 全局状态：Task / Workflow / Agent / Artifact 的状态流转 |
| **第三层** | Event Bus | Agent 间通信：Command（指令）+ Event（通知）双通道 |
| **第四层** | Agent | 分角色 Agent（Code / Test / Doc），Role → Reasoning → Runtime → Capability |
| **第五层** | Agent Runtime | Execution Engine + Checkpoint + Context + Memory（三层记忆） |

### 核心设计约束

- **Harness 是唯一执行通道**：Agent 不能绕过 Runtime 直接调用工具或 LLM
- **Event Bus 是唯一通信通道**：Agent 之间不直接调用，通过 Command/Event 通信
- **State Manager 是所有状态的唯一真相源**：Orchestrator 和 Agent 都通过它读写状态
- **LLM 抽象层**向上层屏蔽不同模型 API 的差异

---

## 技术栈

| 维度 | 技术 | 说明 |
|------|------|------|
| 语言 | TypeScript | 全栈类型安全 |
| 运行时 | Node.js 22+ | LTS，ESM 原生支持 |
| 包管理 | pnpm + monorepo | 多包隔离，workspace 协议 |
| LLM 框架 | LangChain.js + LangGraph | LLM 抽象、工具系统、Agent 编排 |
| 后端框架 | Fastify 5 + @fastify/websocket | 高性能 HTTP + WebSocket |
| 数据库 | SQLite (better-sqlite3) + Drizzle ORM | 零配置、轻量级 |
| 前端 | React 19 + Vite 7 | 现代化前端工具链 |
| 样式 | Tailwind CSS 4 | 原子化 CSS |
| Markdown | react-markdown + remark-gfm | Agent 回复渲染 |

---

## 项目结构

```
my-agent/
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .env.example
├── docs/
│   ├── 2026-07-02-general-agent-design.md
│   ├── 2026-07-02-technical-implementation.md
│   ├── implementation-plan-*.md
│   └── superpowers/specs/
│       ├── 2026-07-15-multi-agent-architecture-design.md   # 多 Agent 架构设计
│       ├── 2026-07-15-step1-event-bus-state-manager.md     # Step 1 详细计划
│       ├── 2026-07-15-step2-runtime-upgrade.md             # Step 2 详细计划
│       ├── 2026-07-15-step3-agent-base-class.md            # Step 3 详细计划
│       ├── 2026-07-15-step4-orchestrator-refactor.md       # Step 4 详细计划
│       └── 2026-07-15-step5-role-agents-integration.md     # Step 5 详细计划
├── packages/
│   ├── core/                        # @my-agent/core — 核心引擎
│   │   └── src/
│   │       ├── llm/                 # LLM 抽象层（工厂、协议检测、重试）
│   │       ├── tools/               # 工具层（File、Shell、Search、Git、Web）
│   │       ├── event-bus/           # Event Bus（Command + Event 双通道）
│   │       │   ├── bus.ts           #   InMemoryEventBus 实现
│   │       │   └── types.ts         #   消息类型定义
│   │       ├── state/               # State Manager（全局状态管理）
│   │       │   ├── manager.ts       #   InMemoryStateManager 实现
│   │       │   └── types.ts         #   Task/Workflow/Agent/Artifact 状态
│   │       ├── harness/             # Agent Runtime
│   │       │   ├── sandbox/         #   权限沙箱（注册表 + 守卫）
│   │       │   ├── hooks/           #   Hooks 引擎 + 内置 Hooks
│   │       │   ├── context/         #   上下文管理 + 压缩
│   │       │   ├── execution/       #   Execution Engine + Checkpoint Manager
│   │       │   │   ├── engine.ts    #     ReAct 循环驱动
│   │       │   │   └── checkpoint.ts #   执行快照持久化
│   │       │   └── memory/          #   三层记忆（short/long/working）
│   │       │       ├── short-term.ts
│   │       │       ├── long-term.ts
│   │       │       └── working.ts
│   │       └── agent/               # Agent 层
│   │           ├── agent.ts         #   Agent 基类
│   │           ├── worker.ts        #   WorkerAgent（兼容层）
│   │           ├── registry.ts      #   AgentRegistry 注册中心
│   │           ├── role.ts          #   角色定义 + system prompt
│   │           ├── reasoning.ts     #   ReAct 推理循环
│   │           ├── types.ts         #   Agent 类型定义
│   │           └── roles/           #   内置角色
│   │               ├── code.ts      #     Code Agent
│   │               ├── test.ts      #     Test Agent
│   │               └── doc.ts       #     Doc Agent
│   │
│   ├── server/                      # @my-agent/server — 后端服务
│   │   └── src/
│   │       ├── gateway/             # Fastify HTTP + WebSocket 网关
│   │       │   ├── routes/          #   RESTful 路由（会话、工具审批、Agent 列表）
│   │       │   ├── ws/              #   WebSocket 聊天端点
│   │       │   └── middleware/      #   全局错误处理
│   │       ├── orchestrator/        # LangGraph 编排器
│   │       │   ├── graph.ts         #   状态图定义
│   │       │   ├── state.ts         #   注解状态
│   │       │   ├── types.ts         #   类型定义
│   │       │   └── nodes/           #   编排节点
│   │       │       ├── planner.ts   #     规划节点
│   │       │       ├── dispatcher.ts #    双通道派发节点
│   │       │       ├── replanner.ts #     重规划节点
│   │       │       └── finalizer.ts #     最终报告节点
│   │       └── db/                  # SQLite 数据库
│   │           ├── schema.ts        #   Drizzle schema
│   │           ├── connection.ts    #   数据库连接
│   │           └── repositories/    #   数据访问层
│   │               ├── sessions.ts
│   │               ├── messages.ts
│   │               ├── tasks.ts
│   │               ├── artifacts.ts
│   │               └── events.ts
│   │
│   └── web/                         # @my-agent/web — React 前端
│       └── src/
│           ├── components/          # UI 组件
│           │   ├── Sidebar.tsx
│           │   ├── ChatArea.tsx
│           │   ├── MessageList.tsx
│           │   ├── TextMessage.tsx
│           │   ├── ToolCallCard.tsx
│           │   ├── ConfirmCard.tsx
│           │   └── InputBar.tsx
│           ├── hooks/               # 自定义 Hooks
│           │   ├── useWebSocket.ts
│           │   └── useSessions.ts
│           └── stores/              # 状态管理
│               └── chatStore.ts
│
│   └── cli/                          # @my-agent/cli — 命令行 REPL
│       └── src/
│           ├── index.ts             #   入口 — 装配所有依赖，启动 REPL
│           ├── repl.ts              #   REPL 循环 — readline + 命令分发 + 流式输出
│           ├── config.ts            #   环境变量配置加载
│           ├── format.ts            #   ANSI 终端格式化
│           └── approval.ts          #   stdin 交互式工具审批
```

---

## 快速开始

### 前置要求

- **Node.js** ≥ 22.0.0
- **pnpm** ≥ 9.0.0

### 1. 克隆项目 & 安装依赖

```bash
git clone <repo-url> my-agent
cd my-agent
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 LLM API 配置：

```bash
# 必填：LLM 提供商配置
LLM_PROVIDER=openai              # openai | anthropic | openai-compatible
LLM_MODEL=gpt-4o                 # 模型名称
LLM_API_KEY=sk-your-key-here     # API 密钥

# 可选：自定义 API 端点（用于代理或兼容服务）
# LLM_BASE_URL=https://api.openai.com/v1
```

支持的 LLM 提供商：

| 提供商 | `LLM_PROVIDER` 值 | 说明 |
|--------|-------------------|------|
| OpenAI | `openai` | GPT-4o、GPT-4.1 等 |
| Anthropic | `anthropic` | Claude Opus、Sonnet、Haiku 等 |
| 兼容 OpenAI 协议 | `openai-compatible` | 第三方 API 代理或兼容服务 |

### 3. 启动开发服务器

```bash
pnpm dev
```

这将并行启动三个子包：
- **@my-agent/core**：TypeScript 编译监听（`tsc --watch`）
- **@my-agent/server**：后端服务，默认监听 `http://localhost:3000`（`tsx watch`）
- **@my-agent/web**：前端开发服务器，默认 `http://localhost:5173`（Vite）

> 前端开发时建议访问 Vite 地址 `http://localhost:5173`，Vite 会自动代理 API 请求到后端。

### 5. 启动 CLI REPL（可选）

```bash
pnpm cli
```

启动交互式命令行对话界面，无需浏览器即可与 Agent 对话：

```
$ pnpm cli

==================================================
  my-agent cli v0.1.0
==================================================
[config] LLM: openai-compatible/deepseek-v4-pro
[config] Workspace: ./workspace
[tools] Registered 11 built-in tools
[sandbox] Registered 11 tool permissions
[memory] Three-tier memory system initialized
[agent] Infrastructure initialized
[AgentRegistry] Agents started:
  - Code Agent (354df328-...)
  - Test Agent (5dc02772-...)
  - Doc Agent (16a7f65e-...)
[cli] Starting REPL...

  my-agent CLI REPL
  Type /help for commands, or just start chatting.

my-agent > 帮我检查 git 状态并生成一个 commit 信息
```

**REPL 命令：**

| 命令 | 功能 |
|------|------|
| `/help` | 显示可用命令列表 |
| `/clear` | 清空当前会话上下文 |
| `/history` | 查看消息历史摘要 |
| `/agents` | 显示 Agent 状态（角色、ID、状态） |
| `/tools` | 列出所有已注册工具 |
| `/exit` | 退出 REPL |

**交互特性：**

- **流式输出**：LLM 回复逐 token 实时显示
- **工具调用可视化**：工具执行时显示 `🛠 tool_name(args)` 及结果
- **审批提示**：危险操作在终端直接询问 `Approve? [y/N]`
- **Ctrl+C**：运行中取消当前任务，空提示符时退出

### 6. 其他常用命令

```bash
# 启动 CLI REPL
pnpm cli

# 类型检查
pnpm typecheck

# 生产构建
pnpm build

# 运行测试
pnpm -r test
```

---

## 功能特性

### 🧠 智能任务编排

用户输入自然语言指令后，**Orchestrator** 自动完成编排闭环：

1. **Planner**：分析意图 + 可用 Agent 列表 → 生成结构化 Plan（含复杂度判定：simple/complex）
2. **Dispatcher**：双通道派发 — **direct**（简单任务直接调用 Agent.run()）/ **bus**（复杂任务发布到 Event Bus，Agent 按角色订阅领取）
3. **Replanner**：Agent 执行中发现计划需要调整时介入（失败处理、新发现的依赖、产出冲突）
4. **Finalizer**：汇总所有产物（Artifact），生成最终用户报告

### 🤝 角色分工型多 Agent 协作

每个 Agent 按角色分工，通过 Event Bus 互相发现和协作：

| 角色 | 职责 | 典型触发 |
|------|------|---------|
| **Code Agent** | 代码编写、重构、修复 | Planner 分配 / 订阅 `test_failed` 自动修复 |
| **Test Agent** | 测试编写、执行、分析 | Planner 分配 / 订阅 `code_changed` 自动跑测试 |
| **Doc Agent** | 文档生成、更新、翻译 | Planner 分配 / 订阅 `code_changed` 自动更新文档 |

协作示例：
```
Code Agent 改完代码 → publish agent.event.code_changed
Test Agent 订阅 code_changed → 自动跑测试
测试失败 → publish agent.event.test_failed
Code Agent 收到 → 自动修复
```

### 📡 Event Bus 通信

Agent 之间通过 Event Bus 进行松耦合通信，支持两套 Topic：

- **Command** (`agent.command.*`)：指令 = "请做某事"，期待响应（request/reply 模式）
- **Event** (`agent.event.*`)：事实 = "某事已发生"，广播通知（pub/sub 模式）

| 方法 | 说明 |
|------|------|
| `publish(topic, payload)` | 发布事件，fire-and-forget |
| `request(topic, payload, timeout?)` | 发送指令，等待回复 |
| `subscribe(topic, handler)` | 精确匹配订阅 |
| `subscribePattern(pattern, handler)` | 通配匹配订阅 |

### 📊 State Manager 全局状态

所有状态集中管理，是 Orchestrator 和 Agent 之间的共享真相源：

| 子状态 | 内容 |
|--------|------|
| **Task State** | 所有任务的完整生命周期：pending → assigned → running → completed/failed |
| **Workflow State** | 当前 Plan、LangGraph 节点路由、决策历史 |
| **Agent State** | 各 Agent 的 idle / busy / error 状态 |
| **Artifact State** | 所有产物：文件变更、commit 记录、测试结果 |

### 🛡️ 三层权限沙箱

每次工具调用都经过 Runtime 校验：

| 级别 | 行为 | 示例 |
|------|------|------|
| **安全级** (safe) | 直接放行 | 读文件、搜索代码、HTTP GET |
| **需确认级** (confirm) | 弹出审批卡片，等待用户确认 | 写文件、执行 Shell、git commit |
| **高危级** (deny) | 直接拒绝 | `rm -rf /`、`sudo`、`curl \| bash` |

Agent 启动时声明能力范围（`tools` + `paths`），超出范围的调用会被自动拦截。

### 🔧 内置工具集

| 工具 | 能力 | 权限 |
|------|------|------|
| **File** | 读/写/列表文件（限定 workspace） | 读安全，写需确认 |
| **Shell** | 执行白名单命令，高危模式自动拦截 | 需确认 |
| **Code Search** | 基于 grep 的代码文本搜索 | 安全 |
| **Git** | status / diff / log / commit / branch | 读安全，变更需确认 |
| **Web** | HTTP GET 请求 + 网页内容提取 | 安全 |

### 🪝 Hooks 引擎

可扩展的事件钩子系统，支持以下挂载点：

- `agent:start` / `agent:end` — Agent 生命周期
- `tool:before` / `tool:after` — 工具调用前后（可修改参数/结果）
- `agent:error` — 异常捕获
- `message:send` / `message:receive` — 消息收发

内置 Hooks：**调用日志**、**敏感信息过滤**（自动脱敏 API Key / Token / 私钥）。

### 📝 上下文管理与记忆

- 每个 Agent 维护独立的对话上下文
- Token 用量追踪：超过阈值（80%）时自动触发压缩
- 压缩策略：滑动窗口 + 滚动摘要，保留最近消息的完整内容
- **三层记忆体系**：
  - **ShortTerm**：单 Agent 当前对话（内存）
  - **LongTerm**：跨会话知识（SQLite + 可选 embedding）
  - **Working**：当前 task 内所有 Agent 共享的"白板"

### 💾 Checkpoint 恢复

- 每个 Step 执行前自动保存（taskId + step 序号 + 完整 context + tool 历史）
- 支持 `resume(taskId)` 恢复中断的执行
- 持久化到文件系统（`~/.my-agent/checkpoints/`）

### 💬 实时聊天界面

- 左侧会话列表，右侧聊天区域
- **流式显示** Agent 回复（逐字输出）
- **工具调用可视化**：实时展示工具执行状态（⏳ 执行中 / ✅ 完成 / ❌ 失败）
- **审批卡片**：危险操作弹出 Approve / Deny 按钮
- Markdown 渲染 + 代码语法高亮

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/sessions` | 创建新会话 |
| `GET` | `/api/sessions` | 获取会话列表 |
| `WS` | `/api/sessions/:id/chat` | WebSocket 聊天（流式推送） |
| `GET` | `/api/sessions/:id/history` | 获取历史消息 |
| `DELETE` | `/api/sessions/:id` | 删除会话 |
| `POST` | `/api/tools/:callId/approve` | 工具审批回调 |
| `GET` | `/api/agents` | 获取可用 Agent 列表及状态 |

### WebSocket 消息协议

**客户端 → 服务端**：

```json
{ "type": "message", "content": "帮我重构这段代码" }
{ "type": "approval", "callId": "xxx", "approved": true }
```

**服务端 → 客户端**：

```json
{ "type": "text", "delta": "好的，我来分析..." }
{ "type": "tool_start", "tool": "code_search", "args": { ... } }
{ "type": "tool_end", "tool": "code_search", "result": "..." }
{ "type": "agent_start", "agent": "Code Agent", "task": "重构 auth 模块" }
{ "type": "agent_end", "agent": "Code Agent", "result": "success" }
{ "type": "done", "finalResponse": "重构完成..." }
{ "type": "error", "message": "错误描述" }
```

---

## 配置参考

完整环境变量列表见 `.env.example`：

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `LLM_PROVIDER` | 是 | `openai` | LLM 提供商 |
| `LLM_MODEL` | 是 | `gpt-4o` | 模型名称 |
| `LLM_API_KEY` | 是 | - | API 密钥 |
| `LLM_BASE_URL` | 否 | - | 自定义 API 端点 |
| `LLM_MAX_RETRIES` | 否 | `3` | 最大重试次数 |
| `HOST` | 否 | `0.0.0.0` | 服务主机地址 |
| `PORT` | 否 | `3000` | 服务端口 |
| `WORKSPACE_PATH` | 否 | `./workspace` | Agent 工作目录 |
| `DB_PATH` | 否 | `./data/my-agent.db` | SQLite 数据库路径 |

---

## 开发路线

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 1 | monorepo 搭建、LLM 抽象层、基础工具、单 Agent 对话循环 | ✅ 完成 |
| Phase 2 | Harness 核心：权限沙箱 + Hooks 引擎 + 上下文管理 | ✅ 完成 |
| Phase 3 | LangGraph Orchestrator + WorkerAgent 派发 | ✅ 完成 |
| Phase 4 | API Gateway (Fastify + WebSocket) + 数据库 | ✅ 完成 |
| Phase 5 | React 聊天界面 + 流式显示 + 审批卡片 | ✅ 完成 |
| Step 1 | EventBus + StateManager 基础设施 | ✅ 完成 |
| Step 2 | ExecutionEngine + Checkpoint + Memory 三层记忆 | ✅ 完成 |
| Step 3 | Agent 基类 + AgentRegistry + 角色定义 | ✅ 完成 |
| Step 4 | Orchestrator 改造：双通道 Dispatcher + Replanner + Finalizer | ✅ 完成 |
| Step 5 | 角色 Agent（Code/Test/Doc）+ Storage 扩展 + 端到端集成 | ✅ 完成 |
| — | CLI REPL entry point | ✅ 完成 |

---

## 文档索引

- [需求设计文档](docs/2026-07-02-general-agent-design.md) — 产品需求与架构设计
- [技术实现文档](docs/2026-07-02-technical-implementation.md) — 详细技术方案与代码示例
- [多 Agent 架构改进设计](docs/superpowers/specs/2026-07-15-multi-agent-architecture-design.md) — 五层架构设计总览
- [Step 1 — EventBus + StateManager](docs/superpowers/specs/2026-07-15-step1-event-bus-state-manager.md)
- [Step 2 — ExecutionEngine + Checkpoint + Memory](docs/superpowers/specs/2026-07-15-step2-runtime-upgrade.md)
- [Step 3 — Agent 基类 + AgentRegistry](docs/superpowers/specs/2026-07-15-step3-agent-base-class.md)
- [Step 4 — Orchestrator 改造](docs/superpowers/specs/2026-07-15-step4-orchestrator-refactor.md)
- [Step 5 — 角色 Agent + Storage + 集成](docs/superpowers/specs/2026-07-15-step5-role-agents-integration.md)
- [实现计划 01 — Monorepo](docs/implementation-plan-01-monorepo.md)
- [实现计划 02 — LLM 抽象层](docs/implementation-plan-02-llm-abstraction.md)
- [实现计划 03 — 工具层](docs/implementation-plan-03-tools-layer.md)
- [实现计划 04 — Agent Runtime](docs/implementation-plan-04-agent-runtime.md)
- [实现计划 05 — Agent 编排](docs/implementation-plan-05-agent-orchestration.md)
- [实现计划 06 — API Gateway](docs/implementation-plan-06-api-gateway.md)
- [实现计划 07 — 数据库](docs/implementation-plan-07-database.md)
- [实现计划 08 — Web 前端](docs/implementation-plan-08-web-frontend.md)

---

## License

MIT
