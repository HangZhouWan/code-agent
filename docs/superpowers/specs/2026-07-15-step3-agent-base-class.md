# Step 3 — Agent 基类 + AgentRegistry

> 依赖：Step 2（ExecutionEngine + Checkpoint + Memory）
> 目标：建立 Agent 抽象——角色定义、推理循环、注册管理。WorkerAgent 保留兼容层。

## 改动范围

```
packages/core/src/agent/
├── agent.ts            🆕 Agent 基类（四层结构）
├── role.ts             🆕 AgentRole + built-in roles
├── reasoning.ts        🆕 ReasoningLoop
├── registry.ts         🆕 AgentRegistry
├── types.ts            ✏️ 扩展：AgentInput / AgentOutput / Thought
└── worker.ts           ✏️ WorkerAgent 兼容层（委托给 Agent.run）
└── index.ts             🆕 agent 包导出
```

**新增 5 文件，修改 2 文件。**

---

## 3.1 AgentRole（角色定义）

```typescript
// packages/core/src/agent/role.ts

interface AgentRole {
  /** 角色唯一标识，如 'code' */
  id: string;

  /** 显示名称，如 'Code Agent' */
  name: string;

  /** 自然语言描述（对其他 Agent 可见，帮助他们决定是否委托） */
  description: string;

  /** 系统提示 */
  systemPrompt: string;

  /** 订阅的 Command 主题（这个角色能处理的任务类型） */
  commandSubscriptions: string[];

  /** 关注的 Event 主题（这个角色关心哪些事发生） */
  eventSubscriptions: string[];

  /** 默认允许的工具列表 */
  defaultTools: string[];

  /** 能否派发子任务给其他 Agent */
  canDelegate: boolean;

  /** 可以委托给哪些角色 */
  delegatableRoles: string[];
}
```

### 内置角色定义

```typescript
const BUILTIN_ROLES: AgentRole[] = [
  {
    id: 'code',
    name: 'Code Agent',
    description: 'Responsible for reading, writing, and modifying code files. Handles code review tasks.',
    systemPrompt: `You are a Software Engineer Agent. Your responsibilities:
- Read and analyze source code
- Write and modify code files
- Run basic code quality checks
- Report code changes clearly`,
    commandSubscriptions: ['agent.command.code_review', 'agent.command.code_modify', 'agent.command.code_generate'],
    eventSubscriptions: ['agent.event.test_failed', 'agent.event.code_changed'],
    defaultTools: ['file_read', 'file_write', 'code_search', 'shell', 'git'],
    canDelegate: true,
    delegatableRoles: ['test', 'doc'],
  },
  {
    id: 'test',
    name: 'Test Agent',
    description: 'Responsible for running tests, analyzing failures, and suggesting fixes.',
    systemPrompt: `You are a QA Engineer Agent. Your responsibilities:
- Run test suites
- Analyze test failures
- Write missing test cases
- Report test results clearly`,
    commandSubscriptions: ['agent.command.test_run', 'agent.command.test_write'],
    eventSubscriptions: ['agent.event.code_changed'],
    defaultTools: ['shell', 'file_read', 'file_write', 'code_search'],
    canDelegate: false,
    delegatableRoles: [],
  },
  {
    id: 'doc',
    name: 'Doc Agent',
    description: 'Responsible for generating documentation, README files, and API docs.',
    systemPrompt: `You are a Technical Writer Agent. Your responsibilities:
- Generate documentation from code
- Write README and API documentation
- Keep docs consistent with code changes`,
    commandSubscriptions: ['agent.command.doc_generate', 'agent.command.doc_update'],
    eventSubscriptions: ['agent.event.code_changed'],
    defaultTools: ['file_read', 'file_write', 'code_search'],
    canDelegate: false,
    delegatableRoles: [],
  },
];
```

---

## 3.2 Agent 基类

```typescript
// packages/core/src/agent/agent.ts

class Agent {
  readonly id: string;
  readonly role: AgentRole;

  private engine: ExecutionEngine;
  private eventBus: IEventBus;
  private stateManager: IStateManager;
  private model: BaseChatModel;
  private toolRegistry: ToolRegistry;
  private contextManager: ContextManager;
  private hooks: HooksEngine;

  /** 当前状态（映射到 AgentState） */
  private status: 'idle' | 'busy' | 'error';
  private currentTaskId?: string;

  /** 活跃的订阅取消函数 */
  private unsubscribers: Unsubscribe[] = [];

  constructor(config: AgentConfig) {
    this.id = crypto.randomUUID();
    this.role = config.role;
    this.model = config.model;
    // ...
  }

  /** 启动 Agent — 订阅 Bus topics，注册到 StateManager */
  async start(): Promise<void> {
    // 注册到 StateManager
    this.stateManager.agents.register(this.id, this.role.id);

    // 订阅 command topics
    for (const topic of this.role.commandSubscriptions) {
      const unsub = this.eventBus.subscribe(topic, async (msg) => {
        if (this.status === 'busy') {
          // 忙时暂不领取新任务，消息留 bus 里由其他空闲 Agent 领取
          return;
        }
        await this.handleCommand(msg);
      });
      this.unsubscribers.push(unsub);
    }

    // 订阅 event topics（只观察，不响应）
    for (const topic of this.role.eventSubscriptions) {
      const unsub = this.eventBus.subscribe(topic, async (msg) => {
        await this.handleEvent(msg);
      });
      this.unsubscribers.push(unsub);
    }

    // 发送心跳
    setInterval(() => this.stateManager.agents.heartbeat(this.id), 5000);
  }

  /** 停止 Agent */
  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
  }

  /** 响应 Command（被 Bus 驱动） */
  private async handleCommand(msg: BusMessage): Promise<void> {
    this.status = 'busy';
    this.currentTaskId = msg.metadata.taskId;
    this.stateManager.agents.update(this.id, {
      status: 'busy',
      currentTask: this.currentTaskId,
    });

    // 发布 task_started
    await this.eventBus.publish('agent.event.task_started', {
      agentId: this.id,
      taskId: this.currentTaskId,
    });

    // 委托给 ExecutionEngine
    const result = await this.engine.run({
      agentId: this.id,
      taskId: this.currentTaskId!,
      agent: this,
      model: this.model,
      tools: this.getTools(),
      systemPrompt: this.role.systemPrompt,
      context: await this.contextManager.build(this, msg.payload),
      capability: this.capability,
    });

    // 发布完成/失败事件
    if (result.status === 'success') {
      await this.eventBus.publish('agent.event.task_completed', {
        taskId: this.currentTaskId,
        agentId: this.id,
        result: result.result,
      });
    } else {
      await this.eventBus.publish('agent.event.task_failed', {
        taskId: this.currentTaskId,
        agentId: this.id,
        error: result.error,
      });
      if (result.status === 'replan_needed') {
        await this.eventBus.publish('agent.event.replan_needed', {
          taskId: this.currentTaskId,
          reason: result.result,
        });
      }
    }

    this.status = 'idle';
    this.stateManager.agents.update(this.id, { status: 'idle', currentTask: undefined });
    this.currentTaskId = undefined;
  }

  /** 处理 Event（观察，可能触发行为） */
  private async handleEvent(msg: BusMessage): Promise<void> {
    // 默认不做响应，子类可覆盖
    // 例如 Test Agent 收到 code_changed → 自动跑测试
  }

  /** 对外：直接执行任务（Dispatcher direct 路径用） */
  async executeTask(task: Task, context: string): Promise<ExecutionResult> {
    // 不走 Bus，直接调用 ExecutionEngine
    this.status = 'busy';
    const ctx = await this.contextManager.build(this, { task, context });
    const result = await this.engine.run({ /* ... */ });
    this.status = 'idle';
    return result;
  }
}
```

---

## 3.3 AgentRegistry

```typescript
// packages/core/src/agent/registry.ts

class AgentRegistry {
  private agents = new Map<string, Agent>();
  private roles = new Map<string, AgentRole>();

  constructor(private eventBus: IEventBus, private stateManager: IStateManager) {
    // 注册内置角色
    for (const role of BUILTIN_ROLES) this.roles.set(role.id, role);
  }

  /** 注册自定义角色 */
  registerRole(role: AgentRole): void;

  /** 创建并启动 Agent 实例 */
  async createAgent(roleId: string, model: BaseChatModel, toolRegistry: ToolRegistry): Promise<Agent>;

  /** 获取指定角色的 Agent（优先返回空闲的） */
  getAgent(roleId: string): Agent | undefined;

  /** 获取角色的所有 Agent（busy + idle） */
  getAgents(roleId: string): Agent[];

  /** 列出所有可用角色 */
  listRoles(): AgentRole[];

  /** 停止并移除 Agent */
  async removeAgent(agentId: string): Promise<void>;

  /** 停止所有 Agent */
  async shutdown(): Promise<void>;
}
```

---

## 3.4 WorkerAgent 兼容层

保留 `WorkerAgent` 类，内部委托给 `Agent`，保证现有 Dispatcher 调用不受影响：

```typescript
// packages/core/src/agent/worker.ts（修改后）

export class WorkerAgent {
  private agent: Agent | null = null;

  async run(input: WorkerInput): Promise<WorkerOutput> {
    // 懒初始化 Agent（首次调用时创建）
    if (!this.agent) {
      this.agent = new Agent({
        role: {
          id: 'worker',
          name: 'Worker Agent',
          description: 'General-purpose worker agent',
          systemPrompt: buildSystemPrompt(input, ''),
          commandSubscriptions: [],
          eventSubscriptions: [],
          defaultTools: input.tools,
          canDelegate: false,
          delegatableRoles: [],
        },
        model: this.model,
        runtime: { ... },
      });
    }

    const result = await this.agent.executeTask({
      id: input.taskId,
      description: input.description,
      ...
    }, input.context);

    return {
      taskId: input.taskId,
      status: result.status === 'replan_needed' ? 'failed' : result.status,
      result: result.result,
      error: result.error,
      toolCalls: result.toolCalls,
    };
  }
}
```

**公开 API 完全不变**：`WorkerAgent.run(input)` → `WorkerOutput`。

---

## 验证标准

| 检查项 | 预期结果 |
|--------|---------|
| `Agent.start()` | 注册到 StateManager + 订阅 Bus topics |
| `Agent.stop()` | 取消所有订阅 + 从 StateManager 移除 |
| `Agent.executeTask()` | 单 Agent 正常完成简单任务 |
| `AgentRegistry.createAgent('code')` | 创建并启动一个 Code Agent |
| `AgentRegistry.getAgent('code')` | 返回空闲 Code Agent（idle） |
| `WorkerAgent.run()` | 与旧行为完全一致 |
| `pnpm --filter @code-agent/core test` | Agent 模块单测全过 |
| `pnpm --filter @code-agent/server test` | 现有测试不受影响 |
