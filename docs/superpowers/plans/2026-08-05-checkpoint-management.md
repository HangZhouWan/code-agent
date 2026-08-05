# Checkpoint Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement orchestrator-level checkpoint persistence with AbortController propagation from REPL to agent engine, enabling recovery from any interruption point.

**Architecture:** Two-level checkpoint system — agent-level (existing, per-step) and orchestrator-level (NEW, plan+progress). Signal propagates REPL→graph→dispatcher→agent→engine. Save after planner+dispatcher batches, purge on finalizer success only. Recovery on startup lists pending sessions and re-enters graph at dispatcher.

**Tech Stack:** TypeScript, LangGraph StateGraph, Node.js fs

## Global Constraints

- All checkpoint files stored under `~/.code-agent/projects/<slug>/checkpoints/` (same base dir as agent checkpoints)
- Orchestrator checkpoint filename: `session-<uuid>.json`
- Node-level auto-save: save after planner, update after dispatcher batches, purge only on full success
- Recovery: re-execute ALL subtasks (方案 A), skip planner (方案 B)
- Abort signal: `AbortSignal` from standard `AbortController`, checked via `signal.aborted` at each engine iteration

---

### Task 1: Add OrchestratorCheckpoint types and FileOrchestratorCheckpointManager

**Files:**
- Modify: `packages/core/src/harness/execution/checkpoint.ts` — append new types and class
- Modify: `packages/core/src/index.ts` — add exports

**Interfaces:**
- Produces: `OrchestratorCheckpoint`, `SerializedMessage`, `IOrchestratorCheckpointManager`, `FileOrchestratorCheckpointManager`

- [ ] **Step 1: Add SerializedMessage and OrchestratorCheckpoint types**

Append to the end of `packages/core/src/harness/execution/checkpoint.ts` (before the last line):

```typescript
// ─────────────────────────────────────────────
// Orchestrator Checkpoint 类型
// ─────────────────────────────────────────────

/**
 * 序列化后的消息（去除 LangChain 运行时方法，只保留数据）
 */
export interface SerializedMessage {
  role: 'human' | 'ai' | 'system' | 'tool';
  content: string;
}

/**
 * Orchestrator 级别的 checkpoint
 *
 * 记录整个工作流的计划状态，用于恢复被中断的编排流程。
 * 与 Agent 级别的 CheckpointSnapshot 互补：Agent checkpoint 记录单任务执行状态，
 * Orchestrator checkpoint 记录编排层面的计划进度。
 */
export interface OrchestratorCheckpoint {
  /** 唯一会话标识 */
  sessionId: string;
  /** 创建时间 */
  createdAt: Date;
  /** 用户消息历史（序列化后） */
  messages: SerializedMessage[];
  /** Planner 输出 */
  plan: {
    complexity: 'simple' | 'complex';
    tasks: Array<{
      id: string;
      description: string;
      tools: string[];
      dependsOn?: string[];
      routing: 'direct' | 'bus';
      role: string;
    }>;
    suggestedAgents: Record<string, string>;
  };
  /** 进度标签（调试用；不影响恢复逻辑） */
  progress: {
    currentNode: 'planner' | 'dispatcher' | 'finalizer';
    completedTaskIds: string[];
  };
}

// ─────────────────────────────────────────────
// OrchestratorCheckpointManager 接口
// ─────────────────────────────────────────────

/**
 * Orchestrator 级别的 Checkpoint 管理器接口
 *
 * 负责编排层面工作流快照的创建、读取、清理。
 * 文件名格式：session-{sessionId}.json
 */
export interface IOrchestratorCheckpointManager {
  /**
   * 保存 orchestrator checkpoint（覆盖写入）
   */
  save(sessionId: string, checkpoint: Omit<OrchestratorCheckpoint, 'createdAt'>): Promise<void>;

  /**
   * 加载 orchestrator checkpoint
   */
  load(sessionId: string): Promise<OrchestratorCheckpoint | null>;

  /**
   * 删除 orchestrator checkpoint
   */
  purge(sessionId: string): Promise<void>;

  /**
   * 列出所有 pending 的 session ID
   */
  listSessions(): Promise<string[]>;

  /**
   * 清理过期的 orchestrator checkpoint
   */
  cleanup(olderThan: Date): Promise<void>;
}

// ─────────────────────────────────────────────
// FileOrchestratorCheckpointManager
// ─────────────────────────────────────────────

/**
 * 基于文件系统的 OrchestratorCheckpointManager 实现
 *
 * 每个 session 的 checkpoint 存储为独立 JSON 文件。
 * 路径格式：{basePath}/session-{sessionId}.json
 *
 * 与 FileCheckpointManager 共享同一 basePath 目录，
 * 通过文件名前缀 "session-" 区分。
 */
export class FileOrchestratorCheckpointManager implements IOrchestratorCheckpointManager {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.ensureDir();
  }

  /** 获取 session 对应的文件路径 */
  private filePath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.basePath, `session-${safeId}.json`);
  }

  /** 确保存储目录存在 */
  private ensureDir(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /** 保存 orchestrator checkpoint（覆盖写入） */
  async save(
    sessionId: string,
    checkpoint: Omit<OrchestratorCheckpoint, 'createdAt'>,
  ): Promise<void> {
    this.ensureDir();

    const full: OrchestratorCheckpoint = {
      ...checkpoint,
      createdAt: new Date(),
    };

    const serialized = {
      sessionId: full.sessionId,
      createdAt: full.createdAt.toISOString(),
      messages: full.messages,
      plan: full.plan,
      progress: full.progress,
    };

    fs.writeFileSync(this.filePath(sessionId), JSON.stringify(serialized, null, 2), 'utf-8');
  }

  /** 加载 orchestrator checkpoint */
  async load(sessionId: string): Promise<OrchestratorCheckpoint | null> {
    const fp = this.filePath(sessionId);

    if (!fs.existsSync(fp)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      const data = JSON.parse(raw);
      return {
        sessionId: data.sessionId as string,
        createdAt: new Date(data.createdAt as string),
        messages: data.messages as SerializedMessage[],
        plan: data.plan as OrchestratorCheckpoint['plan'],
        progress: data.progress as OrchestratorCheckpoint['progress'],
      };
    } catch {
      return null;
    }
  }

  /** 删除 orchestrator checkpoint */
  async purge(sessionId: string): Promise<void> {
    const fp = this.filePath(sessionId);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
    }
  }

  /** 列出所有 pending 的 session ID */
  async listSessions(): Promise<string[]> {
    if (!fs.existsSync(this.basePath)) return [];

    const sessionIds: string[] = [];
    const files = fs.readdirSync(this.basePath);
    for (const file of files) {
      if (!file.startsWith('session-') || !file.endsWith('.json')) continue;

      const fp = path.join(this.basePath, file);
      try {
        const raw = fs.readFileSync(fp, 'utf-8');
        const data = JSON.parse(raw);
        if (data.sessionId && typeof data.sessionId === 'string') {
          sessionIds.push(data.sessionId);
        }
      } catch {
        // 文件损坏，跳过
      }
    }
    return sessionIds;
  }

  /** 清理过期的 orchestrator checkpoint */
  async cleanup(olderThan: Date): Promise<void> {
    if (!fs.existsSync(this.basePath)) return;

    const files = fs.readdirSync(this.basePath);
    for (const file of files) {
      if (!file.startsWith('session-') || !file.endsWith('.json')) continue;

      const fp = path.join(this.basePath, file);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtime < olderThan) {
          fs.unlinkSync(fp);
        }
      } catch {
        // 文件可能已被删除
      }
    }
  }
}
```

- [ ] **Step 2: Add exports to core/src/index.ts**

Add these lines after the existing checkpoint exports block (after line 103 which exports `FileCheckpointManager`):

```typescript
// Orchestrator Checkpoint (Step 5)
export type {
  OrchestratorCheckpoint,
  SerializedMessage,
  IOrchestratorCheckpointManager,
} from './harness/execution/checkpoint.js';
export { FileOrchestratorCheckpointManager } from './harness/execution/checkpoint.js';
```

- [ ] **Step 3: Build and verify compilation**

```bash
cd packages/core && pnpm build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/harness/execution/checkpoint.ts packages/core/src/index.ts
git commit -m "feat: add OrchestratorCheckpoint types and FileOrchestratorCheckpointManager"
```

---

### Task 2: Add signal to AgentInput and wire through executeTask

**Files:**
- Modify: `packages/core/src/agent/types.ts` — add `signal` field
- Modify: `packages/core/src/agent/agent.ts` — pass signal to engine, skip purge on abort

**Interfaces:**
- Consumes: `ExecutionContext` from engine.ts (will gain `signal` in Task 3)
- Produces: `AgentInput` now has `signal?: AbortSignal`

- [ ] **Step 1: Add signal to AgentInput**

In `packages/core/src/agent/types.ts`, add the `signal` field to `AgentInput` interface after the `onConfirmRequired` field:

```typescript
export interface AgentInput {
  /** 任务唯一标识 */
  taskId: string;
  /** 任务的自然语言描述 */
  description: string;
  /** 上下文信息（依赖任务的结果或父 Agent 的背景） */
  context?: string;
  /** 最大迭代次数（覆盖 Agent 默认值） */
  maxIterations?: number;
  /** 超时时间（毫秒，覆盖 Agent 默认值） */
  timeoutMs?: number;
  /**
   * 确认回调（可选）
   *
   * 当工具需要用户确认时调用。
   */
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  /**
   * AbortSignal（可选）
   *
   * 用于传播取消信号到 ExecutionEngine.runLoop()。
   * 当用户按 Ctrl+C 时，此 signal 被 abort，引擎检测后停止执行。
   */
  signal?: AbortSignal;
}
```

- [ ] **Step 2: Modify executeTask() in agent.ts to pass signal to engine and skip purge on abort**

In `packages/core/src/agent/agent.ts`, modify `executeTask()`:

Change the engine.run() call to pass signal (lines 384-393):

```typescript
      // ── 首次执行 ──
      const overallStartTime = Date.now();
      let result = await this.engine.run({
        agentId: this.id,
        taskId,
        agent: this,
        model: this.model,
        tools,
        systemPrompt: this.role.systemPrompt,
        context,
        capability: { maxIterations, timeoutMs },
        signal: input.signal,
      });
```

Change the purge logic (lines 414-424) to skip purge on abort:

```typescript
      // 任务成功完成后清理 checkpoint
      // 注意：如果 signal 已被 abort（用户取消），保留 checkpoint 用于恢复。
      // 失败/超时时也不删除 checkpoint，保留用于潜在的恢复重试。
      const wasAborted = input.signal?.aborted ?? false;
      if (result.status === 'success' && !wasAborted) {
        await this.engine.purgeCheckpoint(taskId).catch((err) => {
          console.error(
            `[checkpoint] Failed to purge checkpoint for task "${taskId}":`,
            err instanceof Error ? err.message : String(err),
          );
        });
      }
```

- [ ] **Step 3: Build and verify compilation**

```bash
cd packages/core && pnpm build
```

Expected: Build succeeds. Note: the `signal` field on `ExecutionContext` will have a type error until Task 3 is done, but the `AgentInput` change itself should be fine since it's just adding an optional field.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/agent/types.ts packages/core/src/agent/agent.ts
git commit -m "feat: wire signal through AgentInput to engine, skip purge on abort"
```

---

### Task 3: Add signal to ExecutionEngine.runLoop()

**Files:**
- Modify: `packages/core/src/harness/execution/engine.ts` — add `signal` to `ExecutionContext`, check each iteration

**Interfaces:**
- Consumes: `AbortSignal` from standard DOM types
- Produces: `ExecutionContext` now has `signal?: AbortSignal`
- Modifies: `runLoop()` early-returns when signal is aborted

- [ ] **Step 1: Add signal to ExecutionContext**

In `packages/core/src/harness/execution/engine.ts`, add `signal` to the `ExecutionContext` interface after the `capability` field:

```typescript
export interface ExecutionContext {
  /** Agent 唯一标识 */
  agentId: string;
  /** 任务 ID */
  taskId: string;
  /** Agent 实例（最小接口） */
  agent: AgentLike;
  /** LLM 模型 */
  model: BaseChatModel;
  /** 可用工具列表 */
  tools: StructuredTool[];
  /** System Prompt */
  systemPrompt: string;
  /** 运行时上下文（消息历史 + token 信息） */
  context: RuntimeContext;
  /** 执行能力限制 */
  capability: {
    /** 最大迭代次数，默认 15 */
    maxIterations: number;
    /** 超时时间（毫秒），默认 60000 */
    timeoutMs: number;
  };
  /** AbortSignal —— 用于传播取消信号 */
  signal?: AbortSignal;
}
```

- [ ] **Step 2: Add abort check at start of each iteration in runLoop()**

In the `runLoop()` method, add an abort check right after the timeout check (after the timeout block ending around line 462, before the "Save checkpoint before each step" comment):

```typescript
      // ── Abort check ──
      if (ctx.signal?.aborted) {
        // 不要 purge checkpoint —— 用户取消了，保留状态用于恢复
        return {
          taskId: ctx.taskId,
          status: 'failed',
          error: 'Task cancelled by user',
          reasoningTrail,
        };
      }
```

Place this right after the timeout check block (after line 462) and before the checkpoint save (line 464).

- [ ] **Step 3: Build and verify compilation**

```bash
cd packages/core && pnpm build
```

Expected: Build succeeds with no type errors. The `signal` field in `ExecutionContext` is now defined, so Task 2's usage should compile correctly too.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/harness/execution/engine.ts
git commit -m "feat: add AbortSignal to ExecutionContext, check each runLoop iteration"
```

---

### Task 4: Add orchestrator recovery state and graph options

**Files:**
- Modify: `packages/server/src/orchestrator/state.ts` — add `sessionId`, `resumeFromCheckpoint`
- Modify: `packages/server/src/orchestrator/graph.ts` — add `signal`/`checkpointManager` to options, conditional START edge

**Interfaces:**
- Consumes: `IOrchestratorCheckpointManager` from Task 1
- Produces: `OrchestratorGraphOptions` now has `signal`, `checkpointManager`, `sessionId`

- [ ] **Step 1: Add sessionId and resumeFromCheckpoint to OrchestratorState**

In `packages/server/src/orchestrator/state.ts`, add two new annotations to `OrchestratorState`:

```typescript
export const OrchestratorState = Annotation.Root({
  /** 用户消息历史，追加模式（新消息追加到末尾） */
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),

  /** Planner 生成的 Plan（含 complexity + tasks + suggestedAgents），替换模式 */
  plan: Annotation<Plan>,

  /** 已完成的子任务结果（taskId → WorkerOutput），合并模式 */
  completedTasks: Annotation<Record<string, WorkerOutput>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),

  /** 待执行的子任务列表，替换模式 */
  pendingTasks: Annotation<SubTask[]>,

  /** Finalizer 生成的最终回复，替换模式 */
  finalResponse: Annotation<string>,

  /** Dispatcher 的路由决策："continue" 循环 / "replan" 修正 / "finalize" 结束 */
  nextAction: Annotation<NextAction>,

  /**
   * Replan 信号（Step 4 新增）
   */
  replanSignal: Annotation<ReplanSignal | null>,

  /**
   * 产物集合（Step 4 新增）
   */
  artifacts: Annotation<Artifacts>({
    reducer: (left, right) => ({
      files: [...(left?.files ?? []), ...(right?.files ?? [])],
      commits: [...(left?.commits ?? []), ...(right?.commits ?? [])],
      tests: [...(left?.tests ?? []), ...(right?.tests ?? [])],
    }),
    default: () => ({ files: [], commits: [], tests: [] }),
  }),

  /**
   * 会话 ID（Step 5 新增）
   *
   * 用于 orchestrator checkpoint 的文件命名和恢复标识。
   */
  sessionId: Annotation<string>,

  /**
   * 是否从 checkpoint 恢复（Step 5 新增）
   *
   * 当为 true 时，跳过 planner 直接从 dispatcher 开始。
   */
  resumeFromCheckpoint: Annotation<boolean>,
});
```

- [ ] **Step 2: Add signal, checkpointManager, sessionId to OrchestratorGraphOptions and wire to nodes**

In `packages/server/src/orchestrator/graph.ts`, update the import and options interface:

Add import at top:
```typescript
import type { IOrchestratorCheckpointManager } from '@code-agent/core';
```

Update `OrchestratorGraphOptions`:
```typescript
export interface OrchestratorGraphOptions {
  /** LLM 实例 */
  model: BaseChatModel;
  /** 工具注册表 */
  toolRegistry: ToolRegistry;
  /** 工作区根路径 */
  workspacePath: string;
  /** 权限注册表（可选） */
  permissionRegistry?: PermissionRegistry;
  /** 确认回调（可选） */
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  /** EventBus 实例（bus 通道使用） */
  eventBus?: IEventBus;
  /** Agent 注册表（direct 通道使用） */
  agentRegistry?: AgentRegistry;
  /** AbortSignal —— 传播取消信号到 Agent */
  signal?: AbortSignal;
  /** Orchestrator Checkpoint 管理器 */
  checkpointManager?: IOrchestratorCheckpointManager;
  /** 会话 ID（用于 checkpoint 文件命名） */
  sessionId?: string;
}
```

Update the `createOrchestratorGraph` function to destructure new options and pass them to node factories:

```typescript
export function createOrchestratorGraph(options: OrchestratorGraphOptions) {
  const {
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    eventBus,
    agentRegistry,
    signal,
    checkpointManager,
    sessionId,
  } = options;

  const plannerNode = createPlannerNode(model, toolRegistry, agentRegistry, checkpointManager, sessionId);
  const dispatcherNode = createDispatcherNode(
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    eventBus,
    agentRegistry,
    signal,
    checkpointManager,
    sessionId,
  );
  const replannerNode = createReplannerNode(model);
  const finalizerNode = createFinalizerNode(model, checkpointManager, sessionId);

  const graph = new StateGraph(OrchestratorState)
    .addNode('planner', plannerNode)
    .addNode('dispatcher', dispatcherNode)
    .addNode('replanner', replannerNode)
    .addNode('finalizer', finalizerNode)

    // Conditional start: skip planner when resuming from checkpoint
    .addConditionalEdges(
      START,
      (state: typeof OrchestratorState.State) =>
        state.resumeFromCheckpoint ? 'dispatcher' : 'planner',
      {
        planner: 'planner',
        dispatcher: 'dispatcher',
      },
    )

    .addEdge('planner', 'dispatcher')

    .addConditionalEdges(
      'dispatcher',
      (state: typeof OrchestratorState.State) => state.nextAction,
      {
        continue: 'dispatcher',
        replan: 'replanner',
        finalize: 'finalizer',
      },
    )

    .addEdge('replanner', 'dispatcher')

    .addEdge('finalizer', END);

  return graph.compile();
}
```

- [ ] **Step 3: Build and verify compilation**

```bash
cd packages/server && pnpm build
```

Expected: Build will fail because planner, dispatcher, finalizer node factories don't yet accept the new parameters. This is expected — Tasks 5, 6, 7 will fix this.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/orchestrator/state.ts packages/server/src/orchestrator/graph.ts
git commit -m "feat: add recovery state fields and graph options for orchestrator checkpoint"
```

---

### Task 5: Save orchestrator checkpoint in planner node

**Files:**
- Modify: `packages/server/src/orchestrator/nodes/planner.ts` — accept checkpointManager, save after plan generation

**Interfaces:**
- Consumes: `IOrchestratorCheckpointManager` from Task 1
- Produces: `createPlannerNode` signature changed

- [ ] **Step 1: Update createPlannerNode signature and add checkpoint save**

In `packages/server/src/orchestrator/nodes/planner.ts`, add imports:

```typescript
import type { IOrchestratorCheckpointManager } from '@code-agent/core';
import type { BaseMessage } from '@langchain/core/messages';
```

Update the function signature:

```typescript
export function createPlannerNode(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  agentRegistry?: AgentRegistry,
  checkpointManager?: IOrchestratorCheckpointManager,
  sessionId?: string,
) {
```

In the returned `plannerNode` function, after the plan is built and before returning, add the checkpoint save. Insert after the `plan = { complexity, tasks, suggestedAgents };` assignment (around line 354) and before the `return { plan, pendingTasks: plan.tasks };` (line 361):

```typescript
    // ── Save orchestrator checkpoint after plan generation ──
    if (checkpointManager && sessionId) {
      const serializedMessages = state.messages.map((m) => ({
        role: (m.getType?.() ?? 'unknown') as SerializedMessage['role'],
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));

      checkpointManager.save(sessionId, {
        sessionId,
        messages: serializedMessages,
        plan,
        progress: {
          currentNode: 'planner',
          completedTaskIds: [],
        },
      }).catch((err) => {
        console.error(
          `[orchestrator-checkpoint] Failed to save after planner:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }

    return { plan, pendingTasks: plan.tasks };
```

Add the `SerializedMessage` type import:
```typescript
import type { IOrchestratorCheckpointManager, SerializedMessage } from '@code-agent/core';
```

- [ ] **Step 2: Build and verify compilation**

```bash
cd packages/server && pnpm build
```

Expected: Still errors from dispatcher/finalizer (fixed in Tasks 6-7), but planner should compile.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/orchestrator/nodes/planner.ts
git commit -m "feat: save orchestrator checkpoint after planner generates plan"
```

---

### Task 6: Pass signal to agent and update checkpoint in dispatcher

**Files:**
- Modify: `packages/server/src/orchestrator/nodes/dispatcher.ts` — accept signal/checkpointManager/sessionId, pass signal to agent, update checkpoint

**Interfaces:**
- Consumes: `IOrchestratorCheckpointManager` from Task 1, `AbortSignal`
- Consumes: `AgentInput.signal` from Task 2

- [ ] **Step 1: Update createDispatcherNode signature**

In `packages/server/src/orchestrator/nodes/dispatcher.ts`, add import:

```typescript
import type { IOrchestratorCheckpointManager } from '@code-agent/core';
```

Update the function signature to accept new parameters:

```typescript
export function createDispatcherNode(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permissionRegistry?: PermissionRegistry,
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>,
  eventBus?: IEventBus,
  agentRegistry?: AgentRegistry,
  signal?: AbortSignal,
  checkpointManager?: IOrchestratorCheckpointManager,
  sessionId?: string,
) {
```

- [ ] **Step 2: Pass signal and checkpointManager to inner functions**

Update the returned `dispatcherNode` function to capture signal, checkpointManager, sessionId. Update the call to `executeDirectTasks`:

```typescript
    // ── 通道 1：direct ─────────────────────
    if (allDirectTasks.length > 0) {
      const directResults = await executeDirectTasks(
        allDirectTasks,
        completedTasks,
        model,
        toolRegistry,
        workspacePath,
        permissionRegistry,
        onConfirmRequired,
        agentRegistry,
        signal,
      );
      results.push(...directResults);
    }
```

- [ ] **Step 3: Update executeDirectTasks to accept and pass signal**

Update `executeDirectTasks` signature:

```typescript
async function executeDirectTasks(
  tasks: SubTask[],
  completed: Record<string, WorkerOutput>,
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permissionRegistry?: PermissionRegistry,
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>,
  agentRegistry?: AgentRegistry,
  signal?: AbortSignal,
): Promise<WorkerOutput[]> {
```

In the agent.executeTask() call within executeDirectTasks, add signal:

```typescript
            const output: AgentOutput = await agent.executeTask({
              taskId: task.id,
              description: task.description,
              context,
              onConfirmRequired,
              signal,
            });
```

- [ ] **Step 4: Add orchestator checkpoint update after dispatcher batch**

In the `dispatcherNode` function, after the results are merged and nextAction is determined (after line 245), add the checkpoint update:

```typescript
    // ── Update orchestrator checkpoint progress ──
    if (checkpointManager && sessionId) {
      const allCompletedIds = Object.keys(newCompleted);
      checkpointManager.save(sessionId, {
        sessionId,
        messages: [], // messages are preserved from planner save; progress-only update
        plan: {
          complexity: 'simple',
          tasks: [],
          suggestedAgents: {},
        },
        progress: {
          currentNode: 'dispatcher',
          completedTaskIds: allCompletedIds,
        },
      }).catch((err) => {
        console.error(
          `[orchestrator-checkpoint] Failed to update progress:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }
```

Wait — the above approach overwrites messages/plan with empty values. Let's provide a better approach. Instead, update the `IOrchestratorCheckpointManager` interface to support partial updates, or load-merge-save. Let's go with a simpler approach: add an `updateProgress` method.

Actually, let's keep it simple. The dispatcher loads the existing checkpoint, updates progress, and saves:

```typescript
    // ── Update orchestrator checkpoint progress ──
    if (checkpointManager && sessionId) {
      const existing = await checkpointManager.load(sessionId);
      if (existing) {
        const allCompletedIds = Object.keys(newCompleted);
        await checkpointManager.save(sessionId, {
          sessionId,
          messages: existing.messages,
          plan: existing.plan,
          progress: {
            currentNode: 'dispatcher',
            completedTaskIds: allCompletedIds,
          },
        }).catch((err) => {
          console.error(
            `[orchestrator-checkpoint] Failed to update progress:`,
            err instanceof Error ? err.message : String(err),
          );
        });
      }
    }
```

- [ ] **Step 5: Build and verify compilation**

```bash
cd packages/server && pnpm build
```

Expected: Still errors from finalizer (fixed in Task 7), but dispatcher should compile.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/orchestrator/nodes/dispatcher.ts
git commit -m "feat: pass signal to agent, update orchestrator checkpoint in dispatcher"
```

---

### Task 7: Purge orchestrator checkpoint in finalizer node

**Files:**
- Modify: `packages/server/src/orchestrator/nodes/finalizer.ts` — accept checkpointManager/sessionId, purge on success

**Interfaces:**
- Consumes: `IOrchestratorCheckpointManager` from Task 1

- [ ] **Step 1: Update createFinalizerNode signature**

In `packages/server/src/orchestrator/nodes/finalizer.ts`, add import:

```typescript
import type { IOrchestratorCheckpointManager } from '@code-agent/core';
```

Update function signature:

```typescript
export function createFinalizerNode(
  model: BaseChatModel,
  checkpointManager?: IOrchestratorCheckpointManager,
  sessionId?: string,
) {
```

- [ ] **Step 2: Add purge after final response generation**

In the returned `finalizerNode` function, after the `finalResponse` is generated and before the `return { finalResponse }`, add checkpoint purge:

```typescript
    const finalResponse =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // ── Purge orchestrator checkpoint on success ──
    if (checkpointManager && sessionId) {
      checkpointManager.purge(sessionId).catch((err) => {
        console.error(
          `[orchestrator-checkpoint] Failed to purge checkpoint for session "${sessionId}":`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }

    return { finalResponse };
```

- [ ] **Step 3: Build and verify compilation**

```bash
cd packages/server && pnpm build
```

Expected: Build succeeds with no type errors. All server nodes now accept the new parameters.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/orchestrator/nodes/finalizer.ts
git commit -m "feat: purge orchestrator checkpoint on finalizer success"
```

---

### Task 8: Pass AbortController.signal into graph options in REPL

**Files:**
- Modify: `packages/cli/src/repl.ts` — pass signal to createOrchestratorGraph options

**Interfaces:**
- Consumes: `OrchestratorGraphOptions.signal` from Task 4

- [ ] **Step 1: Generate sessionId and pass signal to graph options**

In `packages/cli/src/repl.ts`, update the `streamOrchestrator` function. Add import:

```typescript
import { randomUUID } from "node:crypto";
```

Update the graph creation to pass signal and sessionId:

```typescript
async function streamOrchestrator(
  messages: BaseMessage[],
  options: ReplOptions,
  rl: readline.Interface,
  signal?: AbortSignal,
): Promise<string> {
  const { model, toolRegistry, workspacePath, permissionRegistry, agentRegistry } = options;

  const onConfirmRequired = createApprovalHandler(rl);

  // Generate a session ID for orchestrator checkpoint
  const sessionId = randomUUID();

  const graph = createOrchestratorGraph({
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    agentRegistry,
    signal,
    sessionId,
  });
```

Note: The REPL currently doesn't have a `checkpointManager` available. We need to either:
a) Add it to `ReplOptions`, or
b) Create one in `streamOrchestrator` from the workspace path.

Option (b) is simpler and self-contained. Let's create the checkpointManager inline:

```typescript
import { FileOrchestratorCheckpointManager } from "@code-agent/core";
import { getCheckpointDir } from "./paths.js";
```

Then in streamOrchestrator:
```typescript
  const checkpointDir = getCheckpointDir(workspacePath);
  const checkpointManager = new FileOrchestratorCheckpointManager(checkpointDir);

  const graph = createOrchestratorGraph({
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    agentRegistry,
    signal,
    checkpointManager,
    sessionId,
  });
```

- [ ] **Step 2: Add the imports at the top of repl.ts**

```typescript
import { FileOrchestratorCheckpointManager } from "@code-agent/core";
import { getCheckpointDir } from "./paths.js";
import { randomUUID } from "node:crypto";
```

- [ ] **Step 3: Build and verify compilation**

```bash
cd packages/cli && pnpm build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/repl.ts
git commit -m "feat: pass AbortController.signal into orchestrator graph options"
```

---

### Task 9: Detect and recover pending orchestrator sessions on startup

**Files:**
- Modify: `packages/cli/src/index.ts` — add orchestrator checkpoint recovery on startup

**Interfaces:**
- Consumes: `FileOrchestratorCheckpointManager`, `IOrchestratorCheckpointManager` from Task 1
- Consumes: `OrchestratorState.resumeFromCheckpoint` from Task 4

- [ ] **Step 1: Add import and recovery function**

In `packages/cli/src/index.ts`, add imports:

```typescript
import {
  // ... existing imports ...
  FileOrchestratorCheckpointManager,
} from "@code-agent/core";
import type { OrchestratorCheckpoint } from "@code-agent/core";
```

Add the recovery function after `resumePendingCheckpoints`:

```typescript
/**
 * Recover pending orchestrator sessions.
 *
 * Scans for session-*.json files and offers the user a choice
 * to resume the latest (or all) pending sessions by re-entering
 * the orchestrator graph directly at the dispatcher node.
 */
async function recoverOrchestratorSessions(
  checkpointManager: FileOrchestratorCheckpointManager,
  model: ReturnType<typeof createChatModel>,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permRegistry: PermissionRegistry,
  agentRegistry: AgentRegistry,
): Promise<void> {
  const pendingSessions = await checkpointManager.listSessions();
  if (pendingSessions.length === 0) return;

  console.log(`\n[recovery] Found ${pendingSessions.length} pending orchestrator session(s):`);

  // Load all pending checkpoints sorted by creation time (newest first)
  const checkpoints: OrchestratorCheckpoint[] = [];
  for (const sessionId of pendingSessions) {
    const cp = await checkpointManager.load(sessionId);
    if (cp) checkpoints.push(cp);
  }
  checkpoints.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  for (const cp of checkpoints) {
    console.log(`  - session ${cp.sessionId} (${cp.createdAt.toISOString()}): ${cp.plan.tasks.length} tasks, ${cp.progress.completedTaskIds.length} completed`);
  }

  // Auto-resume the latest checkpoint
  const latest = checkpoints[0];
  console.log(`\n[recovery] Auto-resuming latest session: ${latest.sessionId}\n`);

  try {
    // Rebuild messages from serialized form
    const { HumanMessage, AIMessage, SystemMessage } = await import('@langchain/core/messages');
    const messages = latest.messages.map((m) => {
      switch (m.role) {
        case 'human': return new HumanMessage(m.content);
        case 'ai': return new AIMessage(m.content);
        case 'system': return new SystemMessage(m.content);
        default: return new HumanMessage(m.content);
      }
    });

    const graph = createOrchestratorGraph({
      model,
      toolRegistry,
      workspacePath,
      permissionRegistry: permRegistry,
      agentRegistry,
      checkpointManager,
      sessionId: latest.sessionId,
    });

    const result = await graph.invoke({
      messages,
      plan: latest.plan,
      pendingTasks: latest.plan.tasks,
      completedTasks: {},
      nextAction: 'continue',
      sessionId: latest.sessionId,
      resumeFromCheckpoint: true,
    });

    const finalResponse = result.finalResponse as string | undefined;
    if (finalResponse) {
      console.log(`\n[recovery] Session ${latest.sessionId} completed:\n${finalResponse}\n`);
    } else {
      console.log(`[recovery] Session ${latest.sessionId} completed (no output).`);
    }
  } catch (err) {
    console.error(`[recovery] Session ${latest.sessionId} recovery failed:`, err);
  }
}
```

- [ ] **Step 2: Create orchestrator checkpointManager in bootstrap() and call recovery**

In `packages/cli/src/index.ts`, update the `bootstrap()` function to also create `FileOrchestratorCheckpointManager`:

```typescript
interface BootstrapResult {
  model: ReturnType<typeof createChatModel>;
  toolRegistry: ToolRegistry;
  permRegistry: PermissionRegistry;
  agentRegistry: AgentRegistry;
  memoryManager: IMemoryManager;
  executionEngine: ExecutionEngine;
  checkpointManager: FileCheckpointManager;
  orchCheckpointManager: FileOrchestratorCheckpointManager;
}
```

In the bootstrap function body, after creating `checkpointManager`:

```typescript
  // 5b. Checkpoint + ExecutionEngine
  const checkpointManager = new FileCheckpointManager(getCheckpointDir(workspacePath));
  const orchCheckpointManager = new FileOrchestratorCheckpointManager(getCheckpointDir(workspacePath));
  const executionEngine = new ExecutionEngine(checkpointManager, memoryManager, eventBus);
```

Add `orchCheckpointManager` to the return object:

```typescript
  return {
    model,
    toolRegistry,
    permRegistry,
    agentRegistry,
    memoryManager,
    executionEngine,
    checkpointManager,
    orchCheckpointManager,
  };
```

- [ ] **Step 3: Call recovery in main()**

In the `main()` function, add the orchestrator recovery call after `resumePendingCheckpoints`:

```typescript
  await resumePendingCheckpoints(
    infra.checkpointManager,
    infra.agentRegistry,
    infra.model,
    infra.toolRegistry,
    workspacePath,
    infra.permRegistry,
    infra.memoryManager,
  );

  // Recover orchestrator sessions
  await recoverOrchestratorSessions(
    infra.orchCheckpointManager,
    infra.model,
    infra.toolRegistry,
    workspacePath,
    infra.permRegistry,
    infra.agentRegistry,
  );
```

- [ ] **Step 4: Build and verify compilation**

```bash
cd packages/cli && pnpm build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat: detect and auto-resume pending orchestrator sessions on startup"
```

---

## Self-Review Checklist

1. **Spec coverage**: Each design requirement maps to a task — types+manager (Task 1), signal propagation chain (Tasks 2-3, 6, 8), save timing (Tasks 5-7), recovery (Task 4, 9), cleanup (Task 7 purge)
2. **Placeholder scan**: No TBD/TODO markers; all code is concrete
3. **Type consistency**: `OrchestratorCheckpoint` defined in Task 1 used in Tasks 5-7, 9; `IOrchestratorCheckpointManager` used in Tasks 4-7, 9; `AbortSignal` used in Tasks 2-3, 6, 8; `AgentInput.signal` defined in Task 2 consumed in Task 6
4. **`SerializedMessage` role type**: The `role` field in `SerializedMessage` uses `'human' | 'ai' | 'system' | 'tool'` — this matches LangChain message types. In `planner.ts` Task 5, `m.getType?.()` returns strings like `'human'`, `'ai'`, `'system'`, `'tool'` which map directly.
