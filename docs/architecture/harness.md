# Core / Harness

`@code-agent/core` 只提供与传输、存储无关的 Harness 原语，不依赖 LangGraph、Fastify、Drizzle。

## 1. Harness

```ts
interface Harness {
  model: BaseChatModel;
  tools: ToolRegistry;
  permissions: PermissionPolicy;
  hooks: HooksEngine;
  memory: LongTermMemory;
  config: ResolvedConfig;
  paths: WorkspacePaths;
  writeLock: WorkspaceWriteLock;
}
createHarness(config: ResolvedConfig): Harness;
```

进程级单例：模型、工具、权限、Hooks、长期记忆、配置、路径、工作区写锁。

## 2. 配置与路径

唯一 Node loader，优先级：

```
defaults < 全局 config.json < 项目 .code-agent/config.json
        < 工作区 .env < monorepo .env < process.env < 启动参数
```

- 原子写、权限 0600。
- `resolvePaths()` 统一产出 home/project/data/checkpoint/db 路径。
- Server 与 CLI 共用同一 loader；setup 写入后重启必须可读。
- API 返回 key 的掩码视图。

## 3. LLM

- Provider registry：openai / anthropic / openai-compatible。
- 新增 provider 只需注册 factory + 默认值，不改 adapter。
- 重试只保留一层（LLM wrapper），删除 Agent/step/LangChain 多套超时与重试。
- TokenCounter 按 provider 选择 tokenizer；失败按高估处理。

## 4. 工具与权限

```ts
interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  permission: 'allow' | 'confirm' | Evaluator;
  sideEffect: 'none' | 'idempotent' | 'mutating';
  execute(args, ctx): Promise<ToolResult>;
}
```

- 内置工具自动注册；角色按白名单裁剪。
- 权限是执行中间件，不再有 SAFE/CONFIRM 名单与 tools↔sandbox 环。
- 写操作经过 approval + `WorkspaceWriteLock`。
- `shell_exec` 使用危险模式 deny + 可配置 allowlist + cwd 包含校验。
- 大工具输出外置 artifact，prompt 只保留预览。

## 5. Hooks

固定边界：run 开始/结束、LLM 前/后、tool 前/后、message append。

- Hook 失败必须记录；安全类 hook 可配置为 fail-closed。
- 删除未接入主运行时的 `Agent.hooks` 死字段。

## 6. 上下文压缩

顺序：**artifact 外置 → 去重 → 删除噪声 → 滑窗 → LLM 摘要 → 确定性降级**。

- 预算计入 system prompt、tool schema、记忆、summary、消息、输出预留。
- Pinned：system、工具定义、当前任务、Plan、待审批/提问、最近完整工具周期。
- `tool_call` 与 `ToolMessage` 必须成对，只在周期边界切分。
- summary 有界（1.5–2k tokens），`coveredMessageIds` 防止重复摘要。
- 75% 触发、90% 强制；仍超返回 `CONTEXT_OVERFLOW`。
- 摘要使用独立廉价模型；失败走确定性降级。

## 7. 记忆

- `LongTermMemory` port：store/search/applyOps/list/delete。
- 文件实现（CLI）、SQLite FTS5（server）、内存（testkit）。
- 写入：成功 run 后异步提炼，`MemoryOp` 为 create/update/merge/delete/noop。
- 自动落库阈值 0.8；低置信度进入 `pending_review`。
- workspace + user 双作用域；secret-filter；防止记忆投毒。
- 检索使用 FTS/trigram + LLM 生成的 keywords，不使用 embedding。

## 8. State 与 Checkpoint

- StateManager 只保存每会话的 Task / Artifact；Agent 无持久状态。
- `AgentCheckpointV1`：step、messages（JSON-safe）、toolHistory、pendingTool、summary、coveredMessageIds。
- `CheckpointStore`：save/load/list/purge/lease；File / SQLite / InMemory。
- 原子写（temp + fsync + rename）；路径按 sessionId/runId 命名空间。
- Agent checkpoint 写失败降级继续；Session checkpoint 写失败终止 run。

## 9. 执行引擎

- 循环编排、prompt 构建、thought parser、tool executor 分离。
- 原生 tool calling 为主；JSON parser 仅作不支持的 provider 的 fallback。
- 注入 ContextManager；不在引擎内重复实现压缩。
- 统一 AbortSignal；删除 step 超时、Promise.race、隐藏 auto-resume。
- 删除 WorkerAgent、IReasoningLoop、DefaultReasoningLoop、AgentLike。

## 10. Agent 契约

- core 只定义 `AgentInvoker.invoke(input, scope): Promise<TaskResult>`。
- 具体角色（Code/Test/Doc/Review）在 runtime 注册。
