# My-Agent 请求全生命周期分析

> 从用户在前端页面发送一条消息，到最终收到 Agent 的 "Task Done" 回复，完整的代码调用链详解。

---

## 目录

1. [架构总览](#1-架构总览)
2. [阶段一：服务启动与初始化](#2-阶段一服务启动与初始化)
3. [阶段二：前端用户操作](#3-阶段二前端用户操作)
4. [阶段三：WebSocket 消息到达服务端](#4-阶段三websocket-消息到达服务端)
5. [阶段四：Orchestrator 状态机构建与执行](#5-阶段四orchestrator-状态机构建与执行)
6. [阶段五：Planner 节点 —— 任务分解](#6-阶段五planner-节点--任务分解)
7. [阶段六：Dispatcher 节点 —— 双通道任务派发](#7-阶段六dispatcher-节点--双通道任务派发)
8. [阶段七：Agent 执行任务](#8-阶段七agent-执行任务)
9. [阶段八：ExecutionEngine —— ReAct 推理循环](#9-阶段八executionengine--react-推理循环)
10. [阶段九：Finalizer 节点 —— 结果汇总](#10-阶段九finalizer-节点--结果汇总)
11. [阶段十：流式推送与持久化](#11-阶段十流式推送与持久化)
12. [调用链时序图](#12-调用链时序图)
13. [关键文件索引](#13-关键文件索引)

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (packages/web)                      │
│  App.tsx → ChatArea.tsx → useWebSocket.ts → chatStore.ts        │
│                     WebSocket (ws://)                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Gateway (packages/server)                       │
│  server.ts → ws/chat.ts → orchestrator/graph.ts                  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Orchestrator (LangGraph StateGraph)             ││
│  │                                                              ││
│  │   [planner] ──→ [dispatcher] ──→ [replanner] ──┐           ││
│  │                    │    │              │         │           ││
│  │                    │    └── continue ──┘         │           ││
│  │                    │                             │           ││
│  │                    └── finalize ──→ [finalizer]  │           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Core (packages/core)                           │
│                                                                   │
│  AgentRegistry → Agent → ReasoningLoop → ExecutionEngine         │
│       │              │           │              │                 │
│       ▼              ▼           ▼              ▼                 │
│  EventBus ◄──── StateManager    Role       ReAct Loop            │
│                                                       │          │
│  ToolRegistry ──→ file_read, file_write, shell, ...  │          │
│                                                       ▼          │
│                                            LLM (ChatModel)       │
└─────────────────────────────────────────────────────────────────┘
```

项目的四层架构：

- **Role 层**：定义 Agent 身份和能力边界（code/test/doc）
- **Reasoning 层**：封装推理策略（ReAct Observe→Think→Act→Reflect）
- **Runtime 层**：ExecutionEngine 驱动执行循环，Checkpoint/Memory 管理状态
- **Capability 层**：ToolRegistry 管理工具注册和权限过滤

---

## 2. 阶段一：服务启动与初始化

**入口文件**：[packages/server/src/index.ts](packages/server/src/index.ts)

### 2.1 启动流程 (`main()` 函数)

```
main()
 │
 ├─ 1. loadConfig()                           // 加载 .env 环境变量
 │     └─ config.ts: loadConfig()
 │
 ├─ 2. createChatModel({...})                 // 创建 LLM 模型实例
 │     └─ core: llm/factory.ts
 │
 ├─ 3. ToolRegistry.createDefault()           // 创建工具注册表
 │     ├─ toolRegistry.register(fileReadTool)
 │     ├─ toolRegistry.register(fileWriteTool)
 │     ├─ toolRegistry.register(fileListTool)
 │     ├─ toolRegistry.register(shellExecTool)
 │     ├─ toolRegistry.register(codeSearchTool)
 │     ├─ toolRegistry.register(gitStatusTool)
 │     ├─ toolRegistry.register(gitDiffTool)
 │     ├─ toolRegistry.register(gitLogTool)
 │     ├─ toolRegistry.register(gitCommitTool)
 │     ├─ toolRegistry.register(gitBranchTool)
 │     └─ toolRegistry.register(webFetchTool)
 │     // 共 11 个内置工具
 │
 ├─ 4. PermissionRegistry.createDefault()     // 权限注册表
 │
 ├─ 5. Agent 基础设施初始化
 │     ├─ new InMemoryEventBus()              // 事件总线
 │     ├─ new InMemoryStateManager(eventBus)  // 状态管理
 │     ├─ new FileCheckpointManager(...)      // Checkpoint 持久化
 │     └─ new ExecutionEngine()               // 执行引擎
 │
 ├─ 6. AgentRegistry 创建与 Agent 注册
 │     ├─ new AgentRegistry(eventBus, stateManager)
 │     │     └─ 注册 BUILTIN_ROLES (code/test/doc)
 │     ├─ agentRegistry.createAgent("code", model, toolRegistry, {...})
 │     │     └─ 创建 Agent → agent.start()
 │     │           ├─ stateManager.agents.register(id, roleId)
 │     │           ├─ eventBus.subscribe(command topics)  // 订阅任务
 │     │           ├─ eventBus.subscribe(event topics)    // 订阅事件
 │     │           └─ setInterval(heartbeat, 5000)        // 心跳
 │     ├─ agentRegistry.createAgent("test", ...)
 │     └─ agentRegistry.createAgent("doc", ...)
 │
 ├─ 7. createDb(cfg.DB_PATH)                  // SQLite + Drizzle ORM
 │
 ├─ 8. createServer({model, toolRegistry, ...})  // Fastify 实例
 │     └─ gateway/server.ts
 │           ├─ fastifyCors
 │           ├─ fastifyWebsocket
 │           ├─ sessionRoutes  →  /api/sessions
 │           ├─ toolRoutes     →  /api/tools
 │           ├─ agentRoutes    →  /api/agents
 │           └─ WebSocket 路由 →  /api/sessions/:id/chat
 │                 └─ createChatWebSocket({...})
 │
 ├─ 9. app.decorate("db", db)                 // 挂载共享实例
 ├─    app.decorate("permissionRegistry", ...)
 ├─    app.decorate("checkpointManager", ...)
 ├─    app.decorate("executionEngine", ...)
 │
 └─ 10. app.listen({host, port})             // 启动 HTTP + WS 服务
```

### 2.2 关键初始化细节

**AgentRegistry 构造函数** ([registry.ts:51-63](packages/core/src/agent/registry.ts#L51-L63))：
- 注册 3 个内置角色（code/test/doc）
- 创建共享的 `ExecutionEngine` 和 `ContextManager`

**Agent.start()** ([agent.ts:131-158](packages/core/src/agent/agent.ts#L131-L158))：
- 向 StateManager 注册自身
- 订阅角色声明的 Command 主题（领取任务）
- 订阅角色声明的 Event 主题（观察环境）
- 启动 5 秒心跳定时器

**WebSocket Handler 创建** ([chat.ts:188-393](packages/server/src/gateway/ws/chat.ts#L188-L393))：
- 如果外部未注入，自动创建 EventBus、StateManager、AgentRegistry
- 创建 3 个内置 Agent（code/test/doc）
- 订阅 `agent.event.task_started/completed/failed` 以广播 Agent 状态

---

## 3. 阶段二：前端用户操作

### 3.1 组件层级

```
App.tsx
 ├─ Sidebar.tsx          // 会话列表，创建/切换/删除会话
 └─ ChatArea.tsx         // 聊天核心控制器
      ├─ MessageList.tsx // 消息列表（用户消息 + AI 回复 + 工具调用卡片）
      └─ InputBar.tsx    // 消息输入框
```

### 3.2 用户发送消息的完整调用链

```
用户在 InputBar 中输入消息，按 Enter
 │
 ├─ InputBar.tsx: handleSend()
 │     └─ onSend(trimmedContent)
 │
 ▼
ChatArea.tsx: handleSend(content)
 │
 ├─ 1. dispatch({ type: "ADD_USER_MESSAGE", id, content })
 │     └─ chatStore.ts: chatReducer()
 │           └─ state.messages.push({ role: "user", content, isStreaming: false })
 │
 ├─ 2. dispatch({ type: "ADD_ASSISTANT_MESSAGE", id })
 │     └─ chatStore.ts: chatReducer()
 │           └─ state.messages.push({ role: "assistant", content: "", isStreaming: true })
 │
 └─ 3. send(content)
       └─ useWebSocket.ts: send()
             └─ ws.send(JSON.stringify({ type: "message", content }))
```

**关键代码位置**：
- [InputBar.tsx:47-54](packages/web/src/components/InputBar.tsx#L47-L54) — 用户输入处理
- [ChatArea.tsx:140-157](packages/web/src/components/ChatArea.tsx#L140-L157) — handleSend 三步骤
- [useWebSocket.ts:149-158](packages/web/src/hooks/useWebSocket.ts#L149-L158) — WebSocket 发送

### 3.3 WebSocket 连接建立

```
useWebSocket.ts: useEffect
 │
 ├─ 构建 URL: ws://host/api/sessions/{sessionId}/chat
 ├─ new WebSocket(wsUrl)
 ├─ socket.onopen  → setStatus("connected")
 └─ socket.onmessage → onMessageRef.current(msg)
       └─ ChatArea.tsx: onMessage(msg)
             └─ 根据 msg.type 分发 dispatch action
```

---

## 4. 阶段三：WebSocket 消息到达服务端

### 4.1 Fastify WebSocket 路由匹配

```
客户端发送: { type: "message", content: "帮我读取 package.json 并检查 git 状态" }
 │
 ▼
Fastify WebSocket 路由: /api/sessions/:id/chat
 │
 ├─ 解析 URL 参数 → sessionId
 ├─ 获取 db 实例 → SessionRepository
 │
 └─ socket.on("message", async (rawData) => {
       └─ chat.ts:292-372
```

### 4.2 消息处理入口

**文件**：[chat.ts:293-342](packages/server/src/gateway/ws/chat.ts#L293-L342)

```
socket.on("message", async (rawData) => {
  const msg = JSON.parse(rawData.toString())
  
  switch (msg.type) {
    case "message":
      // 1. 校验 content 非空
      // 2. 持久化用户消息 → repo.addMessage(sessionId, { role: "human", content })
      // 3. 等待 Agent 初始化完成 → await agentsReady
      // 4. 调用 streamOrchestrator(socket, ctx)  ← 核心流程
      // 5. 广播 Agent 状态 → broadcastAgentStatus()
      
    case "approval":
      // 工具审批：pendingApprovals.get(callId).resolve(approved)
  }
})
```

---

## 5. 阶段四：Orchestrator 状态机构建与执行

### 5.1 构建状态图

**入口**：[chat.ts:422-456](packages/server/src/gateway/ws/chat.ts#L422-L456) → `streamOrchestrator()`

```
streamOrchestrator(socket, ctx)
 │
 ├─ 动态导入: createOrchestratorGraph
 │     └─ orchestrator/graph.ts
 │
 ├─ 构建 onConfirmRequired 回调（工具审批）
 │     └─ 生成 callId → send confirm_required → Promise<boolean>
 │
 └─ graph.streamEvents({ messages: [new HumanMessage(content)] }, { version: "v2" })
```

### 5.2 LangGraph 状态图结构

**文件**：[orchestrator/graph.ts](packages/server/src/orchestrator/graph.ts)

```
const graph = new StateGraph(OrchestratorState)
  .addNode('planner', plannerNode)         // 任务分解
  .addNode('dispatcher', dispatcherNode)   // 任务派发（双通道）
  .addNode('replanner', replannerNode)     // 计划修正
  .addNode('finalizer', finalizerNode)     // 结果汇总
  
  .addEdge(START, 'planner')
  .addEdge('planner', 'dispatcher')
  
  // 条件路由
  .addConditionalEdges('dispatcher', state => state.nextAction, {
    continue:  'dispatcher',   // 还有任务 → 循环
    replan:    'replanner',    // 需要修正 → replanner → dispatcher
    finalize:  'finalizer',    // 全部完成 → 最终回复
  })
  
  .addEdge('replanner', 'dispatcher')
  .addEdge('finalizer', END)
```

### 5.3 OrchestratorState 定义

**文件**：[orchestrator/state.ts](packages/server/src/orchestrator/state.ts)

```
OrchestratorState:
  messages:        BaseMessage[]     // 追加模式 (reducer: concat)
  plan:            Plan              // 替换模式
  completedTasks:  Record<string, WorkerOutput>  // 合并模式
  pendingTasks:    SubTask[]         // 替换模式
  finalResponse:   string            // 替换模式
  nextAction:      'continue'|'replan'|'finalize'  // 替换模式
  replanSignal:    ReplanSignal|null // 替换模式
  artifacts:       Artifacts         // 合并模式
```

### 5.4 流式事件监听

```
for await (const event of graph.streamEvents(...)) {
  switch (event.event) {
    case "on_chat_model_stream":
      → send({ type: "text", delta })           // 流式文本 → 前端
      
    case "on_tool_start":
      → send({ type: "tool_start", tool, args }) // 工具开始 → 前端
      
    case "on_tool_end":
      → send({ type: "tool_end", tool, result }) // 工具结束 → 前端
      
    case "on_chain_end" (event.name === "finalizer"):
      → send({ type: "done", finalResponse })    // 完成 → 前端
      → repo.addMessage(sessionId, { role: "assistant", content: finalResponse })
      → generateTitle()                          // AI 自动生成标题
  }
}
```

---

## 6. 阶段五：Planner 节点 —— 任务分解

**文件**：[orchestrator/nodes/planner.ts](packages/server/src/orchestrator/nodes/planner.ts)

### 6.1 执行流程

```
plannerNode(state: { messages })
 │
 ├─ 1. 提取最后一条用户消息
 │     └─ const userRequest = state.messages.at(-1).content
 │
 ├─ 2. 构建 System Prompt
 │     └─ buildPlannerPrompt(availableAgents, availableTools)
 │           ├─ 列出可用 Agent 角色 (code/test/doc) 及其描述和工具
 │           └─ 列出所有可用工具 (11 个) 及其描述
 │
 ├─ 3. 调用 LLM 生成计划
 │     └─ model.invoke([SystemMessage(prompt), HumanMessage(userRequest)])
 │
 ├─ 4. 解析 LLM 返回的 JSON
 │     ├─ extractJsonObject() / extractJsonArray()
 │     ├─ JSON.parse()
 │     └─ validateSubTask() × N
 │
 └─ 5. 返回 { plan, pendingTasks }
```

### 6.2 Plan 数据结构

```typescript
// Planner 输出的 Plan 结构
{
  complexity: "simple" | "complex",
  tasks: [
    {
      id: "task-1",
      description: "读取 package.json 文件内容",
      tools: ["file_read"],
      dependsOn: [],
      routing: "direct",    // direct: 直接调用 Agent；bus: 通过 EventBus
      role: "code"           // 指定由哪个角色的 Agent 执行
    },
    {
      id: "task-2",
      description: "检查当前 git 仓库状态",
      tools: ["git_status"],
      dependsOn: [],
      routing: "direct",
      role: "code"
    }
  ],
  suggestedAgents: {
    "task-1": "code",
    "task-2": "code"
  }
}
```

### 6.3 复杂度判定规则

| 条件 | complexity | 默认 routing |
|------|-----------|-------------|
| 所有任务同一角色 | simple | direct |
| 只有一个任务 | simple | direct |
| 多角色参与 | complex | 根据任务而定 |
| 任务需要 Agent 间讨论 | complex | bus |

---

## 7. 阶段六：Dispatcher 节点 —— 双通道任务派发

**文件**：[orchestrator/nodes/dispatcher.ts](packages/server/src/orchestrator/nodes/dispatcher.ts)

### 7.1 执行流程

```
dispatcherNode(state: { pendingTasks, completedTasks })
 │
 ├─ 1. 检查 pendingTasks.length === 0?
 │     └─ 是 → nextAction = "finalize"
 │
 ├─ 2. 分类：ready vs waiting (按 dependsOn 解析依赖)
 │     ├─ 遍历 pendingTasks
 │     ├─ 检查每个 task.dependsOn 是否全部在 completedTasks 中
 │     ├─ 满足 → ready[]
 │     └─ 不满足 → waiting[]
 │
 ├─ 3. ready.length === 0 && waiting.length > 0?
 │     └─ 是 → nextAction = "continue" (循环等待)
 │
 ├─ 4. 按 routing 分两组
 │     ├─ directTasks  = ready.filter(t => t.routing === 'direct')
 │     ├─ busTasks     = ready.filter(t => t.routing === 'bus')
 │     └─ unmarkedTasks → 归入 directTasks (兼容旧格式)
 │
 ├─ 5. 并行执行两个通道
 │     ├─ executeDirectTasks(allDirectTasks)    // 通道 1
 │     └─ executeBusTasks(busTasks)             // 通道 2
 │
 ├─ 6. 合并结果到 newCompleted
 │     └─ newCompleted[result.taskId] = result
 │
 ├─ 7. 检测 replan 信号
 │     └─ detectReplanSignal(results)
 │           └─ 检查 error 中是否包含 "replan_needed"
 │
 └─ 8. 决定 nextAction
       ├─ replanSignal → "replan"
       ├─ waiting.length > 0 → "continue"
       └─ 否则 → "finalize"
```

### 7.2 Direct 通道（通道 1）

```
executeDirectTasks(tasks, completed, model, toolRegistry, ...)
 │
 └─ Promise.all(tasks.map(async (task) => {
      │
      ├─ 构建上下文: buildContext(task, completed)
      │     └─ 拼接依赖任务的执行结果
      │
      ├─ 优先使用 AgentRegistry:
      │     agent = agentRegistry.getAgent(task.role)  // 按角色查找 Agent
      │     if (agent) {
      │       output = await agent.executeTask({
      │         taskId: task.id,
      │         description: task.description,
      │         context: buildContext(task, completed)
      │       })
      │       return agentOutputToWorkerOutput(output)
      │     }
      │
      └─ 回退：WorkerAgent (兼容模式)
            worker = new WorkerAgent(model, toolRegistry, ...)
            return worker.run({ taskId, description, tools, context, workspacePath })
    }))
```

**关键点**：
- `agentRegistry.getAgent(task.role)` 优先返回 idle 状态的 Agent
- 如果 AgentRegistry 不可用，回退到创建临时 `WorkerAgent`

### 7.3 Bus 通道（通道 2）

```
executeBusTasks(tasks, completed, eventBus)
 │
 └─ Promise.all(tasks.map(async (task) => {
      │
      ├─ 检查 eventBus 是否可用
      │
      ├─ eventBus.request(`agent.command.${task.role}`, {
      │     type: 'subtask_assigned',
      │     taskId: task.id,
      │     description: task.description,
      │     context: buildContext(task, completed)
      │   }, 120_000)  // 2 分钟超时
      │
      └─ 解析 reply.payload
            ├─ status === 'success' → 返回结果
            ├─ status === 'replan_needed' → 标记失败
            └─ 其他 → 标记失败
    }))
```

**关键点**：
- Bus 通道通过 EventBus 发布 `agent.command.<role>` 消息
- Agent 启动时已订阅这些 topic，收到消息后自动领取执行
- `eventBus.request()` 是请求-响应模式，等待 Agent 处理完返回结果

---

## 8. 阶段七：Agent 执行任务

**文件**：[packages/core/src/agent/agent.ts](packages/core/src/agent/agent.ts)

### 8.1 Direct 路径：`agent.executeTask()`

Dispatcher 通过 `agentRegistry.getAgent(role)` 获取 Agent 后，直接调用：

```
agent.executeTask({
  taskId: string,
  description: string,
  context?: string,
  maxIterations?: number,
  timeoutMs?: number
})
 │
 ├─ 1. 更新状态为 busy
 │     ├─ this.status = 'busy'
 │     ├─ this.currentTaskId = taskId
 │     └─ stateManager.agents.update(id, { status: 'busy', currentTask: taskId })
 │
 ├─ 2. 构建 RuntimeContext
 │     ├─ 拼接 context + description
 │     └─ contextManager.build([new HumanMessage(messageText)])
 │
 ├─ 3. 获取受限工具集
 │     └─ this.getTools(onConfirmRequired)
 │           └─ toolRegistry.getToolsForAgent(capability, options, permissionRegistry)
 │
 ├─ 4. 委托给 ExecutionEngine
 │     └─ this.engine.run({
 │           agentId, taskId, agent: this,
 │           model, tools, systemPrompt: this.role.systemPrompt,
 │           context, capability: { maxIterations, timeoutMs }
 │         })
 │
 ├─ 5. 映射结果 → AgentOutput
 │     └─ this.mapResult(taskId, result)
 │
 └─ 6. 恢复状态为 idle
       ├─ this.status = 'idle'
       └─ stateManager.agents.update(id, { status: 'idle' })
```

### 8.2 Bus 路径：`agent.handleCommand()`

当 EventBus 上发布 `agent.command.<role>` 消息时：

```
eventBus.subscribe('agent.command.code', async (msg) => {
  if (this.status === 'busy') return  // 忙时不领取
  
  await this.handleCommand(msg)
})
 │
 ├─ 1. 标记 busy + 发布 task_started 事件
 │
 ├─ 2. 构建 RuntimeContext
 │
 ├─ 3. 委托给 ExecutionEngine.run()
 │
 ├─ 4. 发布 task_completed / task_failed / replan_needed 事件
 │
 └─ 5. 恢复 idle
```

### 8.3 Bus 请求-响应机制

Agent 的 `handleCommand` 执行完成后，发布事件到 EventBus。Dispatcher 侧的 `eventBus.request()` 等待 Agent 发布的 reply 事件，形成请求-响应闭环。

---

## 9. 阶段八：ExecutionEngine —— ReAct 推理循环

**文件**：[packages/core/src/harness/execution/engine.ts](packages/core/src/harness/execution/engine.ts)

### 9.1 ReAct 循环

```
ExecutionEngine.run(ctx: ExecutionContext)
 │
 ├─ 初始化: step = 0, toolHistory = [], reasoningTrail = []
 │
 └─ while (step < maxIterations) {
      │
      ├─ [超时检查] Date.now() - startTime > timeoutMs?
      │     └─ 是 → save checkpoint → return { status: 'timeout' }
      │
      ├─ [Save Checkpoint] checkpoint.save(taskId, { step, context, ... })
      │
      ├─ [Observe] 收集环境信息
      │     └─ observation = { context, events: [], lastToolResult }
      │
      ├─ [Think] 调用 LLM 推理
      │     └─ thought = await this.think(model, systemPrompt, observation)
      │           │
      │           ├─ 构建结构化 Prompt（包含 system prompt + 上下文 + 事件 + 上次工具结果）
      │           ├─ model.invoke([new HumanMessage(prompt)])
      │           └─ parseThought(response)
      │                 ├─ 尝试提取 JSON
      │                 └─ 解析 decision: use_tool | publish_event | request_agent | done | replan
      │
      ├─ reasoningTrail.push(thought)
      │
      ├─ [Act] 根据 decision 执行
      │     │
      │     ├─ use_tool:
      │     │     ├─ toolExec.execute(thought.toolCall)
      │     │     ├─ toolHistory.push({ call, result })
      │     │     └─ 追加工具结果到上下文
      │     │
      │     ├─ publish_event:
      │     │     └─ eventBus.publish(thought.event.topic, thought.event.payload)
      │     │
      │     ├─ request_agent:
      │     │     └─ eventBus.request(`agent.command.${thought.targetAgent}`, payload)
      │     │
      │     ├─ done:
      │     │     └─ return { status: 'success', result: thought.summary, toolCalls, reasoningTrail }
      │     │
      │     └─ replan:
      │           └─ return { status: 'replan_needed', result: thought.summary, reasoningTrail }
      │
      ├─ [Context Compress Check]
      │     └─ tokenCount > maxTokens * 0.8?
      │           └─ compressContext() → 保留最近 20 条消息，对更早消息生成摘要
      │
      └─ step++
    }
```

### 9.2 LLM 推理决策（Think 阶段）

```
think(model, systemPrompt, observation)
 │
 ├─ 构建 Prompt:
 │     ## Current State
 │     {contextSummary}
 │     {recentMessages (最近 10 条, 每条截断 300 字符)}
 │     
 │     ## Recent Events
 │     {events}
 │     
 │     ## Last Tool Result
 │     {lastToolResult}
 │     
 │     ## Instructions
 │     必须返回纯 JSON，包含 reasoning, decision, toolCall/event/summary
 │
 ├─ model.invoke([new HumanMessage(prompt)])
 │
 └─ parseThought(response)
       ├─ 提取 JSON (匹配 /{[\s\S]*}/)
       ├─ normalizeThought(parsed)
       └─ 容错：纯文本 → decision = 'done', summary = text
```

### 9.3 Decision 类型说明

| Decision | 触发条件 | 执行动作 |
|----------|---------|---------|
| `use_tool` | 需要调用工具获取信息或执行操作 | 执行 toolCall，记录结果 |
| `publish_event` | 需要通知其他 Agent | 发布事件到 EventBus |
| `request_agent` | 需要其他 Agent 帮助 | 通过 EventBus 请求其他 Agent |
| `done` | 任务完成 | 返回 success + summary |
| `replan` | 当前计划需要修正 | 返回 replan_needed + 原因 |

### 9.4 Checkpoint 与恢复

- **每步前保存**：`checkpoint.save(taskId, snapshot)` 在每轮 ReAct 循环开始前保存
- **超时前保存**：超时时也保存一次，方便 resume
- **恢复执行**：`engine.resume(taskId, model, tools, systemPrompt)` 加载 checkpoint 从断点继续

---

## 10. 阶段九：Finalizer 节点 —— 结果汇总

**文件**：[orchestrator/nodes/finalizer.ts](packages/server/src/orchestrator/nodes/finalizer.ts)

### 10.1 执行时机

当 Dispatcher 返回 `nextAction: 'finalize'` 时（所有 pendingTasks 已完成且无 waiting 任务），状态图路由到 Finalizer。

### 10.2 执行流程

```
finalizerNode(state: { messages, completedTasks, artifacts })
 │
 ├─ 1. 提取用户原始请求
 │     └─ messages.filter(m => m instanceof HumanMessage).at(-1)
 │
 ├─ 2. 构建结果摘要
 │     └─ buildResultsSummary(completedTasks)
 │           ├─ 遍历 completedTasks
 │           ├─ 按 success/failure 分类
 │           └─ 生成 Markdown 格式的任务状态列表
 │
 ├─ 3. 构建产物摘要
 │     └─ buildArtifactsSummary(artifacts)
 │           ├─ 文件变更列表
 │           ├─ Commit 记录
 │           └─ 测试结果
 │
 ├─ 4. 调用 LLM 生成最终回复
 │     └─ model.invoke([
 │           SystemMessage("You are a Result Finalizer..."),
 │           HumanMessage(`
 │             ## User's Original Request
 │             {userRequest}
 │             ## Subtask Results
 │             {resultsSummary}
 │             ## Artifacts Produced
 │             {artifactsSummary}
 │             Please provide a comprehensive final response...
 │           `)
 │         ])
 │
 └─ 5. 返回 { finalResponse }
```

---

## 11. 阶段十：流式推送与持久化

### 11.1 流式事件 → 前端

```
streamOrchestrator() 中的 for await 循环
 │
 ├─ on_chat_model_stream
 │     └─ send(socket, { type: "text", delta })
 │           └─ 前端 ChatArea: dispatch({ type: "APPEND_TEXT", delta })
 │                 └─ chatReducer: last.content += delta
 │
 ├─ on_tool_start
 │     └─ send(socket, { type: "tool_start", tool, args })
 │           └─ 前端: dispatch({ type: "TOOL_START", tool, args })
 │
 ├─ on_tool_end
 │     └─ send(socket, { type: "tool_end", tool, result })
 │           └─ 前端: dispatch({ type: "TOOL_END", tool, result })
 │
 ├─ on_chain_end (finalizer)
 │     ├─ send(socket, { type: "done", finalResponse })
 │     │     └─ 前端: dispatch({ type: "DONE", finalResponse })
 │     │           └─ chatReducer: last.isStreaming = false
 │     │
 │     ├─ repo.addMessage(sessionId, { role: "assistant", content: finalResponse })
 │     │     └─ SQLite 持久化
 │     │
 │     └─ generateTitle(model, firstHumanMessage)
 │           └─ send(socket, { type: "title_updated", title, sessionId })
 │
 └─ 错误处理
       └─ send(socket, { type: "error", message })
```

### 11.2 Replanner 分支（异常路径）

当 Dispatcher 检测到某个任务返回 `replan_needed` 时：

```
dispatcher → nextAction = "replan"
 │
 ▼
replannerNode(state: { plan, completedTasks, replanSignal })
 │
 ├─ 读取 replanSignal (sourceTaskId, reason, suggestion)
 ├─ 读取已完成任务摘要
 ├─ 提取未完成任务
 ├─ 调用 LLM 生成修正后的任务列表
 ├─ 验证新任务
 └─ 返回 { plan: revisedPlan, pendingTasks: newTasks, nextAction: "continue" }
      │
      └─ 路由回 dispatcher 重新派发
```

---

## 12. 调用链时序图

```
时间 ──────────────────────────────────────────────────────────────────────►

前端                          服务端 Gateway                  Orchestrator                  Core Agent
│                              │                              │                              │
│  ws.send({type:"message"})   │                              │                              │
│─────────────────────────────►│                              │                              │
│                              │                              │                              │
│                              │  persist user message (DB)   │                              │
│                              │─────────────────────────────►│                              │
│                              │                              │                              │
│                              │  streamOrchestrator()        │                              │
│                              │─────────────────────────────►│                              │
│                              │                              │                              │
│                              │                              │  [planner]                   │
│                              │                              │  LLM 调用 → 生成 Plan        │
│                              │  ◄── on_chat_model_stream ──│  (流式文本推送到前端)         │
│  ◄── {type:"text", delta}   │                              │                              │
│                              │                              │                              │
│                              │                              │  [dispatcher]                │
│                              │                              │  分类 ready/waiting          │
│                              │                              │                              │
│                              │                              │  executeDirectTasks()        │
│                              │                              │──────────────────────────────►│
│                              │                              │                              │  agentRegistry.getAgent(role)
│                              │                              │                              │  agent.executeTask({...})
│                              │                              │                              │
│                              │                              │                              │  [ExecutionEngine.run()]
│                              │                              │                              │
│                              │                              │                              │  while step < maxIterations:
│                              │                              │                              │    save checkpoint
│                              │                              │                              │    [Observe] collectEvents
│                              │                              │                              │    [Think] LLM invoke
│                              │  ◄── on_chat_model_stream ───│──────────────────────────────│  (LLM 流式输出)
│  ◄── {type:"text", delta}   │                              │                              │
│                              │                              │                              │    [Act] decision switch
│                              │                              │                              │
│                              │                              │                              │    case "use_tool":
│                              │  ◄── on_tool_start ─────────│──────────────────────────────│  tool.invoke(args)
│  ◄── {type:"tool_start"}    │                              │                              │
│                              │                              │                              │  tool result
│                              │  ◄── on_tool_end ───────────│──────────────────────────────│
│  ◄── {type:"tool_end"}      │                              │                              │
│                              │                              │                              │    (循环直到 done)
│                              │                              │                              │
│                              │                              │                              │    case "done":
│                              │                              │                              │    return {status:'success'}
│                              │                              │  ◄── AgentOutput ────────────│
│                              │                              │                              │
│                              │                              │  (所有 ready 任务完成)       │
│                              │                              │  nextAction = "finalize"     │
│                              │                              │                              │
│                              │                              │  [finalizer]                 │
│                              │                              │  LLM 汇总所有结果            │
│                              │  ◄── on_chat_model_stream ──│                              │
│  ◄── {type:"text", delta}   │                              │                              │
│                              │                              │                              │
│                              │  ◄── on_chain_end ──────────│                              │
│                              │  (event.name === "finalizer")│                              │
│                              │                              │                              │
│  ◄── {type:"done"}          │                              │                              │
│                              │                              │                              │
│                              │  persist assistant msg (DB)  │                              │
│                              │  generateTitle (AI)          │                              │
│  ◄── {type:"title_updated"} │                              │                              │
│                              │                              │                              │
│  ◄── {type:"agent_status"}  │  broadcastAgentStatus()      │                              │
│                              │                              │                              │
```

---

## 13. 关键文件索引

### 前端 (packages/web)

| 文件 | 职责 |
|------|------|
| [src/App.tsx](packages/web/src/App.tsx) | 根组件，管理 activeSessionId |
| [src/components/ChatArea.tsx](packages/web/src/components/ChatArea.tsx) | 聊天核心控制器，串联 WS/Store/子组件 |
| [src/components/InputBar.tsx](packages/web/src/components/InputBar.tsx) | 用户消息输入框 |
| [src/components/MessageList.tsx](packages/web/src/components/MessageList.tsx) | 消息列表渲染 |
| [src/components/ToolCallCard.tsx](packages/web/src/components/ToolCallCard.tsx) | 工具调用卡片渲染 |
| [src/components/AgentStatusCard.tsx](packages/web/src/components/AgentStatusCard.tsx) | Agent 状态卡片 |
| [src/stores/chatStore.ts](packages/web/src/stores/chatStore.ts) | 聊天状态管理 (useReducer) |
| [src/hooks/useWebSocket.ts](packages/web/src/hooks/useWebSocket.ts) | WebSocket 连接管理 |

### 服务端 Gateway (packages/server)

| 文件 | 职责 |
|------|------|
| [src/index.ts](packages/server/src/index.ts) | 服务启动入口，依赖注入 |
| [src/gateway/server.ts](packages/server/src/gateway/server.ts) | Fastify 实例工厂 |
| [src/gateway/ws/chat.ts](packages/server/src/gateway/ws/chat.ts) | WebSocket 聊天核心处理器 |
| [src/gateway/routes/sessions.ts](packages/server/src/gateway/routes/sessions.ts) | 会话 CRUD REST API |
| [src/gateway/routes/agents.ts](packages/server/src/gateway/routes/agents.ts) | Agent 状态查询 API |
| [src/gateway/routes/tools.ts](packages/server/src/gateway/routes/tools.ts) | 工具列表 API |
| [src/config.ts](packages/server/src/config.ts) | 环境变量配置加载 |

### Orchestrator (packages/server)

| 文件 | 职责 |
|------|------|
| [src/orchestrator/graph.ts](packages/server/src/orchestrator/graph.ts) | LangGraph 状态图构建 |
| [src/orchestrator/state.ts](packages/server/src/orchestrator/state.ts) | 状态图状态定义 |
| [src/orchestrator/types.ts](packages/server/src/orchestrator/types.ts) | SubTask/Plan/Action 类型 |
| [src/orchestrator/nodes/planner.ts](packages/server/src/orchestrator/nodes/planner.ts) | Planner 节点 (任务分解) |
| [src/orchestrator/nodes/dispatcher.ts](packages/server/src/orchestrator/nodes/dispatcher.ts) | Dispatcher 节点 (双通道派发) |
| [src/orchestrator/nodes/replanner.ts](packages/server/src/orchestrator/nodes/replanner.ts) | Replanner 节点 (计划修正) |
| [src/orchestrator/nodes/finalizer.ts](packages/server/src/orchestrator/nodes/finalizer.ts) | Finalizer 节点 (结果汇总) |

### Core 核心库 (packages/core)

| 文件 | 职责 |
|------|------|
| [src/index.ts](packages/core/src/index.ts) | 核心库统一入口 |
| [src/agent/agent.ts](packages/core/src/agent/agent.ts) | Agent 基类 (角色绑定/Bus订阅/状态上报) |
| [src/agent/registry.ts](packages/core/src/agent/registry.ts) | AgentRegistry (Agent 注册管理中心) |
| [src/agent/role.ts](packages/core/src/agent/role.ts) | AgentRole 定义 + 内置角色 (code/test/doc) |
| [src/agent/reasoning.ts](packages/core/src/agent/reasoning.ts) | ReasoningLoop (推理循环抽象) |
| [src/agent/worker.ts](packages/core/src/agent/worker.ts) | WorkerAgent (兼容层/回退路径) |
| [src/agent/types.ts](packages/core/src/agent/types.ts) | Agent 类型定义 |
| [src/harness/execution/engine.ts](packages/core/src/harness/execution/engine.ts) | ExecutionEngine (ReAct 循环引擎) |
| [src/harness/execution/checkpoint.ts](packages/core/src/harness/execution/checkpoint.ts) | Checkpoint 持久化 |
| [src/harness/context/manager.ts](packages/core/src/harness/context/manager.ts) | ContextManager (上下文管理) |
| [src/harness/sandbox/registry.ts](packages/core/src/harness/sandbox/registry.ts) | PermissionRegistry (权限注册) |
| [src/harness/sandbox/guard.ts](packages/core/src/harness/sandbox/guard.ts) | SandboxGuard (工具级拦截) |
| [src/harness/hooks/engine.ts](packages/core/src/harness/hooks/engine.ts) | HooksEngine (生命周期钩子) |
| [src/harness/memory/](packages/core/src/harness/memory/) | 三层记忆 (短期/长期/工作) |
| [src/event-bus/bus.ts](packages/core/src/event-bus/bus.ts) | InMemoryEventBus (多 Agent 通信) |
| [src/state/manager.ts](packages/core/src/state/manager.ts) | InMemoryStateManager (状态管理) |
| [src/tools/registry.ts](packages/core/src/tools/registry.ts) | ToolRegistry (工具注册与权限过滤) |
| [src/llm/factory.ts](packages/core/src/llm/factory.ts) | LLM 模型工厂 (createChatModel) |

---

## 附录：核心设计模式

### 双通道任务派发

```
                    ┌─────────────┐
                    │  Dispatcher  │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
         routing=direct            routing=bus
              │                         │
              ▼                         ▼
    ┌─────────────────┐      ┌─────────────────┐
    │ Direct 通道      │      │ Bus 通道         │
    │                  │      │                  │
    │ agentRegistry    │      │ eventBus         │
    │   .getAgent()    │      │   .request()     │
    │   .executeTask() │      │   (publish cmd)  │
    │                  │      │                  │
    │ 同步等待结果      │      │ 异步等待 reply   │
    └─────────────────┘      └─────────────────┘
```

### Agent 四层结构

```
┌──────────────────────────────────────┐
│  Role Layer (角色层)                  │
│  - AgentRole 定义身份/能力/订阅       │
│  - systemPrompt, defaultTools        │
├──────────────────────────────────────┤
│  Reasoning Layer (推理层)            │
│  - IReasoningLoop 接口               │
│  - DefaultReasoningLoop → Engine     │
├──────────────────────────────────────┤
│  Runtime Layer (运行时层)            │
│  - ExecutionEngine (ReAct Loop)     │
│  - CheckpointManager                 │
│  - MemoryManager (三层记忆)          │
├──────────────────────────────────────┤
│  Capability Layer (能力层)           │
│  - ToolRegistry                      │
│  - SandboxGuard                      │
│  - PermissionRegistry                │
└──────────────────────────────────────┘
```

### WebSocket 消息协议

**客户端 → 服务端**:

| type | 字段 | 说明 |
|------|------|------|
| `message` | `{ type: "message", content: string }` | 用户聊天消息 |
| `approval` | `{ type: "approval", callId: string, approved: boolean }` | 工具审批 |

**服务端 → 客户端**:

| type | 字段 | 说明 |
|------|------|------|
| `text` | `{ type: "text", delta: string }` | LLM 流式文本增量 |
| `tool_start` | `{ type: "tool_start", tool, args }` | 工具调用开始 |
| `tool_end` | `{ type: "tool_end", tool, result }` | 工具调用完成 |
| `confirm_required` | `{ type: "confirm_required", callId, tool, args }` | 请求用户审批 |
| `done` | `{ type: "done", finalResponse: string }` | 任务完成 |
| `error` | `{ type: "error", message: string }` | 错误通知 |
| `title_updated` | `{ type: "title_updated", title, sessionId }` | AI 生成标题 |
| `agent_status` | `{ type: "agent_status", agents: [...] }` | Agent 状态广播 |
