# Step 2 — ExecutionEngine + Checkpoint + Memory

> 依赖：Step 1（EventBus + StateManager）
> 目标：构建 Agent Runtime 的三项核心能力——执行循环、中断恢复、记忆管理

## 改动范围

```
packages/core/src/harness/
├── execution/
│   ├── engine.ts         🆕 ExecutionEngine（ReAct 循环）
│   └── checkpoint.ts     🆕 CheckpointManager
├── memory/
│   ├── types.ts          🆕 Memory 接口（ShortTerm / LongTerm / Working）
│   ├── short-term.ts     🆕 ShortTermMemory 内存实现
│   ├── working.ts        🆕 WorkingMemory 共享白板实现
│   └── long-term.ts      🆕 LongTermMemory（基础版，先不用 embedding）
├── context/
│   ├── types.ts          ✏️ 增加 ContextWindow 接口
│   └── manager.ts        ✏️ 增加 build / append / compress 方法
└── agent/
    └── worker.ts         ✏️ WorkerAgent.run() 改为委托 ExecutionEngine（兼容层保留）

packages/core/src/index.ts  ✏️ 导出新模块
```

**新增 6 文件，修改 3 文件。**

---

## 2.1 ExecutionEngine

### 接口定义

```typescript
// packages/core/src/harness/execution/engine.ts

interface ExecutionContext {
  agentId: string;
  taskId: string;
  agent: AgentLike;            // Step 3 正式引入，这里先用最小接口
  model: BaseChatModel;
  tools: StructuredTool[];
  systemPrompt: string;
  context: ContextWindow;
  capability: { maxIterations: number; timeoutMs: number };
}

interface ExecutionResult {
  taskId: string;
  status: 'success' | 'failed' | 'timeout' | 'replan_needed';
  result?: string;
  error?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
  reasoningTrail: Thought[];
}

class ExecutionEngine {
  constructor(
    private checkpoint: ICheckpointManager,
    private memory: IMemoryManager,
    private eventBus: IEventBus,
  ) {}

  /** 启动执行循环 */
  async run(ctx: ExecutionContext): Promise<ExecutionResult>;

  /** 从 checkpoint 恢复执行 */
  async resume(taskId: string, agentId: string, ...): Promise<ExecutionResult>;
}
```

### 核心循环逻辑

```typescript
async run(ctx: ExecutionContext): Promise<ExecutionResult> {
  let step = 0;
  let context = ctx.context;
  const toolHistory: ToolCallRecord[] = [];
  const reasoningTrail: Thought[] = [];

  while (step < ctx.capability.maxIterations) {
    // ── Save checkpoint before each step ──
    await this.checkpoint.save(ctx.taskId, {
      step, context, toolHistory, reasoningTrail, agentId: ctx.agentId,
    });

    // ── Observe ──
    const events = this.eventBus.drain?.(/* agent 订阅的 topics */);
    const observation = { context, events, lastToolResult: toolHistory.at(-1)?.result };

    // ── Think (LLM call) ──
    const thought = await this.think(ctx.model, ctx.systemPrompt, observation);
    reasoningTrail.push(thought);

    // ── Act ──
    switch (thought.decision) {
      case 'use_tool': {
        const result = await ctx.tools.execute(thought.toolCall!);
        toolHistory.push({ call: thought.toolCall!, result });
        context = await this.contextManager.append(context, result);
        break;
      }
      case 'publish_event': {
        await this.eventBus.publish(thought.event!.topic, thought.event!.payload, {
          senderId: ctx.agentId, taskId: ctx.taskId,
        });
        break;
      }
      case 'request_agent': {
        const reply = await this.eventBus.request(
          `agent.command.${thought.targetAgent}`, thought.payload);
        context = await this.contextManager.append(reply);
        break;
      }
      case 'done':
        return { taskId: ctx.taskId, status: 'success', result: thought.summary, toolCalls: /* ... */, reasoningTrail };
      case 'replan':
        return { taskId: ctx.taskId, status: 'replan_needed', result: thought.summary, reasoningTrail };
    }

    // ── Context compress check ──
    if (context.tokenCount > ctx.maxTokens * 0.8) {
      context = await this.contextManager.compress(context, ctx.maxTokens);
    }

    step++;
  }

  return { taskId: ctx.taskId, status: 'timeout', error: 'Max iterations reached' };
}
```

### `think()` 方法

```typescript
private async think(model: BaseChatModel, systemPrompt: string, obs: Observation): Promise<Thought> {
  const prompt = `${systemPrompt}

## Current State
${obs.context.summary ?? obs.context.messages.map(m => m.content).join('\n')}

## Recent Events
${obs.events.map(e => `[${e.topic}] ${JSON.stringify(e.payload)}`).join('\n')}

## Last Tool Result
${obs.lastToolResult ?? 'None'}

Respond with a JSON object:
{ "reasoning": "...", "decision": "use_tool|publish_event|request_agent|done|replan", "toolCall": {...}, "summary": "..." }`;

  const response = await model.invoke([new HumanMessage(prompt)]);
  return parseThought(response);
}
```

---

## 2.2 CheckpointManager

### 接口定义

```typescript
// packages/core/src/harness/execution/checkpoint.ts

interface CheckpointSnapshot {
  taskId: string;
  agentId: string;
  step: number;
  createdAt: Date;
  context: ContextWindow;
  toolHistory: ToolCallRecord[];
  reasoningTrail: Thought[];
}

interface ICheckpointManager {
  save(taskId: string, snapshot: Omit<CheckpointSnapshot, 'createdAt'>): Promise<void>;
  load(taskId: string): Promise<CheckpointSnapshot | null>;
  list(taskId: string): Promise<Array<{ step: number; createdAt: Date }>>;
  purge(taskId: string): Promise<void>;
  cleanup(olderThan: Date): Promise<void>;
}
```

### 文件存储实现

```typescript
class FileCheckpointManager implements ICheckpointManager {
  constructor(private basePath: string = './data/checkpoints') {}

  async save(taskId, snapshot) {
    // 写入 {basePath}/{taskId}.json
    // 每次覆盖（只保留最新 checkpoint，节省磁盘）
  }

  async load(taskId) {
    // 读取 {basePath}/{taskId}.json
    // 文件不存在返回 null
  }

  async purge(taskId) {
    // 删除 {basePath}/{taskId}.json
  }
}
```

### 单元测试清单

- [ ] `save` → `load` 完整往返
- [ ] `load` 不存在 → 返回 null
- [ ] `save` 两次 → 第二次覆盖（最新 step 更大）
- [ ] `purge` → `load` 返回 null
- [ ] 大 context（100+ messages）不丢数据

---

## 2.3 Memory

### 接口定义

```typescript
// packages/core/src/harness/memory/types.ts

interface ShortTermMemory {
  add(entry: { role: string; content: string }): void;
  recent(n: number): Array<{ role: string; content: string }>;
  all(): Array<{ role: string; content: string }>;
  clear(): void;
}

interface LongTermMemory {
  store(entry: { sessionId: string; content: string; metadata?: Record<string, unknown> }): Promise<void>;
  search(query: string, topK?: number): Promise<Array<{ content: string; metadata: Record<string, unknown> }>>;
  deleteBySession(sessionId: string): Promise<void>;
}

interface WorkingMemory {
  write(key: string, value: unknown): void;
  read<T = unknown>(key: string): T | null;
  snapshot(): Record<string, unknown>;
  clear(): void;
}
```

### 实现要点

| 组件 | 实现 | 存储 |
|------|------|------|
| ShortTermMemory | 内存循环数组（最多 200 条） | 无持久化 |
| LongTermMemory | 关键词匹配搜索（首版），预留 embedding 接口 | SQLite |
| WorkingMemory | 内存 `Map<string, unknown>` | 无持久化，task 结束即清理 |

### 单元测试清单

- [ ] ShortTerm: `recent(5)` 返回最近 5 条
- [ ] ShortTerm: 超过 200 条自动淘汰最早的
- [ ] LongTerm: `store` → `search` 返回匹配条目
- [ ] LongTerm: `search` 无匹配返回空数组
- [ ] Working: `write` → `read` 往返
- [ ] Working: `snapshot` 返回完整副本
- [ ] Working: `clear` 清空所有

---

## 2.4 WorkerAgent 兼容适配

`WorkerAgent.run()` 内部改为使用 `ExecutionEngine`：

```typescript
// packages/core/src/agent/worker.ts（修改后）

export class WorkerAgent {
  private engine: ExecutionEngine;

  constructor(model, toolRegistry, hooks?, permissionRegistry?, eventBus?, stateManager?) {
    // 可选参数逐步引入，不传的用默认实现
    this.engine = new ExecutionEngine(
      checkpoint ?? new NoopCheckpointManager(),
      memory ?? new NoopMemoryManager(),
      eventBus ?? new StandaloneEventBus(),  // 不与其他 Agent 通信的单机模式
    );
  }

  async run(input: WorkerInput): Promise<WorkerOutput> {
    // 委托给 ExecutionEngine
    const result = await this.engine.run({
      agentId: `worker-${input.taskId}`,
      taskId: input.taskId,
      agent: this,
      model: this.model,
      tools: this.getRestrictedTools(input),
      systemPrompt: buildSystemPrompt(input, toolDescriptions),
      context: { messages: [new HumanMessage(input.description)], tokenCount: 0 },
      capability: { maxIterations: input.maxIterations ?? 15, timeoutMs: input.timeoutMs ?? 60000 },
    });

    return {
      taskId: result.taskId,
      status: result.status === 'replan_needed' ? 'failed' : result.status,
      result: result.result,
      error: result.error,
      toolCalls: result.toolCalls,
    };
  }
}
```

**关键原则**：WorkerAgent 的公开 API 不变，外部调用者（Dispatcher）无需改动。

---

## 验证标准

| 检查项 | 预期结果 |
|--------|---------|
| `pnpm --filter @code-agent/core test` | ExecutionEngine + Checkpoint + Memory 单测全过 |
| `pnpm --filter @code-agent/server test` | 现有 Orchestrator + Dispatcher 测试不变（WorkerAgent API 不变） |
| 手动：checkpoint 恢复 | 模拟 WorkerExecute 中 kill 进程 → 新进程 resume → 从同一 step 继续 |
| 手动：context 压缩 | 构造超长对话 → 触发 compress → token 降至阈值以下 |
