# Step 5 — 角色 Agent + Storage + 集成

> 依赖：Step 4（Orchestrator 改造）
> 目标：注册 Code/Test/Doc 角色 Agent，完成 Storage 层扩展，端到端多 Agent 协作验证

## 改动范围

```
packages/web/src/
├── components/
│   └── AgentStatusCard.tsx   🆕 多 Agent 状态面板（可选 UI）

packages/server/src/
├── db/
│   ├── schema.ts             ✏️ 扩展表：tasks / artifacts / events / long_term_memory
│   └── repositories/
│       ├── tasks.ts          🆕
│       ├── artifacts.ts      🆕
│       └── events.ts         🆕
├── gateway/
│   ├── ws/
│   │   └── chat.ts           ✏️ 集成所有组件 + Agent 生命周期管理
│   └── routes/
│       └── agents.ts         🆕 Agent 状态查询 API（可选）
└── index.ts                  ✏️ 启动时初始化 Agent 实例

packages/core/src/
└── agent/
    └── roles/                🆕 内置角色定义文件
        ├── code.ts
        ├── test.ts
        └── doc.ts
```

**新增 8 文件，修改 3 文件。**

---

## 5.1 Storage 扩展

### Drizzle Schema 扩表

```typescript
// packages/server/src/db/schema.ts 新增

// ── Tasks 表 ──
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['pending', 'assigned', 'running', 'awaiting_input', 'completed', 'failed', 'cancelled'] }).notNull().default('pending'),
  role: text('role').notNull(),
  parentTaskId: text('parent_task_id'),
  description: text('description').notNull(),
  plan: text('plan'),              // JSON
  result: text('result'),          // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

// ── Artifacts 表 ──
export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['file_change', 'commit', 'test_result'] }).notNull(),
  data: text('data').notNull(),   // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ── Events 表（可选，审计/回溯用） ──
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  topic: text('topic').notNull(),
  payload: text('payload').notNull(), // JSON
  correlationId: text('correlation_id'),
  taskId: text('task_id'),
  senderId: text('sender_id').notNull(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

// ── Long-Term Memory 表 ──
export const longTermMemory = sqliteTable('long_term_memory', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  metadata: text('metadata'),     // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});
```

### Repository 实现

```typescript
// packages/server/src/db/repositories/tasks.ts
class TaskRepository {
  create(task: CreateTaskInput): Promise<Task>;
  updateStatus(id: string, status: TaskStatus): Promise<void>;
  getBySession(sessionId: string): Promise<Task[]>;
  getById(id: string): Promise<Task | undefined>;
}

// packages/server/src/db/repositories/artifacts.ts
class ArtifactRepository {
  addFileChange(change: FileChangeInput): Promise<void>;
  addCommit(commit: CommitInput): Promise<void>;
  addTestResult(result: TestResultInput): Promise<void>;
  getByTask(taskId: string): Promise<Artifact[]>;
}

// packages/server/src/db/repositories/events.ts
class EventRepository {
  store(event: EventInput): Promise<void>;
  getBySession(sessionId: string): Promise<Event[]>;
  getByTask(taskId: string): Promise<Event[]>;
}
```

---

## 5.2 内置角色定义

```typescript
// packages/core/src/agent/roles/code.ts
export const CODE_AGENT_ROLE: AgentRole = {
  id: 'code',
  name: 'Code Agent',
  description: 'Read, write, and modify code files. Handles code review and refactoring.',
  systemPrompt: `You are a Software Engineer Agent...`,
  commandSubscriptions: [
    'agent.command.code_review',
    'agent.command.code_modify',
    'agent.command.code_generate',
  ],
  eventSubscriptions: [
    'agent.event.test_failed',
    'agent.event.code_changed',
  ],
  defaultTools: ['file_read', 'file_write', 'code_search', 'shell', 'git'],
  canDelegate: true,
  delegatableRoles: ['test', 'doc'],
};

// packages/core/src/agent/roles/test.ts
export const TEST_AGENT_ROLE: AgentRole = {
  id: 'test',
  name: 'Test Agent',
  description: 'Run tests, analyze failures, write test cases.',
  commandSubscriptions: ['agent.command.test_run', 'agent.command.test_write'],
  eventSubscriptions: ['agent.event.code_changed'],
  defaultTools: ['shell', 'file_read', 'file_write', 'code_search'],
  canDelegate: false,
  delegatableRoles: [],
};

// packages/core/src/agent/roles/doc.ts
export const DOC_AGENT_ROLE: AgentRole = {
  id: 'doc',
  name: 'Doc Agent',
  description: 'Generate documentation from code, update README.',
  commandSubscriptions: ['agent.command.doc_generate', 'agent.command.doc_update'],
  eventSubscriptions: ['agent.event.code_changed'],
  defaultTools: ['file_read', 'file_write', 'code_search'],
  canDelegate: false,
  delegatableRoles: [],
};
```

---

## 5.3 服务启动集成

```typescript
// packages/server/src/index.ts 启动流程

async function start() {
  // 1. 初始化基础设施
  const eventBus = new InMemoryEventBus();
  const stateManager = new InMemoryStateManager(eventBus);
  const checkpointManager = new FileCheckpointManager('./data/checkpoints');

  // 2. 初始化 Agent Runtime
  const executionEngine = new ExecutionEngine(checkpointManager, memoryManager, eventBus);
  const contextManager = new ContextManager(/* ... */);

  // 3. 注册角色 Agent
  const agentRegistry = new AgentRegistry(eventBus, stateManager);
  await agentRegistry.createAgent('code', model, toolRegistry);
  await agentRegistry.createAgent('test', model, toolRegistry);
  await agentRegistry.createAgent('doc', model, toolRegistry);

  console.log('[AgentRegistry] Agents started:');
  for (const agent of agentRegistry.getAll()) {
    console.log(`  - ${agent.role.name} (${agent.id})`);
  }

  // 4. 启动 HTTP/WS 网关（注入所有依赖）
  const server = createGateway({
    model, toolRegistry, permissionRegistry,
    eventBus, stateManager, agentRegistry,
    checkpointManager, executionEngine,
    workspacePath,
  });

  // 5. Graceful shutdown
  process.on('SIGTERM', async () => {
    await agentRegistry.shutdown();
    await server.close();
  });
}
```

---

## 5.4 端到端协作流程

### 场景：用户说"帮我重构 src/utils.ts，补上测试，更新 README"

```
1. [WebSocket] 用户消息到达
2. [Planner] 分析 → complexity: 'complex'
   Plan:
   - task-1: 重构 src/utils.ts (code, direct)
   - task-2: 补上测试 (test, bus)
   - task-3: 更新 README (doc, direct)
   dependsOn: task-2 dependsOn task-1
3. [Dispatcher] Round 1:
   - task-1 (direct) → agentRegistry.getAgent('code').executeTask()
   - 完成后 Code Agent publish: agent.event.code_changed
4. [Dispatcher] Round 2 (task-1 completed):
   - task-2 (bus) → eventBus.request('agent.command.test_run', ...)
   - task-3 (direct) → agentRegistry.getAgent('doc').executeTask()
   - Test Agent 收到 command → 开始执行
   - Test Agent 收到 event 'code_changed' → 确认需要跑测试
5. [Dispatcher] Round 3:
   - task-2 完成 → publish agent.event.task_completed
   - task-3 完成 → publish agent.event.task_completed
6. [Finalizer] 汇总所有结果 + artifacts → Markdown 报告
7. [WebSocket] done → 推送给用户
```

### 协作中 Event 流转

```
Code Agent                     Test Agent                    Doc Agent
   │                              │                             │
   │ ──code_changed──→            │                             │
   │                              │ ←── 收到，确认变更           │
   │                              │                             │
   │                              │ ──test_failed──→            │
   │ ←── 收到，检查失败原因        │                             │
   │                              │                             │
   │ ──code_changed──→            │                             │ ──→ 收到，检查文档
   │                              │                             │     是否过时
   │                              │ ──test_passed──→            │
   │ ←── 收到，确认修复            │                             │
```

---

## 5.5 多 Agent 状态 UI（可选）

```typescript
// packages/web/src/components/AgentStatusCard.tsx

// 新增组件：实时显示各 Agent 状态
// 数据来源：WebSocket 新增消息类型 "agent_status"
//
// ┌─────────────────────────┐
// │  Agents                 │
// │  🔵 Code Agent  busy    │
// │  🟢 Test Agent  idle    │
// │  🟢 Doc Agent   idle    │
// └─────────────────────────┘
```

WebSocket 协议扩展：

```typescript
// 服务端 → 客户端 新增消息类型
type ServerMessage =
  | /* ... existing types ... */
  | { type: 'agent_status'; agents: Array<{ role: string; status: string; currentTask?: string }> };
```

StateManager 中 `AgentState.onChange` → 推送 `agent_status` 到前端。

---

## 5.6 数据库迁移

```typescript
// packages/server/src/db/migrate.ts

// 使用 Drizzle push 或手动 migration：

// Migration 001: add multi-agent tables
// - CREATE TABLE tasks (...)
// - CREATE TABLE artifacts (...)
// - CREATE TABLE events (...)
// - CREATE TABLE long_term_memory (...)

// Migration 002: add session_id to existing tables (if needed)
```

---

## 验证标准

| 检查项 | 预期结果 |
|--------|---------|
| 服务启动 | 3 个 Agent 注册成功，状态 idle |
| Planner 多角色计划 | "重构代码 + 写测试 + 更新 README" → 3 个 SubTask，各不同 role |
| Dispatcher direct 路径 | Code Agent 直接执行代码修改 |
| Dispatcher bus 路径 | Test Agent 通过 Bus 收到 command + 执行 |
| Agent 间 Event 通信 | Code Agent 改完 → Test Agent 收到 `code_changed` |
| Replanner 介入 | 测试失败 → replan → 新增"修复代码"任务 |
| Finalizer 输出 | Markdown 含文件变更、测试结果、下一步建议 |
| Storage 持久化 | tasks / artifacts / events 表有数据 |
| 中断恢复 | kill 服务 → 重启 → resume task-1 |
| `pnpm --filter @my-agent/server test` | 集成测试全过 |
| 端到端 | "重构 src/utils.ts 并写测试" → 完整协作 → 用户收到报告 |
