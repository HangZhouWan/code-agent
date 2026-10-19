# 新架构总览

> 状态：已批准，按阶段实施  
> 取代：旧五层架构文档（作为历史资料保留）

## 1. 背景

旧架构在 core / server / web / cli 四个包中形成了多套并行实现：两套上下文压缩、两套 checkpoint、多个执行运行时、五份配置 schema，以及一条实际不可用的 Event Bus 路由。继续增量修补的成本高于重建。

本架构是一次允许破坏性变更的重写，不要求兼容旧接口。

## 2. 目标

1. **单向依赖**：`protocol ← core ← runtime ← {server, cli}`，`web ← protocol`。
2. **单一配置源**：全局 / 项目 / .env / 环境变量 / 启动参数由同一个 loader 合并。
3. **单一执行运行时**：角色 Agent 只通过 `ExecutionEngine` 执行，direct 与 bus 共用同一个 `AgentInvoker`。
4. **传输无关的会话核心**：`AgentSession` 产生域事件流，CLI / WebSocket / HTTP 只是适配器。
5. **可恢复**：会话级 + 任务级 checkpoint，原子写、租约、副作用分类。
6. **可扩展**：新增角色、工具、Provider、Hook 不需要修改适配器。
7. **可验证**：干净检出下 `pnpm verify` 通过；关键链路有集成测试。

## 3. 非目标（本期）

- 前端编辑/保存文件（只读浏览 + diff）。
- 向量/embedding 记忆检索。
- MCP、Skill、浏览器 IDE 全功能（Monaco/LSP）。
- 多进程分布式执行。

## 4. 包职责

| 包 | 职责 |
|---|---|
| `@code-agent/protocol` | 浏览器安全的类型与 schema：DTO、事件目录、WS/REST 协议、错误码、配置 schema |
| `@code-agent/core` | Harness 原语：LLM、配置、工具、权限、Hooks、上下文、记忆、Checkpoint、执行引擎、Agent 契约 |
| `@code-agent/runtime` | 应用层：AgentSession、LangGraph 编排、dispatcher、审批/提问、恢复、持久化端口 |
| `@code-agent/server` | Fastify 网关 + SQLite/Drizzle 端口实现 |
| `@code-agent/cli` | REPL / print / setup 适配器（唯一可发布包） |
| `@code-agent/web` | React UI，只依赖 protocol |
| `@code-agent/testkit` | 私有测试 fakes / fixtures（仅开发） |

## 5. 进程级与会话级

```
Harness（进程级）
  model / tools / permissions / hooks / memory / config / paths / writeLock
        │
        ▼
Runtime
  createSession()
        │
        ▼
AgentSession（每会话）
  EventBus / StateManager / AgentPool / ApprovalService / UserQuestionService
  Checkpoint / RunController / 持久化端口
```

- 进程级共享模型、工具注册表、权限策略、长期记忆、工作区写锁。
- 每会话独立的 bus/state/agents，支持多会话并发。
- `AgentSession` 由 runtime 创建，避免 core → runtime 循环依赖。

## 6. 一次请求的数据流

```
用户消息
  → AgentSession.run()
  → 记忆检索 + 上下文构建
  → LangGraph Planner
  → Dispatcher（direct | bus）
  → 角色 Agent 的 ExecutionEngine（原生 tool calling）
  → 工具 / 审批 / 记忆工具
  → TaskResult
  → Replanner / Finalizer
  → SessionEvent 流
  → WS / CLI / HTTP 适配器
  → 会话结束 → 异步记忆提炼
```

## 7. 文档索引

- [包结构](packages.md)
- [协议](protocol.md)
- [Core / Harness](harness.md)
- [Runtime / AgentSession](runtime.md)
- [适配器](adapters.md)
- [关键决策](decisions.md)
