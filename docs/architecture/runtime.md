# Runtime / AgentSession

`@code-agent/runtime` 是应用层，依赖 core + protocol，包含会话平面、编排平面、恢复与持久化端口。

## 1. Runtime

```ts
interface Runtime {
  createSession(init: SessionInit): Promise<AgentSession>;
  recoverSessions(opts?: RecoveryOptions): Promise<RecoveryReport>;
  dispose(): Promise<void>;
}
createRuntime(harness: Harness, deps: RuntimeDeps): Runtime;
```

`RuntimeDeps`：clock、ID 生成器、4 个持久化端口。

## 2. AgentSession

```ts
interface AgentSession {
  id: SessionId;
  run(input, opts?): Promise<RunHandle>;
  resume(runId): Promise<RunHandle>;
  subscribe(opts?: { afterSeq?: number }): AsyncIterable<EventEnvelope<SessionEvent>>;
  approve(callId, decision): Promise<boolean>;
  answer(questionId, answer): Promise<boolean>;
  abort(runId, reason?): Promise<void>;
  snapshot(): Promise<SessionSnapshot>;
  dispose(): Promise<void>;
}

interface RunHandle {
  runId: RunId;
  events: AsyncIterable<EventEnvelope<SessionEvent>>;
  done: Promise<RunResult>;
  abort(reason?): void;
}
```

- 每会话同一时刻只允许一个 run（默认 reject；CLI 可 queue-one）。
- 运行在独立 task；事件进入有界缓冲，消费不反压执行。
- `message.delta` 可合并/丢弃；语义事件持久化且不丢弃。
- `seq` 支持 `afterSeq` 回放；终止事件恰好一次。
- 统一 AbortController：中断 LLM/工具/bus，待审批按 denied 解决。

## 3. 事件通道

- 每 run 有独立缓冲 + 可选 EventLog。
- 慢消费者不阻塞执行；语义事件保证严格顺序。
- 终止后关闭所有订阅迭代器。
- 消费方提前 `return()` 默认不中断 run（支持重连）；适配器可配置 `abortOnConsumerClose`。

## 4. 审批与提问

- `ApprovalService`：callId 全局唯一，按 session/run 校验；超时 denied；幂等 resolve；abort 时全部 denied。
- `UserQuestionService`：`ask_user` 发出 `user.question.required`，等待 `answer`；超时/abort 返回错误；pending 写入 checkpoint，恢复时重发。
- 两者都不通过 bus 传回调；子 Agent 通过共享 RunScope 访问。

## 5. 角色与委派

内置 Code / Test / Doc / Review，定义在 runtime：

| 角色 | 可委派 |
|---|---|
| Code | Test / Doc / Review |
| Test | Code（仅修复）/ Doc |
| Doc | 无 |
| Review | 无（只读，返回 findings） |

- 单一 `delegate_task(role, ...)` 工具；子 Agent 是运行时 `AgentRun`，不是工具。
- 最大深度 2、每 run 最多 5 次、全局并发 4、禁止自委派/环路。
- 子 Agent 默认任务级上下文，不继承父对话。
- 结果统一 `TaskResult`，事件携带 `parentTaskId`。

## 6. 派发

```ts
interface TaskDispatcher {
  dispatch(req: DispatchRequest): Promise<TaskResult>;
}
```

- `DirectDispatcher`：AgentPool.invoke。
- `BusDispatcher`：typed `request('agent.command.<role>')`，独占投递。
- 两者契约测试一致；任务生命周期事件由 dispatcher coordinator 统一发出。

## 7. LangGraph 编排

- Planner → Dispatcher → Replanner / Finalizer。
- 节点是工厂函数，依赖注入；不访问 DB/Fastify。
- 只在完整节点边界写 SessionCheckpoint，全部 await。
- `streamEvents` 不直接映射 wire；在 LLM/tool/task 边界产生域事件。
- 使用自有 SessionCheckpoint，不混用 LangGraph checkpointer。

## 8. 恢复

- 默认显式恢复，不在启动时自动重跑。
- 租约（owner + expiresAt）防止多进程重复恢复。
- 从 `resumeNode` 条件入口继续，不从 START 重跑。
- 已完成任务复用 TaskResult；只读/幂等任务可重派；mutating 且结果未知标记 `RESUME_SIDE_EFFECT_UNCERTAIN`。
- 恢复 `nextSeq`，支持前端 `afterSeq` 无缝重连。

## 9. 持久化端口

- `SessionStore`：session + messages + title。
- `RunStore`：run + task + artifact（事务回调保持同步，适配 better-sqlite3）。
- `EventLog`：语义事件按 seq 追加/回放。
- `CheckpointStore`：两层快照 + 租约。
- 持久化顺序：用户消息 → run running → run.started → 工具意图/结果 → 终态事务 → 终止事件 → 标题服务（异步）。

## 10. 记忆与标题

- run 前：按用户消息/任务描述检索记忆，预算注入。
- run 完成后：异步提炼，失败不影响 run；幂等键 runId。
- 标题服务只在首次成功后触发，超时/失败静默降级，幂等。
