# Step 1 — EventBus + StateManager

> 依赖：无（纯新增，现有系统零影响）
> 目标：搭建多 Agent 协作的两大基础设施

## 改动范围

```
packages/core/src/
├── event-bus/
│   ├── types.ts          🆕 BusMessage / CommandTopic / EventTopic / EventBus 接口
│   └── bus.ts            🆕 InMemoryEventBus（接口 + 内存实现 + 单测）
├── state/
│   ├── types.ts          🆕 StateManager / TaskState / WorkflowState / AgentState / ArtifactState 接口
│   └── manager.ts        🆕 StateManager 实现 + 状态机单测
└── index.ts              ✏️ 导出新模块
```

**新增 4 文件，修改 1 文件。**

---

## 1.1 EventBus

### 接口定义

```typescript
// packages/core/src/event-bus/types.ts

/** 消息 ID */
type MessageId = string;

/** 消息信封 */
interface BusMessage<T = unknown> {
  id: MessageId;
  topic: string;
  payload: T;
  metadata: {
    correlationId?: MessageId;
    taskId?: string;
    senderId: string;
    timestamp: Date;
    ttl?: number;
  };
}

/** Command 主题 */
type CommandTopic = `agent.command.${string}`;

/** Event 主题 */
type EventTopic = `agent.event.${string}`;

/** 订阅处理器 */
type MessageHandler<T = unknown> = (msg: BusMessage<T>) => Promise<void>;

/** 取消订阅函数 */
type Unsubscribe = () => void;

/** EventBus 接口 */
interface IEventBus {
  publish(topic: CommandTopic | EventTopic, payload: unknown, metadata?: Partial<BusMessage['metadata']>): Promise<void>;
  request(topic: CommandTopic, payload: unknown, timeoutMs?: number): Promise<BusMessage>;
  subscribe(topic: string, handler: MessageHandler): Unsubscribe;
  subscribePattern(pattern: string, handler: MessageHandler): Unsubscribe;
  reply(inReplyTo: MessageId, payload: unknown): Promise<void>;
  /** 订阅者数量（调试用） */
  subscriberCount(topic: string): number;
}
```

### 内存实现

```typescript
// packages/core/src/event-bus/bus.ts

class InMemoryEventBus implements IEventBus {
  private handlers = new Map<string, Set<MessageHandler>>();
  private patternHandlers: Array<{ regex: RegExp; handler: MessageHandler }> = [];
  private pendingRequests = new Map<MessageId, { resolve: Function; timer: NodeJS.Timeout }>();

  async publish(topic, payload, metadata?) { /* fire-and-forget */ }
  async request(topic, payload, timeoutMs = 30000) { /* 等待 reply */ }
  subscribe(topic, handler) { /* 精确匹配 */ }
  subscribePattern(pattern, handler) { /* glob → regex */ }
  async reply(inReplyTo, payload) { /* 唤醒 pending request */ }
}
```

### 关键行为

| 功能 | 行为 |
|------|------|
| `publish` | 同步通知所有匹配订阅者。订阅者抛异常不中断其他订阅者 |
| `request` | 生成 correlationId，注册 pending，等待 `reply`。超时抛 `BusTimeoutError` |
| `subscribePattern` | `agent.event.*` 匹配 `agent.event.code_changed`、`agent.event.test_passed` 等 |
| `reply` | 仅匹配 pending request 的 correlationId，匹配不到则静默忽略 |
| 错误隔离 | 单个 handler 抛异常不影响其他 handler |

### 单元测试清单

- [ ] `publish` → 精确订阅者收到消息
- [ ] `publish` → 通配订阅者收到消息
- [ ] `publish` → 无匹配订阅者不报错
- [ ] `request` → 收到 reply → 返回响应消息
- [ ] `request` → 超时 → 抛出 `BusTimeoutError`
- [ ] `reply` → 无匹配 request → 静默忽略
- [ ] `subscribe` → 返回 unsubscribe 函数 → 取消后不再收到消息
- [ ] 订阅者抛异常 → 其他订阅者仍正常收到消息
- [ ] `subscriberCount` 返回正确数量

---

## 1.2 StateManager

### 接口定义

```typescript
// packages/core/src/state/types.ts

/** 任务状态 */
type TaskStatus = 'pending' | 'assigned' | 'running' | 'awaiting_input' | 'completed' | 'failed' | 'cancelled';

interface Task {
  id: string;
  sessionId: string;
  status: TaskStatus;
  role: string;
  parentTaskId?: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

interface TaskState {
  create(task: Omit<Task, 'status' | 'createdAt' | 'updatedAt'>): Task;
  get(taskId: string): Task | undefined;
  getAll(): Task[];
  transition(taskId: string, to: TaskStatus): void;
  blockedTasks(): Task[];
  progress(): { total: number; done: number; failed: number; running: number; pending: number };
  /** 监听状态变更（内部使用，配合 EventBus） */
  onChange(handler: (taskId: string, from: TaskStatus, to: TaskStatus) => void): Unsubscribe;
}

/** Agent 实时状态 */
interface AgentStatus {
  agentId: string;
  role: string;
  status: 'idle' | 'busy' | 'error' | 'offline';
  currentTask?: string;
  lastHeartbeat: Date;
  toolCallCount: number;
}

interface AgentState {
  register(agentId: string, role: string): void;
  update(agentId: string, partial: Partial<AgentStatus>): void;
  get(agentId: string): AgentStatus | undefined;
  getAll(): AgentStatus[];
  active(): AgentStatus[];
  findIdle(role: string): AgentStatus | undefined;
  heartbeat(agentId: string): void;
}

/** 产物记录 */
interface FileChange {
  path: string;
  action: 'created' | 'modified' | 'deleted';
  taskId: string;
  agentRole: string;
  timestamp: Date;
}

interface ArtifactState {
  addFileChange(change: FileChange): void;
  addCommit(hash: string, message: string, taskId: string, files: string[]): void;
  addTestResult(taskId: string, total: number, passed: number, failed: number, output?: string): void;
  changedFiles(): FileChange[];
  byTask(taskId: string): { files: FileChange[]; commits: CommitRecord[]; tests: TestResult[] };
  all(): ArtifactList;
}

/** Workflow 状态 */
interface WorkflowState {
  setCurrentNode(node: string): void;
  getCurrentNode(): string;
  setPlan(plan: Plan): void;
  getPlan(): Plan | undefined;
  addDecision(decision: string): void;
  getDecisions(): string[];
}

/** 总入口 */
interface IStateManager {
  task: TaskState;
  workflow: WorkflowState;
  agents: AgentState;
  artifacts: ArtifactState;
  /** 重置所有状态（测试用） */
  reset(): void;
}
```

### 实现要点

```typescript
// packages/core/src/state/manager.ts

class InMemoryStateManager implements IStateManager {
  task: TaskState;       // 使用 Map + onChange 回调
  workflow: WorkflowState;
  agents: AgentState;
  artifacts: ArtifactState;

  constructor(eventBus?: IEventBus) {
    // 可选：state 变更自动发 Event
    // task.onChange → eventBus.publish('agent.event.task_status_changed', ...)
  }
}
```

### 关键行为

| 功能 | 行为 |
|------|------|
| `TaskState.transition` | 校验状态机合法性（如不能 `completed` → `running`），非法抛异常 |
| `TaskState.onChange` | status 变化时触发回调，配合 EventBus 自动发事件 |
| `AgentState.heartbeat` | 更新 `lastHeartbeat`，超时未更新自动标记为 `offline`（TODO） |
| `ArtifactState` | 纯追加（append-only），不修改已写入的记录 |

### 状态机

```
pending ──→ assigned ──→ running ──→ completed
                 │            │
                 │            ├──→ failed ──→ (可被 Replanner 重置为 pending)
                 │            │
                 │            └──→ awaiting_input ──→ running
                 │
                 └──→ cancelled
```

### 单元测试清单

- [ ] `TaskState` 状态合法流转
- [ ] `TaskState` 非法流转抛异常
- [ ] `TaskState.progress()` 正确统计
- [ ] `TaskState.blockedTasks()` 返回 awaiting_input 的任务
- [ ] `AgentState.findIdle('code')` 返回第一个空闲 code Agent
- [ ] `AgentState.heartbeat` 更新心跳时间
- [ ] `ArtifactState` byTask 正确归并产物
- [ ] `StateManager.reset()` 清空所有状态

---

## 验证标准

| 检查项 | 预期结果 |
|--------|---------|
| `pnpm --filter @my-agent/core test` | 全部通过（EventBus + StateManager 单测） |
| `pnpm typecheck` | 无类型错误 |
| 现有功能 | 完全不受影响（只新增导出，零修改现有逻辑） |
