# Code Agent

通用 code Agent 平台 —— 用户以自然语言下达指令，Agent 自主完成「理解意图 → 规划 → 调用工具执行 → 反馈结果」的闭环。

项目以学习为核心目的，重点关注 **运行时基础设施（Harness Engineering）**：权限沙箱、Hooks 机制、上下文管理。

---

## 架构概览

```
┌─────────────────────────────────────────┐
│            Web Chat UI (前端)             │
├─────────────────────────────────────────┤
│            API Gateway (ws/http)         │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐    │
│  │       主 Agent (Orchestrator)    │    │
│  │  - 理解用户意图                   │    │
│  │  - 拆解任务                      │    │
│  │  - 派发子 Agent                  │    │
│  │  - 汇总结果                      │    │
│  └──────────┬──────────────────────┘    │
│             │ dispatch                   │
│  ┌──────────▼──────────────────────┐    │
│  │       子 Agent (Worker)          │    │
│  │  - 独立上下文                    │    │
│  │  - 独立工具权限                  │    │
│  │  - 执行后归还结果                │    │
│  └─────────────────────────────────┘    │
├─────────────────────────────────────────┤
│          Agent Runtime (Harness)         │
│  ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │ 权限沙箱  │ │ Hooks  │ │ 上下文管理 │  │
│  └──────────┘ └────────┘ └───────────┘  │
├─────────────────────────────────────────┤
│              工具层 (Tools)              │
│  File │ Shell │ Code Search │ Git │ Web │
├─────────────────────────────────────────┤
│          LLM 抽象层 (Model Adapter)       │
│    OpenAI  │  Anthropic  │  Others...    │
└─────────────────────────────────────────┘
```

### 核心设计约束

- **Harness 是唯一执行通道**：Agent 不能绕过 Runtime 直接调用工具或 LLM
- **主 Agent 和子 Agent 共享同一套 Runtime**，但拥有独立的上下文和受限的工具权限
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
├── pnpm-workspace.yaml              # monorepo 工作空间配置
├── package.json                     # 根 workspace 脚本
├── tsconfig.base.json               # 共享 TypeScript 配置
├── .env.example                     # 环境变量模板
├── docs/                            # 需求文档 & 技术文档
│   ├── 2026-07-02-general-agent-design.md
│   ├── 2026-07-02-technical-implementation.md
│   └── implementation-plan-*.md     # 各模块实现计划
├── packages/
│   ├── core/                        # @my-agent/core — 核心引擎
│   │   └── src/
│   │       ├── llm/                 # LLM 抽象层（工厂、协议检测、重试）
│   │       ├── tools/               # 工具层（File、Shell、Search、Git、Web）
│   │       ├── harness/             # Agent Runtime
│   │       │   ├── sandbox/         #   权限沙箱（注册表 + 守卫）
│   │       │   ├── hooks/           #   Hooks 引擎 + 内置 Hooks
│   │       │   └── context/         #   上下文管理 + 压缩
│   │       └── agent/               # 子 Agent (Worker)
│   │
│   ├── server/                      # @my-agent/server — 后端服务
│   │   └── src/
│   │       ├── gateway/             # Fastify HTTP + WebSocket 网关
│   │       │   ├── routes/          #   RESTful 路由（会话、工具审批）
│   │       │   ├── ws/              #   WebSocket 聊天端点
│   │       │   └── middleware/      #   全局错误处理
│   │       ├── orchestrator/        # LangGraph 编排器
│   │       │   └── nodes/           #   planner / dispatcher / summarizer
│   │       └── db/                  # SQLite 数据库
│   │           ├── schema.ts        #   Drizzle schema
│   │           ├── connection.ts    #   数据库连接
│   │           └── repositories/    #   数据访问层
│   │
│   └── web/                         # @my-agent/web — React 前端
│       └── src/
│           ├── components/          # UI 组件
│           │   ├── Sidebar.tsx      #   会话列表
│           │   ├── ChatArea.tsx     #   聊天主区域
│           │   ├── MessageList.tsx  #   消息列表
│           │   ├── TextMessage.tsx  #   Markdown 消息渲染
│           │   ├── ToolCallCard.tsx #   工具调用状态卡片
│           │   ├── ConfirmCard.tsx  #   危险操作审批卡片
│           │   └── InputBar.tsx     #   消息输入框
│           ├── hooks/               # 自定义 Hooks
│           │   ├── useWebSocket.ts  #   WebSocket 连接管理
│           │   └── useSessions.ts   #   会话状态管理
│           └── stores/              # 状态管理
│               └── chatStore.ts     #   聊天消息状态
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

### 4. 其他常用命令

```bash
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

用户输入自然语言指令后，**主 Agent（Orchestrator）** 自动：
1. **分析意图**，生成结构化执行计划（子任务列表，含依赖关系）
2. **并行派发**独立子任务给多个 Worker Agent
3. **串行执行**有数据依赖的子任务
4. **汇总结果**，生成最终回复

### 🛡️ 三层权限沙箱

每次工具调用都经过 Runtime 校验：

| 级别 | 行为 | 示例 |
|------|------|------|
| **安全级** (safe) | 直接放行 | 读文件、搜索代码、HTTP GET |
| **需确认级** (confirm) | 弹出审批卡片，等待用户确认 | 写文件、执行 Shell、git commit |
| **高危级** (deny) | 直接拒绝 | `rm -rf /`、`sudo`、`curl \| bash` |

子 Agent 启动时声明能力范围（`tools` + `paths`），超出范围的调用会被自动拦截。

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

### 📝 上下文管理

- 每个 Agent 维护独立的对话上下文
- Token 用量追踪：超过阈值（80%）时自动触发压缩
- 压缩策略：滑动窗口 + 滚动摘要，保留最近消息的完整内容
- 子 Agent 从主 Agent 继承上下文摘要，不继承完整历史

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

| 阶段 | 内容 | 预计时间 |
|------|------|----------|
| Phase 1 | monorepo 搭建、LLM 抽象层、基础工具、单 Agent 对话循环 | 第 1 周 |
| Phase 2 | Harness 核心：权限沙箱 + Hooks 引擎 + 上下文管理 | 第 2-3 周 |
| Phase 3 | LangGraph Orchestrator + 子 Agent 派发 | 第 3-4 周 |
| Phase 4 | API Gateway (Fastify + WebSocket) + 数据库 | 第 4-5 周 |
| Phase 5 | React 聊天界面 + 流式显示 + 审批卡片 | 第 5-6 周 |
| Phase 6 | 测试、调试、文档、边界情况处理 | 第 6-8 周 |

---

## 文档索引

- [需求设计文档](docs/2026-07-02-general-agent-design.md) — 产品需求与架构设计
- [技术实现文档](docs/2026-07-02-technical-implementation.md) — 详细技术方案与代码示例
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
