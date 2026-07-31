# CLI REPL Entry Point

**日期**：2026-07-30
**状态**：设计完成，待实现

## 目标

为 agent 系统增加命令行交互入口（REPL），使用户可以直接在终端中与 agent 进行多轮对话，无需启动 Web 服务。

## 方案

新增 `packages/cli` 包，复用 `@code-agent/core` 和 `@code-agent/server` 的 Orchestrator Graph，以 `node:readline` 替代 WebSocket 作为 I/O 层，提供完整的交互式 REPL 体验。

### CLI 交互模式

- 运行 `code-agent` 启动交互式 REPL
- 多轮对话上下文在会话内累积（`messages[]` 数组）
- 以 `/` 开头的输入作为 REPL 命令处理
- Ctrl+C 在任务运行时取消任务，在空提示符时退出

## 包结构

```
packages/cli/
├── package.json          # bin: { "code-agent": "./dist/index.js" }
├── tsconfig.json         # extends ../../tsconfig.base.json
├── src/
│   ├── index.ts          # main() — 装配依赖，启动 REPL
│   ├── repl.ts           # REPL 循环 — readline、命令分发、消息流
│   ├── commands.ts       # REPL 命令：/clear, /history, /agents, /tools, /help, /exit
│   ├── format.ts         # 终端输出格式化 — 颜色、工具指示器、流式输出
│   └── approval.ts       # 交互式工具审批（stdin prompt）
└── __tests__/
    └── repl.test.ts
```

### 依赖

| 包 | 用途 |
|---|---|
| `@code-agent/core` (workspace) | createChatModel, ToolRegistry, AgentRegistry, ExecutionEngine, EventBus, StateManager, Memory |
| `@code-agent/server` (workspace) | createOrchestratorGraph, loadConfig |

## 架构

```
packages/cli/src/index.ts (main)
  ├── loadConfig()           ← .env
  ├── createChatModel()
  ├── ToolRegistry (11 tools)
  ├── PermissionRegistry
  ├── InMemoryEventBus
  ├── InMemoryStateManager
  ├── 3-tier Memory
  ├── FileCheckpointManager
  ├── ExecutionEngine
  ├── AgentRegistry (code/test/doc)
  │
  └── REPL loop  ← stdin/stdout
       ├── node:readline
       ├── streamOrchestrator() → stdout
       ├── approval → stdin prompt
       └── commands (/clear, /help, /exit, ...)
```

与 Web 入口 (`packages/server/src/index.ts`) 的区别：
- **无 Fastify、HTTP、WebSocket** — 替换为 `node:readline`
- **无数据库** — 会话历史存内存，不持久化
- **审批通过 stdin** — 直接在终端交互，不走 WebSocket 推送
- **流式输出到 stdout** — `graph.streamEvents()` 输出经格式化后写入终端

## REPL 循环

```
1. 显示提示符  →  "code-agent > "

2. 读取用户输入
   │
   ├── 以 "/" 开头 → handleCommand()
   │   /clear      → 重置 messages[]
   │   /history    → 打印消息历史摘要
   │   /agents     → 打印 agent 状态表格
   │   /tools      → 列出已注册工具
   │   /help       → 显示可用命令
   │   /exit       → 优雅关闭
   │
   └── 其他       → processMessage(input)
       │
       ├── 3. 追加 HumanMessage 到 messages[]
       │
       ├── 4. streamOrchestrator({ messages })
       │     │
       │     ├── on_chat_model_stream
       │     │   → 流式输出到终端（绿色文本）
       │     │
       │     ├── on_tool_start
       │     │   → 打印 🛠 tool_name args...
       │     │
       │     ├── on_tool_end
       │     │   → 打印结果（暗色/灰色）
       │     │
       │     ├── on_chain_end (finalizer)
       │     │   → 追加 AIMessage 到 messages[]
       │     │   → 打印最终回复
       │     │
       │     └── confirm_required
       │         → readline 询问 "Approve? [y/N]"
       │
       └── 5. 回到提示符
```

## REPL 命令

| 命令 | 功能 |
|---|---|
| `/clear` | 清空当前会话的 messages[]，重置上下文 |
| `/history` | 打印消息历史摘要（每条消息的 role + 前 100 字符） |
| `/agents` | 显示 Agent 状态表（role, id, status, currentTask） |
| `/tools` | 列出所有已注册工具的名称和描述 |
| `/help` | 显示可用命令列表 |
| `/exit` 或 Ctrl+C | 优雅关闭 — 停止所有 agent，退出 |

## 输出格式化

- **流式文本**：绿色，逐 token 增量输出
- **工具调用开始**：黄色 `🛠 tool_name(args)`
- **工具调用结果**：暗色/灰色，缩进显示
- **错误**：红色
- **Agent 状态**：表格格式
- **提示符**：加粗绿色 `code-agent >`

使用 ANSI escape codes，零外部依赖。

## 工具审批

Web 版本通过 WebSocket 推送 `confirm_required` 到浏览器等待用户点击。CLI 版本在终端直接交互：

```
🛠 shell_exec({ command: "rm -rf /" })
⚠ This tool requires confirmation.
Approve? [y/N]: █
```

- 默认 120 秒超时后自动拒绝
- 输入 `y`/`yes` → 批准，输入其他/回车 → 拒绝

## 数据流

```
终端用户输入
    │
    ▼
node:readline ──→ REPL loop
    │                  │
    │                  ├── /command ──→ handleCommand() ──→ stdout
    │                  │
    │                  └── message ──→ messages[].push(HumanMessage)
    │                                       │
    │                                       ▼
    │                          createOrchestratorGraph()
    │                                       │
    │                                       ▼
    │                          graph.streamEvents({ messages })
    │                                       │
    │              ┌────────────────────────┼──────────────────────┐
    │              ▼                        ▼                      ▼
    │         on_chat_model_stream    on_tool_start/end    on_chain_end
    │              │                        │                      │
    │              ▼                        ▼                      ▼
    │         stdout (green)          stdout (yellow/dim)    messages[].push(AIMessage)
    │                                                         stdout (final)
    │
    └── 下一轮输入
```

## 涉及文件

### 新增（packages/cli）

| 文件 | 说明 |
|---|---|
| `package.json` | bin 入口 `code-agent`，依赖 core + server |
| `tsconfig.json` | 继承基础 TS 配置 |
| `src/index.ts` | main() — 装配所有依赖，启动 REPL |
| `src/repl.ts` | REPL 循环核心 — readline、消息处理、streamOrchestrator 适配 |
| `src/commands.ts` | 命令处理器 — /clear, /history, /agents, /tools, /help |
| `src/format.ts` | ANSI 终端格式化工具函数 |
| `src/approval.ts` | stdin 交互式工具审批 |
| `__tests__/repl.test.ts` | REPL 核心逻辑测试 |

### 修改（现有包）

无需修改现有包。`@code-agent/core` 和 `@code-agent/server` 已通过 exports 暴露所需的所有 API。

### 根级配置

| 文件 | 改动 |
|---|---|
| `package.json` | `scripts` 加 `"cli": "pnpm --filter @code-agent/cli dev"` |
