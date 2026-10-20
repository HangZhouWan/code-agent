# Code Agent

角色分工型多 Agent 协作平台 —— 用户以自然语言下达指令，Orchestrator 自动规划并派发任务给各角色 Agent（Code / Test / Doc），Agent 之间通过 Event Bus 互相发现、通信、协作，支持动态任务分配和中途恢复。

项目以学习为核心目的，重点关注 **运行时基础设施（Harness Engineering）**：权限沙箱、Hooks 机制、上下文管理、Event Bus 通信、Checkpoint 恢复。

---

## 架构概览

> **架构状态（2026-10）**：项目已完成架构重写。完整设计见 [docs/architecture/overview.md](docs/architecture/overview.md)；下文功能说明保留作能力参考，实现细节与协议以架构文档为准。

```
                User
                  │
        ┌─────────┴─────────┐
      Web UI              CLI
        │                  │
   Fastify Gateway     Runtime Adapters
        └─────────┬────────┘
                  │
          @code-agent/runtime
     AgentSession + LangGraph
                  │
          @code-agent/core
  Harness：tools / permissions / hooks /
  context / memory / checkpoint / engine
                  │
          @code-agent/protocol
```

- **单向依赖**：`protocol ← core ← runtime ← {server, cli}`，`web ← protocol`。
- **统一会话核心**：`AgentSession` 输出域事件流，WebSocket / CLI 只做协议适配。
- **角色多 Agent**：Code / Test / Doc / Review，支持 direct 与 Event Bus 双通道派发。
- **可恢复**：会话级 + 任务级 checkpoint，租约、原子写、副作用分类。
- **统一配置**：全局 / 项目 / .env / 环境变量由同一个 loader 合并。

## 项目结构

```
code-agent/
├── pnpm-workspace.yaml
├── package.json / tsconfig.json / tsconfig.base.json
├── docs/
│   └── architecture/                # 新架构设计（overview/packages/protocol/…）
├── packages/
│   ├── protocol/                    # @code-agent/protocol — 跨包契约（浏览器安全）
│   ├── core/                        # @code-agent/core — Harness 原语
│   │   └── src/{config,llm,tools,permissions,hooks,context,memory,checkpoint,execution,bus,state}
│   ├── runtime/                     # @code-agent/runtime — AgentSession + LangGraph 编排
│   ├── server/                      # @code-agent/server — Fastify + SQLite 端口实现
│   ├── cli/                         # @code-agent/cli — REPL / print / setup（唯一发布包）
│   ├── web/                         # @code-agent/web — React UI（聊天 + 只读工作区）
│   └── testkit/                     # @code-agent/testkit — 测试 fakes / fixtures
```

## 架构文档

- [总览](docs/architecture/overview.md)
- [包结构](docs/architecture/packages.md)
- [协议](docs/architecture/protocol.md)
- [Core / Harness](docs/architecture/harness.md)
- [Runtime / AgentSession](docs/architecture/runtime.md)
- [适配器](docs/architecture/adapters.md)
- [关键决策](docs/architecture/decisions.md)

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

### 2. 配置 LLM

**方式一（推荐）：首次启动后通过页面配置。** 未配置时 server 会进入 setup 模式，打开 `http://localhost:5173` 按提示选择 Provider、填写 API Key 即可，配置写入 `~/.code-agent/config.json`。

**方式二：使用环境变量。**

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

> 配置目录可用 `CODE_AGENT_HOME` 覆盖（默认 `~/.code-agent`）。

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

会先执行一次 `tsc -b`，然后并行启动：
- **@code-agent/server**：后端服务，默认监听 `http://localhost:3000`（`tsx watch`）
- **@code-agent/web**：前端开发服务器，默认 `http://localhost:5173`（Vite）

> 请访问 Vite 地址 `http://localhost:5173`，它会把 `/api` 和 WebSocket 代理到后端。

也可以只启动其中一部分：

```bash
pnpm dev:server   # 只启动后端
pnpm dev:web      # 只启动前端
pnpm dev:cli      # 只启动 CLI REPL（相当于 pnpm cli）
```

### 4. 启动 CLI REPL（可选）

#### 本地开发

```bash
pnpm cli
```

#### 全局安装（npm）

```bash
npm install -g code-agent
```

启动后即可在任何目录使用 Claude Code 式的交互命令行：

```
$ code-agent
```

**使用方式：**

```bash
code-agent                          # 以当前目录为工作区，启动 REPL
code-agent /path/to/project         # 以指定目录为工作区，启动 REPL
code-agent "帮我分析这个项目"         # 非交互模式：执行单次查询后退出
code-agent -p "列出所有 TS 文件"     # --print 模式
code-agent -m claude-opus-4-8       # 指定模型启动 REPL
```

**启动输出示例：**

```
── code-agent ──
workspace: /Users/qichen/projects/my-app
model: anthropic/claude-sonnet-4-5
输入 /help 查看命令，/exit 退出

> 帮我检查 git 状态并生成一个 commit 信息
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
# 启动 CLI REPL（本地开发）
pnpm cli

# 类型检查
pnpm typecheck

# 生产构建（tsc + esbuild 打包 core+server 到 CLI）
pnpm build

# 运行测试
pnpm -r test

# 发布到 npm（打包为单一 code-agent 包）
cd packages/cli && pnpm publish:npm
# 或从根目录：pnpm publish:cli
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
- 持久化到文件系统（`~/.code-agent/checkpoints/`）

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
| `GET` | `/api/health` | 健康检查 |
| `GET` / `POST` | `/api/sessions` | 列出 / 创建会话 |
| `GET` | `/api/sessions/:id/history` | 会话与消息历史 |
| `PATCH` | `/api/sessions/:id/title` | 更新标题 |
| `DELETE` | `/api/sessions/:id` | 删除会话 |
| `WS` | `/api/sessions/:id/chat` | 会话事件流 |
| `POST` | `/api/tools/:callId/approve` | 审批 fallback（需要 sessionId） |
| `GET` | `/api/config/status` | 是否已完成配置 |
| `GET` | `/api/config/providers` | Provider 元数据 |
| `POST` | `/api/config` | 保存全局配置 |
| `GET` | `/api/agents` | 角色列表 |
| `GET` | `/api/memory` | 列出/筛选长期记忆 |
| `GET` | `/api/memory/search` | 搜索长期记忆 |
| `PATCH` | `/api/memory/:id` | 审核/编辑/置顶记忆 |
| `DELETE` | `/api/memory/:id` | 删除记忆 |
| `GET` | `/api/workspace/tree` | 目录懒加载 |
| `GET` | `/api/workspace/file` | 只读文件内容 |
| `GET` | `/api/workspace/diff` | 文件 diff |
| `GET` | `/api/workspace/git/status` | Git 状态 |
| `WS` | `/api/workspace/events` | 工作区变更通知 |

### WebSocket 消息协议

**客户端 → 服务端**：

```json
{ "type": "message", "content": "帮我重构这段代码" }
{ "type": "approval", "callId": "xxx", "approved": true }
{ "type": "answer", "questionId": "xxx", "answer": "yes" }
{ "type": "abort", "runId": "xxx", "reason": "user cancelled" }
{ "type": "resume", "runId": "xxx" }
```

**服务端 → 客户端**：

```json
{ "type": "ready", "sessionId": "xxx", "lastSeq": 0 }
{ "type": "event", "event": { "v": 1, "sessionId": "...", "runId": "...", "seq": 1, "ts": "...", "event": { "type": "message.delta", "delta": "..." } } }
{ "type": "error", "error": { "code": "INTERNAL", "message": "...", "retryable": false } }
```

`SessionEvent` 的完整类型见 [protocol.md](docs/architecture/protocol.md)。


## 配置参考

### 分层配置（CLI）

CLI 支持分层配置，优先级从低到高：

1. **全局配置** `~/.code-agent/config.json`
2. **项目配置** `$WORKSPACE/.code-agent/config.json`
3. **环境文件** `$WORKSPACE/.env` → monorepo 根目录 `.env`
4. **环境变量** `process.env`
5. **CLI 标志** `-m` / `--model`

全局配置除 LLM 参数外还可保存 `WORKSPACE_PATH`，作为 Code Agent 的默认工作目录。
Web 首次配置页和设置页（Settings）均可修改该值；未配置时使用服务启动目录，
环境变量 / 启动参数仍具有更高优先级。

设置页还可开启 **Auto mode**（`AUTO_MODE=true`）：工作区内的文件写入/修改和
shell 命令执行不再弹出人工审批。路径逃逸与高危命令（`sudo`、`rm -rf /` 等）
仍会被拒绝。

### 环境变量

完整环境变量列表见 `.env.example`：

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `LLM_PROVIDER` | 是 | `openai` | LLM 提供商 |
| `LLM_MODEL` | 是 | `gpt-4o` | 模型名称 |
| `LLM_API_KEY` | 是 | - | API 密钥 |
| `LLM_BASE_URL` | 否 | - | 自定义 API 端点 |
| `LLM_MAX_RETRIES` | 否 | `3` | 最大重试次数 |
| `HOST` | 否 | `127.0.0.1` | 服务主机地址 |
| `PORT` | 否 | `3000` | 服务端口 |
| `WORKSPACE_PATH` | 否 | 当前目录 | Agent 工作目录 |
| `AUTO_MODE` | 否 | `false` | Auto mode：工作区内写入/命令执行免人工审批 |
| `DB_PATH` | 否 | `<workspace>/.agent/data/code-agent.db` | SQLite 数据库路径 |

---

## 开发路线

| 阶段 | 内容 | 状态 |
|------|------|------|
| Phase 0 | 架构设计落盘 + 基线工具链 | ✅ |
| Phase 1 | `@code-agent/protocol` 契约 | ✅ |
| Phase 2 | core 统一配置 / 路径 / LLM | ✅ |
| Phase 3 | core 工具 / 权限 / 上下文 / 记忆 | ✅ |
| Phase 4 | core bus / state / checkpoint / execution | ✅ |
| Phase 5 | runtime AgentSession 会话平面 | ✅ |
| Phase 6 | LangGraph 编排 + direct/bus dispatcher | ✅ |
| Phase 7 | 显式恢复 / 租约 / 副作用策略 | ✅ |
| Phase 8 | CLI 切换到 runtime | ✅ |
| Phase 9 | Server 切换到 runtime + SQLite ports | ✅ |
| Phase 10 | Web 协议迁移 + 只读工作区 | ✅ |
| Phase 11 | 清理 legacy + 最终验证 | ✅ |


## 文档索引

**新架构（当前）**

- [架构总览](docs/architecture/overview.md)
- [包结构](docs/architecture/packages.md)
- [协议](docs/architecture/protocol.md)
- [Core / Harness](docs/architecture/harness.md)
- [Runtime / AgentSession](docs/architecture/runtime.md)
- [适配器](docs/architecture/adapters.md)
- [关键决策](docs/architecture/decisions.md)

**历史设计资料**

- [多 Agent 架构改进设计](docs/superpowers/specs/2026-07-15-multi-agent-architecture-design.md)
- [技术实现文档](docs/2026-07-02-technical-implementation.md)
- `docs/implementation-plan-*.md`、`docs/superpowers/plans/*`、`docs/superpowers/specs/*`


## License

MIT
