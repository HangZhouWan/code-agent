# Multi-Agent 架构改进设计

> 状态：待实现 | 日期：2026-07-15

## 概述

将现有的「单 Orchestrator → 隔离 WorkerAgent」层级模型升级为**角色分工型多 Agent 协作系统**，各 Agent 通过 Event Bus 互相发现、通信、协作，支持动态任务分配和中途恢复。

### 核心变化

| 维度 | 现有 | 改进后 |
|------|------|--------|
| Agent 通信 | 无（Worker 孤岛执行） | Event Bus（Command + Event 双通道） |
| Agent 模型 | 通用 WorkerAgent | 分角色 Agent（Code/Test/Doc...） |
| 任务分配 | Dispatcher Promise.all 并行派发 | 双通道：简单任务 direct 调用 / 复杂任务 Bus 发布 |
| 计划修正 | 无 | Replanner 节点 |
| 状态管理 | LangGraph 内部状态 | 独立 State Manager（Task/Workflow/Agent/Artifact） |
| 中断恢复 | 无 | Checkpoint Manager |
| 结果输出 | Summarizer | Finalizer（报告）+ Context Compressor（实时压缩） |

---

## 最终架构总览

```
                        User
                         │
                    Web Chat UI
                         │
                   API Gateway
                         │
┌─────────────────────────▼──────────────────────────┐
│                   Orchestrator                       │
│                                                      │
│  Planner ──→ Dispatcher ──→ Replanner               │
│                                                      │
│                   Finalizer                          │
└─────────────────────────┬──────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────┐
│                   State Manager                      │
│  Task State │ Workflow State │ Agent State │ Artifact│
└─────────────────────────┬──────────────────────────┘
                          │
┌─────────────────────────▼──────────────────────────┐
│                    Event Bus                         │
│  Command Topics: agent.command.*                     │
│  Event Topics:  agent.event.*                        │
└──────┬────────────────┬──────────────────┬──────────┘
       │                │                  │
┌──────▼──────┐  ┌──────▼──────┐  ┌───────▼──────┐
│  Code Agent │  │ Test Agent  │  │  Doc Agent   │ ...
│             │  │             │  │              │
│ Role        │  │ Role        │  │ Role         │
│ Reasoning   │  │ Reasoning   │  │ Reasoning    │
│ Runtime     │  │ Runtime     │  │ Runtime      │
│ Capability  │  │ Capability  │  │ Capability   │
└─────────────┘  └─────────────┘  └──────────────┘

┌─────────────────────────────────────────────────────┐
│                  Agent Runtime (横向)                 │
│                                                      │
│  Execution Engine ──→ Checkpoint Manager             │
│         │                                            │
│    Context Mgr ──→ Memory (short/long/working)       │
│         │                                            │
│    Tool Runtime                                      │
│         │                                            │
│     Permission                                       │
│         │                                            │
│       Hooks                                          │
└─────────────────────────────────────────────────────┘
```

---

## 第一层：Orchestrator

### Planner

输入用户消息 + 可用 Agent 列表，输出结构化 Plan（含复杂度判定）。

```typescript
interface Plan {
  complexity: 'simple' | 'complex';
  tasks: SubTask[];
  suggestedAgents: Record<string, string>; // taskId → agentRole
}

interface SubTask {
  id: string;
  description: string;
  tools: string[];
  dependsOn: string[];
  routing: 'direct' | 'bus';  // 决定 Dispatcher 路由
}
```

### Dispatcher

双通道：

- **direct**：简单任务，直接调用 `Agent.run()`
- **bus**：复杂任务，发布 `agent.command.*` 到 EventBus，Agent 按角色订阅领取

输出三路：

| nextAction | 触发条件 |
|------------|---------|
| `continue` | 还有等待中的任务 |
| `replan` | 有任务返回 `replan_needed` 信号 |
| `finalize` | 全部完成任务 |

### Replanner（新增）

当 Agent 执行中发现计划需要调整时介入：失败处理、新发现的依赖、产出冲突。

```
Replanner 输入 → 分析失败/冲突原因 → 修正 Plan → 回到 Dispatcher
```

### Finalizer（替代 Summarizer）

只做最终用户报告，不负责上下文压缩。上下文压缩归 Agent Runtime 的 ContextManager。

---

## 第二层：State Manager

```typescript
interface StateManager {
  task: TaskState;         // 所有任务的状态流转
  workflow: WorkflowState; // 当前 Plan、LangGraph 节点、决策历史
  agents: AgentState;      // 各 Agent idle/busy/error 状态
  artifacts: ArtifactState; // 产物：文件变更、commit、测试结果
}
```

**四个子状态的流转关系**：

```
Planner 写入 Task + Workflow
    ↓
Dispatcher 更新 Task (pending→assigned), 读取 Agent (找空闲)
    ↓
Agent 领取 command → Task (assigned→running), Agent (idle→busy)
    ↓
Agent 执行中 → Artifact 持续追加
    ↓
Agent 完成 → Task (running→completed), Agent (busy→idle)
    ↓
Replanner 读取 Task (failed), 修改 Workflow (plan)
    ↓
Finalizer 读取 Artifact + Workflow → 生成报告
```

边界：State Manager = 外部世界状态（what happened），Agent Runtime = Agent 内部运行状态（how agent thinks）。

---

## 第三层：Event Bus

```typescript
interface EventBus {
  publish(topic, payload): Promise<void>;        // fire-and-forget
  request(topic, payload, timeoutMs?): Promise<BusMessage>;  // 等待回复
  subscribe(topic, handler): () => void;         // 精确匹配
  subscribePattern(pattern, handler): () => void; // 通配匹配
  reply(inReplyTo, payload): Promise<void>;      // 回复消息
}
```

两套 Topic：

- **Command** (`agent.command.*`)：指令 = "请做某事"，期待响应
- **Event** (`agent.event.*`)：事实 = "某事已发生"，广播通知

---

## 第四层：Agent

每个 Agent 内部四层结构：

```typescript
interface Agent {
  role: AgentRole;             // 角色定义 + system prompt + 订阅主题
  reasoning: ReasoningLoop;    // Observe → Think → Act → Reflect
  runtime: AgentRuntimeProxy;  // 统一记账（tool/bus/checkpoint）
  capability: AgentCapability; // 工具 + 路径 + 代理权限
}
```

协作示例：

```
Code Agent 改完代码 → publish agent.event.code_changed
Test Agent 订阅 code_changed → 自动跑测试
测试失败 → publish agent.event.test_failed
Code Agent 收到 → 自动修复
```

---

## 第五层：Agent Runtime

```
Execution Engine ──→ Checkpoint Manager
       │
  Context Mgr ──→ Memory (short/long/working)
       │
  Tool Runtime ──→ Permission ──→ Hooks
```

**Execution Engine**：驱动 ReAct 循环（Observe → Think → Act → Reflect），是 Agent 执行的引擎。

**Checkpoint Manager**：每 Step 执行前自动保存（taskId + step 序号 + 完整 context + tool 历史），支持 `resume(taskId)` 恢复中断的执行。

**Context Manager**：构建 Agent 上下文 + 实时压缩（token 超阈值时自动触发），与 Finalizer 明确分离。

**Memory**：
- ShortTerm：单 Agent 当前对话（内存）
- LongTerm：跨会话知识（SQLite + 可选 embedding）
- Working：当前 task 内所有 Agent 共享的"白板"

---

## Storage 层

| 存储 | 位置 | 内容 |
|------|------|------|
| State DB | SQLite（扩表） | tasks、artifacts |
| Memory DB | SQLite + 向量（可选） | long_term_entries |
| Checkpoint Store | 文件系统（`~/.code-agent/checkpoints/`） | {taskId}.json |
| Event Store | SQLite（可选） | 审计事件 |

---

## 分步实施计划

每个 Step 独立可验证，不破坏现有系统：

| Step | 内容 | 新增 | 修改 | 验证方式 |
|------|------|------|------|---------|
| 1 | EventBus + StateManager | 4 | 1 | pub/sub + 状态机单测 |
| 2 | ExecutionEngine + Checkpoint + Memory | 4 | 2 | checkpoint 恢复验证 |
| 3 | Agent 基类 + AgentRegistry | 4 | 2 | 单 Agent 任务不变 |
| 4 | Orchestrator 改造 | 2 | 4 | direct 路由不改 |
| 5 | 角色 Agent + Storage + 集成 | 6 | 4 | 端到端多 Agent 协作 |

---

## 详细计划索引

- [Step 1 — EventBus + StateManager](2026-07-15-step1-event-bus-state-manager.md)
- [Step 2 — ExecutionEngine + Checkpoint + Memory](2026-07-15-step2-runtime-upgrade.md)
- [Step 3 — Agent 基类 + AgentRegistry](2026-07-15-step3-agent-base-class.md)
- [Step 4 — Orchestrator 改造](2026-07-15-step4-orchestrator-refactor.md)
- [Step 5 — 角色 Agent + Storage + 集成](2026-07-15-step5-role-agents-integration.md)
