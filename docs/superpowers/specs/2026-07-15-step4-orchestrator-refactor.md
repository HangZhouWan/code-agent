# Step 4 — Orchestrator 改造

> 依赖：Step 3（Agent 基类 + AgentRegistry）
> 目标：改造 Orchestrator 状态图——Planner 加复杂度判定、Dispatcher 双通道路由、新增 Replanner、Summarizer 拆为 Finalizer

## 改动范围

```
packages/server/src/orchestrator/
├── types.ts            ✏️ SubTask 加 routing + role 字段
├── state.ts            ✏️ OrchestratorState 加 replanSignal / artifacts
├── graph.ts            ✏️ 加 replanner 节点，summarizer→finalizer
└── nodes/
    ├── planner.ts      ✏️ 输出 Plan（含 complexity + suggestedAgents）
    ├── dispatcher.ts   ✏️ 双通道：direct Agent.run() / bus publish
    ├── replanner.ts    🆕 Replanner 节点
    ├── summarizer.ts   🗑️ 删除
    └── finalizer.ts    🆕 Finalizer 节点

packages/server/src/gateway/ws/
└── chat.ts             ✏️ 初始化 EventBus + StateManager + AgentRegistry
```

**新增 2 文件，修改 5 文件，删除 1 文件。**

---

## 4.1 Planner 改造

### 输入扩展

```typescript
// 原：只拿到 toolRegistry
// 新：拿到 agentRegistry，列出可用角色

interface PlannerInput {
  messages: BaseMessage[];
  availableAgents: Array<{ role: string; description: string; tools: string[] }>;
}
```

### 输出扩展

```typescript
// 原：SubTask[]
// 新：Plan（含 complexity + routing + suggestedAgents）

interface Plan {
  complexity: 'simple' | 'complex';
  tasks: SubTask[];
  suggestedAgents: Record<string, string>;
}

interface SubTask {
  id: string;
  description: string;
  tools: string[];        // 原字段
  dependsOn: string[];    // 原字段
  routing: 'direct' | 'bus';  // 🆕
  role: string;            // 🆕 负责的 Agent 角色，如 'code'
}
```

### System Prompt 变化点

```
## 新增 Instructions

4. 判断整体复杂度：
   - simple：单 Agent 就能独立完成 → routing: "direct"
   - complex：需要多 Agent 协作/交互/讨论 → routing: "bus"

5. 为每个子任务指定负责的 Agent 角色（role 字段），
   从 Available Agents 中选择。

6. 为每个子任务指定 routing：
   - direct：任务简单，由 Planner 直接调用 Agent
   - bus：任务复杂，发布到 EventBus 等待 Agent 协作完成
```

### 复杂度判定规则

| 条件 | complexity | routing |
|------|-----------|---------|
| 所有任务同一角色 | `simple` | `direct` |
| 只有一个任务 | `simple` | `direct` |
| 多角色参与 | `complex` | 各任务按需 `direct`/`bus` |
| 任务间需互相讨论 | `complex` | `bus` |

---

## 4.2 Dispatcher 改造

### 核心变化

```typescript
// 原：
// const worker = new WorkerAgent(model, toolRegistry, ...);
// const results = await Promise.all(ready.map(t => worker.run(t)));

// 新：双通道
async function dispatcherNode(state) {
  const ready = getReadyTasks(state.pendingTasks, state.completedTasks);
  const waiting = getWaitingTasks(state.pendingTasks, state.completedTasks);

  // 通道 1：direct → AgentRegistry 找对应角色 Agent，直接调用
  const directTasks = ready.filter(t => t.routing === 'direct');
  const directResults = await Promise.all(
    directTasks.map(task => {
      const agent = agentRegistry.getAgent(task.role);
      return agent!.executeTask(task, buildContext(task, state.completedTasks));
    })
  );

  // 通道 2：bus → 发布 command 到 EventBus
  const busTasks = ready.filter(t => t.routing === 'bus');
  const busResults = await Promise.all(
    busTasks.map(async task => {
      const reply = await eventBus.request(
        `agent.command.${task.role}`,
        {
          type: 'subtask_assigned',
          taskId: task.id,
          description: task.description,
          context: buildContext(task, state.completedTasks),
        },
        120_000, // 2 min timeout per subtask
      );
      // reply.payload 即为 Agent 执行结果
      return parseResult(reply);
    })
  );

  // 合并
  const results = [...directResults, ...busResults];

  // 检测需要 replan 的信号
  const needReplan = results.some(r => r.status === 'replan_needed');

  // 决定 nextAction
  const nextAction = needReplan ? 'replan'
    : waiting.length > 0 ? 'continue'
    : 'finalize';

  return { completedTasks: merge(results), pendingTasks: waiting, nextAction };
}
```

### 构建上下文

```typescript
function buildContext(task: SubTask, completed: Record<string, TaskResult>): string {
  const parts: string[] = [];
  if (task.dependsOn?.length) {
    for (const depId of task.dependsOn) {
      const dep = completed[depId];
      if (dep) {
        parts.push(`[前置任务 "${depId}" 的结果]：${dep.result ?? dep.error}`);
      }
    }
  }
  return parts.join('\n\n');
}
```

---

## 4.3 Replanner（新增）

### 职责

当 Dispatcher 检测到 `replan_needed` 信号时，由 Replanner 节点介入：
1. 读取失败任务的信息
2. 分析失败原因
3. 用 LLM 生成修正后的 Plan
4. 将修正后任务重新放入 pendingTasks

### 输入/输出

```typescript
interface ReplannerInput {
  plan: Plan;
  completedTasks: Record<string, TaskResult>;
  replanSignal: {
    sourceTaskId: string;
    reason: string;
    suggestion: string;
  };
}

interface ReplannerOutput {
  plan: Plan;
  pendingTasks: SubTask[];
  nextAction: 'continue';
}
```

### Prompt 设计

```
You are a Plan Reviser. A subtask execution indicated the current plan needs adjustment.

## Original Plan
{originalPlan}

## Completed Tasks
{completedSummary}

## Replan Signal
Task: {sourceTaskId}
Reason: {reason}
Suggestion: {suggestion}

## Instructions
1. Analyze the issue and determine what needs to change
2. Adjust the remaining tasks: add, remove, reorder, or modify
3. Return a valid JSON array of remaining SubTask objects
4. Keep completed tasks out of the new plan
5. Preserve dependency relationships
```

---

## 4.4 Finalizer（替代 Summarizer）

### 拆分说明

| 功能 | 原来在 Summarizer | 现在归属 |
|------|------------------|---------|
| 汇总 Agent 结果 | ✅ | Finalizer |
| 生成 Markdown 报告 | ✅ | Finalizer |
| 上下文压缩 | ❌（混在一起） | ContextManager（Agent Runtime） |

### 输入/输出

```typescript
interface FinalizerInput {
  userRequest: string;
  completedTasks: Record<string, TaskResult>;
  artifacts: { files: FileChange[]; commits: CommitRecord[]; tests: TestResult[] };
}

interface FinalizerOutput {
  finalResponse: string;  // Markdown
}
```

### Prompt 设计

```
You are a Result Finalizer. Compile the completed subtask results into a comprehensive final response.

## User's Original Request
{userRequest}

## Completed Tasks
{taskSummaries}

## Artifacts Produced
- Files changed: {fileList}
- Commits: {commitList}
- Tests: {testSummary}

## Instructions
1. Highlight successes. Clearly note any failures.
2. Include the artifacts produced (files, commits, test results).
3. Use clear Markdown formatting.
4. Be concise but complete.
5. Do NOT mention internal task IDs.
6. Suggest next steps if applicable.
```

---

## 4.5 状态图更新

```typescript
// packages/server/src/orchestrator/state.ts 新增字段

export const OrchestratorState = Annotation.Root({
  // ... 原有字段 ...
  replanSignal: Annotation<{
    sourceTaskId: string;
    reason: string;
    suggestion: string;
  } | null>,
  artifacts: Annotation<{
    files: FileChange[];
    commits: CommitRecord[];
    tests: TestResult[];
  }>,
});
```

```typescript
// packages/server/src/orchestrator/graph.ts 新图

const graph = new StateGraph(OrchestratorState)
  .addNode('planner', plannerNode)
  .addNode('dispatcher', dispatcherNode)
  .addNode('replanner', replannerNode)      // 🆕
  .addNode('finalizer', finalizerNode)       // ✏️ 原 summarizer

  .addEdge(START, 'planner')
  .addEdge('planner', 'dispatcher')

  // 条件路由
  .addConditionalEdges('dispatcher', (s) => s.nextAction, {
    continue: 'dispatcher',
    replan: 'replanner',
    finalize: 'finalizer',
  })

  .addEdge('replanner', 'dispatcher')        // replan 后回到 dispatcher
  .addEdge('finalizer', END);
```

---

## 4.6 chat.ts 适配

```typescript
// packages/server/src/gateway/ws/chat.ts

// 在 handler 初始化时创建共享实例：
const eventBus = new InMemoryEventBus();
const stateManager = new InMemoryStateManager(eventBus);
const agentRegistry = new AgentRegistry(eventBus, stateManager);

// 预注册 3 个角色 Agent
await agentRegistry.createAgent('code', model, toolRegistry);
await agentRegistry.createAgent('test', model, toolRegistry);
await agentRegistry.createAgent('doc', model, toolRegistry);

// Orchestrator 工厂函数签名变化：
// 原：createOrchestratorGraph(model, toolRegistry, workspacePath, permissionRegistry, onConfirm)
// 新：增加 eventBus, stateManager, agentRegistry
const graph = createOrchestratorGraph({
  model, toolRegistry, workspacePath, permissionRegistry,
  eventBus, stateManager, agentRegistry,
  onConfirmRequired,
});
```

---

## 验证标准

| 检查项 | 预期结果 |
|--------|---------|
| Planner 输出符合新 Plan 结构 | `complexity` / `routing` / `role` / `suggestedAgents` |
| `complexity: 'simple'` 场景 | 所有任务走 direct 通道 |
| `complexity: 'complex'` 场景 | bus 任务正确发布 + 等待 Agent 完成 |
| Replanner 正确修正 plan | 失败任务 → replanSignal → 新 pendingTasks |
| Finalizer 输出 Markdown | 含文件、commit、测试结果 |
| `pnpm --filter @my-agent/server test` | Orchestrator 测试全过 |
| 手动：简单任务端到端 | "读取 package.json" → 正常完成 |

---

## 兼容性说明

- **direct 路径**：现有 WorkerAgent 行为不变（通过 Agent 兼容层）
- **bus 路径**：Step 5 角色 Agent 启动后自动生效
- **orchestrator graph 接口**：调用方（chat.ts）只需传入新依赖，原有参数保留
