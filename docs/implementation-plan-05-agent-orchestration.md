# 实现计划 05：Agent 编排层实现

**对应技术文档**：[2026-07-02-technical-implementation.md](./2026-07-02-technical-implementation.md) 第六节

**预计工时**：5-7 天（第 3-4 周）

**前置模块**：[01-Monorepo](./implementation-plan-01-monorepo.md)、[02-LLM 抽象层](./implementation-plan-02-llm-abstraction.md)、[03-工具层](./implementation-plan-03-tools-layer.md)、[04-Agent Runtime](./implementation-plan-04-agent-runtime.md)

---

## 1. 目标

构建两层 Agent 架构：

| 层级 | 组件 | 职责 |
|------|------|------|
| **Worker** | `WorkerAgent` | 执行单个子任务，使用受限工具集，返回结构化结果 |
| **Orchestrator** | LangGraph 状态图 | 任务分解 → 并行派发 → 结果汇总 |

## 2. 产出物清单

```
packages/core/src/agent/
├── types.ts        # WorkerInput, WorkerOutput, WorkerStatus
├── worker.ts       # WorkerAgent 类
└── loop.ts         # (可选) 单 Agent 对话循环

packages/server/src/orchestrator/
├── types.ts        # SubTask 接口
├── state.ts        # OrchestratorState（LangGraph Annotation）
├── graph.ts        # createOrchestratorGraph()
└── nodes/
    ├── planner.ts     # 计划器节点
    ├── dispatcher.ts  # 派发器节点
    └── summarizer.ts  # 汇总器节点
```

---

## 3. 子 Agent（Worker）

### 3.1 类型定义 (`core/src/agent/types.ts`)

```typescript
interface WorkerInput {
  taskId: string;
  description: string;
  tools: string[];
  context: string;
  workspacePath: string;
  maxIterations?: number;   // 默认 15
  timeoutMs?: number;       // 默认 60000
}

type WorkerStatus = 'running' | 'success' | 'failed' | 'timeout' | 'awaiting_approval';

interface WorkerOutput {
  taskId: string;
  status: WorkerStatus;
  result?: string;
  error?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
}
```

### 3.2 WorkerAgent 实现 (`core/src/agent/worker.ts`)

```typescript
export class WorkerAgent {
  constructor(
    private model: BaseChatModel,
    private toolRegistry: ToolRegistry,
  ) {}

  async run(input: WorkerInput): Promise<WorkerOutput> { ... }
}
```

**`run()` 方法的执行流程**：

```
1. 构建 AgentCapability（tools + paths + timeoutMs）
2. 创建 ContextManager 独立上下文
3. 通过 ToolRegistry.getToolsForAgent() 获取受限工具集
4. 创建 SandboxGuard（传入 capability + PermissionRegistry）
5. 构建 LangChain Agent：
   - ChatPromptTemplate（system + human + agent_scratchpad）
   - createToolCallingAgent（llm + tools + prompt）
   - AgentExecutor（agent + tools + callbacks: [guard] + maxIterations）
6. 触发 hook: agent:start
7. 执行 executor.invoke()（带 AbortSignal.timeout 超时控制）
8. 处理结果：
   - success → 返回 result + toolCalls
   - ConfirmRequiredError → awaiting_approval
   - AbortError → timeout
   - 其他异常 → failed
9. 触发 hook: agent:end / agent:error
10. finally: 清理 ContextManager
```

**System Prompt 设计要点**：
- 强调 Worker 不直接与用户交互，只用工具并返回结果
- 限定在分配任务的范围内
- 工具失败时尝试替代方案或报告失败
- 所有文件路径相对于工作区

### 3.3 可选：单 Agent 对话循环 (`core/src/agent/loop.ts`)

如果需要在没有 Orchestrator 的情况下运行单个 Agent，可实现一个简单的对话循环，但当前需求中此文件为可选。

---

## 4. 主 Agent（Orchestrator）—— LangGraph 实现

### 4.1 架构图

```
用户消息
  │
  ▼
planner ──→ 生成 SubTask[]
  │
  ▼
dispatcher ──→ 筛选无依赖子任务 → Promise.all 并行派发 WorkerAgent
  │              有依赖 → 等前置完成
  │              子任务完成 → 写入 completedTasks
  │
  │ pendingTasks.length > 0 ?
  │   ├─ yes → 回到 dispatcher (continue)
  │   └─ no  → summarizer
  │
  ▼
summarizer ──→ 汇总所有 Worker 结果 → 最终回复
```

### 4.2 状态定义 (`server/src/orchestrator/state.ts`)

使用 LangGraph 的 `Annotation.Root`：

```typescript
export const OrchestratorState = Annotation.Root({
  messages:       Annotation<BaseMessage[]>,          // reducer: 追加
  plan:           Annotation<SubTask[]>,              // reducer: 替换
  completedTasks: Annotation<Record<string, WorkerOutput>>,  // reducer: 合并
  pendingTasks:   Annotation<SubTask[]>,              // reducer: 替换
  finalResponse:  Annotation<string>,                 // reducer: 替换
  nextAction:     Annotation<string>,                 // reducer: 替换
});
```

**`SubTask` 接口**：
```typescript
interface SubTask {
  id: string;
  description: string;
  tools: string[];
  dependsOn?: string[];
}
```

### 4.3 计划器节点 (`nodes/planner.ts`)

**输入**：`state.messages`（最后一条用户消息）

**输出**：`{ plan, pendingTasks }`

**实现**：
1. 提取最后一条用户消息的 content
2. 用 `SYSTEM_PROMPT` + 用户消息调用 LLM
3. 解析 LLM 返回的 JSON 数组
4. 处理 markdown code block 包裹（正则提取 `[...]`）
5. 返回计划

**System Prompt 核心指令**：
- 将用户请求分解为子任务
- 尽量独立以便并行执行
- 仅在有输出/输入依赖时声明 `dependsOn`
- 可用工具从固定列表中选择

### 4.4 派发器节点 (`nodes/dispatcher.ts`)

**输入**：`{ pendingTasks, completedTasks }`

**输出**：`{ completedTasks, pendingTasks, nextAction }`

**实现逻辑**：
```
1. if pendingTasks.length === 0 → nextAction = 'summarize'
2. 分类任务：
   - ready: dependsOn 全部完成的子任务
   - waiting: 尚有未完成的依赖
3. if ready.length === 0 && waiting.length > 0 → nextAction = 'continue'（等待前置完成）
4. Promise.all 并行执行所有 ready 子任务：
   - 每个子任务创建独立 WorkerAgent
   - 从 completedTasks 提取依赖上下文
   - 调用 worker.run()
5. 结果写入 newCompleted（按 taskId 索引）
6. nextAction = waiting.length > 0 ? 'continue' : 'summarize'
```

**并行派发**：`Promise.all(ready.map(task => worker.run(...)))`

### 4.5 汇总器节点 (`nodes/summarizer.ts`)

**输入**：`{ messages, completedTasks }`

**输出**：`{ finalResponse }`

**实现**：
1. 遍历 `completedTasks`，生成 ✅/❌ 状态摘要
2. 拼接原始用户请求 + Worker 结果
3. 调用 LLM 生成最终回复（Markdown 格式）
4. 成功/失败分别说明

### 4.6 状态图构建 (`graph.ts`)

```typescript
export function createOrchestratorGraph(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
) {
  const graph = new StateGraph(OrchestratorState)
    .addNode("planner", ...)
    .addNode("dispatcher", ...)
    .addNode("summarizer", ...)
    .addEdge("__start__", "planner")
    .addEdge("planner", "dispatcher")
    .addConditionalEdges("dispatcher", (state) => state.nextAction, {
      continue: "dispatcher",    // 循环
      summarize: "summarizer",   // 结束
    })
    .addEdge("summarizer", END);

  return graph.compile();
}
```

**条件路由**：`dispatcher` 根据 `nextAction` 字段决定走循环还是汇总。

---

## 5. 关键设计决策

### 5.1 与 LangGraph 的集成方式

| 决策点 | 选择 | 原因 |
|--------|------|------|
| 状态管理 | LangGraph Annotation.Root | 内置 reducer 支持，类型安全 |
| 节点间通信 | state 字段 | LangGraph 标准模式 |
| 条件路由 | `addConditionalEdges` | 原生支持循环/分支 |
| 错误传播 | state 中携带错误信息 | Orchestrator 可感知子任务失败 |

### 5.2 子 Agent 隔离

- 每个 Worker 有独立的 `ContextManager` 实例
- 子 Agent 只能看到父 Agent 传入的 `context` 摘要
- `inheritForSubAgent()` 传递摘要而非完整消息历史

### 5.3 审批流程

```
WorkerAgent (SandboxGuard 抛出 ConfirmRequiredError)
  → WorkerOutput { status: 'awaiting_approval', error: '...' }
  → Orchestrator 收到状态
  → WebSocket 推送审批请求到前端
  → 用户确认/拒绝
  → 重新执行或跳过
```

当前文档中审批为同步阻塞模式（`Map<string, {resolve, ws}>`），后续可优化为异步事件驱动。

---

## 6. 验收标准

### WorkerAgent
- [ ] `run()` 正常完成简单任务（如 `file.read` 读取文件）
- [ ] 超时控制生效（默认 60s）
- [ ] `ConfirmRequiredError` 正确捕获并返回 `awaiting_approval`
- [ ] 工具执行失败时返回 `failed` 而非崩溃
- [ ] ContextManager 在 finally 中正确清理

### Orchestrator
- [ ] `plannerNode` 将自然语言请求分解为 SubTask[]
- [ ] `dispatcherNode` 正确分类就绪/等待任务
- [ ] 无依赖的多个子任务并行执行
- [ ] 有依赖的子任务等待前置完成后执行
- [ ] `summarizerNode` 生成包含所有子任务结果的最终回复
- [ ] 条件路由 `continue/summarize` 正确工作
- [ ] `graph.streamEvents()` 可正常流式输出

### 集成
- [ ] `createOrchestratorGraph` 可被 API Gateway 调用
- [ ] 整个 pipeline（用户输入 → 计划 → 派发 → 汇总）端到端可运行
