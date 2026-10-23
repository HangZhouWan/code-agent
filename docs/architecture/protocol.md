# Protocol 包

`@code-agent/protocol` 是 Web、Server、CLI、Runtime 之间唯一的契约来源，必须浏览器安全。

## 1. 基础类型

- `JsonValue`：可序列化的 JSON 值。
- `IsoTimestamp`：ISO 8601 字符串。
- Branded IDs：`SessionId`、`RunId`、`TaskId`、`CallId`、`AgentId`、`AgentRunId`。
- `ErrorCode` / `SerializedError` / `ApiError`：统一错误分类。

```ts
type ErrorCode =
  | 'VALIDATION' | 'SESSION_BUSY' | 'RUN_NOT_FOUND'
  | 'APPROVAL_NOT_FOUND' | 'APPROVAL_DENIED'
  | 'LLM_RETRYABLE' | 'LLM_FATAL' | 'TOOL_FAILED'
  | 'TIMEOUT' | 'BUS_TIMEOUT' | 'CONTEXT_OVERFLOW'
  | 'CHECKPOINT_INCOMPATIBLE' | 'RESUME_SIDE_EFFECT_UNCERTAIN'
  | 'PERSISTENCE_FAILED' | 'INTERNAL';
```

## 2. 配置 schema

- `llmConfigSchema`：完整配置（provider/model/key/baseURL/maxRetries）。
- `llmOverridesSchema`：partial，用于项目级覆盖。
- `appConfigSchema`：host/port/workspace/db path 等。
- `contextConfigSchema`：阈值、预算、摘要模型。
- `PROVIDER_DEFINITIONS`：id / label / defaultModel / defaultBaseUrl / requiresApiKey / modelWindow。

配置值为 env 风格大写键（`LLM_PROVIDER` 等），由 core 的 Node loader 合并。

## 3. Domain DTO

- `RoleDefinition` / `AgentRoleId`
- `Plan` / `SubTask` / `TaskStatus`
- `TaskResult` / `TaskRecord` / `Artifact`
- `ChatMessage` / `MessageRole`
- `SessionSummary` / `SessionSnapshot` / `RunSummary`
- `MemoryRecord` / `MemoryOp` / `MemoryScope`
- `ApprovalRequest` / `UserQuestion`

所有时间使用 `IsoTimestamp`，所有 ID 使用 branded string。

## 4. 事件目录

Command（独占投递）：

```ts
type AgentCommandTopic = `agent.command.${AgentRoleId}`;
interface AgentCommandPayload { task: SubTask; context: string; runId: RunId; taskId: TaskId; }
```

Event（广播）：

- `agent.event.task.started/completed/failed/blocked`
- `agent.event.checkpoint.saved`
- `agent.event.memory.updated`

`BusEnvelope` 包含 `id/topic/payload/meta`，meta 强制 `sessionId/runId/taskId/senderId/timestamp/schemaVersion`。

## 5. SessionEvent

传输无关的域事件联合：

```ts
type SessionEvent =
  | { type: 'run.started'; input: UserTurnInput }
  | { type: 'message.delta'; messageId: string; delta: string }
  | { type: 'message.completed'; message: ChatMessage }
  | { type: 'tool.started'; callId: CallId; toolName: string; args: JsonValue }
  | { type: 'tool.finished'; callId: CallId; ok: boolean; resultPreview: string; durationMs: number }
  | { type: 'approval.required'; request: ApprovalRequest }
  | { type: 'approval.resolved'; callId: CallId; decision: ApprovalDecision }
  | { type: 'user.question.required'; question: UserQuestion }
  | { type: 'user.question.resolved'; questionId: string; answer: string }
  | { type: 'task.status'; taskId: TaskId; roleId: AgentRoleId; status: TaskStatus }
  | { type: 'plan.updated'; plan: Plan }
  | { type: 'checkpoint.saved'; checkpointId: string; node: string }
  | { type: 'context.compacted'; beforeTokens: number; afterTokens: number; strategy: string }
  | { type: 'session.title.updated'; sessionId: SessionId; title: string }
  | { type: 'run.completed'; result: RunResult }
  | { type: 'run.failed'; error: SerializedError }
  | { type: 'run.aborted'; reason: string };
```

`EventEnvelope<T>` 增加 `v/id/sessionId/runId/seq/ts`，`seq` 用于断线重连 `afterSeq` 回放。

## 6. Wire DTO

- `ClientWsMessage`：`message` / `approval` / `answer` / `abort` / `resume`。
- `ServerWsMessage`：`ready` / `event` / `error`。
- REST DTO：sessions / messages / runs / config / providers / agents / workspace。
- `parse.ts` 提供所有入站消息的 zod parser；服务端和 Web 都不得裸 cast。

## 7. 版本策略

- `EventEnvelope.v = 1`，checkpoint 也有独立 `v`。
- 版本不兼容时返回 `CHECKPOINT_INCOMPATIBLE`，不静默降级。
- 协议破坏性变更必须同步更新 Web/Server/CLI 与测试。
