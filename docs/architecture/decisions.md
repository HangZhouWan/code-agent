# 关键架构决策（ADR）

## ADR-001：拆分为 protocol / core / runtime / adapters

**决定**：新增 `@code-agent/protocol` 与 `@code-agent/runtime`；server/cli 成为薄适配器；web 只依赖 protocol。

**理由**：消除 Web/Server 协议重复、CLI→Server 依赖、core 反向依赖风险。

## ADR-002：统一 AgentSession + RunHandle

**决定**：会话运行时输出域事件流；`run()` 返回 `{ runId, events, done, abort }`。

**理由**：让 WS/CLI/HTTP 复用同一执行核心；支持 abort、重连、seq 回放、终止状态独立于流消费。

## ADR-003：保留 LangGraph，但只作为实现细节

**决定**：Planner → Dispatcher → Replanner → Finalizer 仍用 LangGraph；不把图状态/streamEvents 暴露到 wire。

**理由**：保留编排能力，同时避免传输协议与框架耦合。

## ADR-004：Event Bus 类型化 + Command 独占投递

**决定**：Command 按 role group 独占投递；Event 广播；`request/reply/fail` 有明确契约。

**理由**：修复旧实现 topic 不匹配、从不 reply、同角色重复执行的问题。

## ADR-005：单入口 delegate_task，子 Agent 不是工具

**决定**：只暴露 `delegate_task(role, ...)`；子 Agent 是运行时 AgentRun。

**理由**：避免工具爆炸、权限重复、递归失控；统一深度/并发/预算限制。

## ADR-006：Agent 无持久状态

**决定**：不保存 Agent.status/currentTaskId；每个任务创建独立 AgentRun；UI 状态由 TaskState 派生。

**理由**：支持并发任务，消除三份状态不一致。

## ADR-007：原生 tool calling 为主

**决定**：`bindTools` + `tool_calls` + `ToolMessage`；JSON thought parser 只作 fallback。

**理由**：更可靠、可测试，避免手写 JSON 解析导致误判成功。

## ADR-008：自有 SessionCheckpoint，不混用 LangGraph checkpointer

**决定**：会话级 + 任务级两层快照，版本化、原子写、租约。

**理由**：需要业务字段（TaskResult/artifacts/审批/seq）；混用会导致恢复不完整。

## ADR-009：显式恢复 + 副作用分类

**决定**：启动不自动恢复；mutating 且结果未知标记 `RESUME_SIDE_EFFECT_UNCERTAIN`；Agent checkpoint 写失败降级继续，Session checkpoint 写失败终止。

**理由**：避免重复副作用与静默破坏可恢复性。

## ADR-010：上下文压缩 artifact-first

**决定**：先外置工具输出，再去重/滑窗，最后 LLM 结构化摘要 + 确定性降级。

**理由**：大多数膨胀来自工具输出，摘要不是第一手段；保护 tool pair 与 pinned 内容。

## ADR-011：长期记忆不用 embedding

**决定**：成功 run 后 LLM 提炼 `MemoryOp`；FTS/trigram + keywords 检索；workspace + user 双作用域；自动 + 低置信度审核。

**理由**：记忆量小、标识符多，关键词检索更准；避免 embedding 依赖、费用和黑盒。

## ADR-012：工作区浏览只读

**决定**：本期只做文件树 + 只读 CodeMirror + diff；不做前端编辑/保存。

**理由**：避免与 Agent 写入的冲突同步，先把只读链路做稳；编辑版后续加 etag。

## ADR-013：只有 CLI 可发布

**决定**：protocol/core/runtime/server/web/testkit 全部 `private: true`；CLI bundle 打入 workspace 源码。

**理由**：简化发布元数据与 exports conditions；避免内部包版本管理。

## ADR-014：配置单一 loader

**决定**：protocol 拥有纯 schema；core 拥有唯一 Node loader；server/CLI 共用。

**理由**：修复 setup 后 server 仍读不到全局配置的漂移问题。
