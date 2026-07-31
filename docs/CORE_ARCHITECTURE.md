# @my-agent/core —— 核心库架构解析

## 目录

1. [概述](#1-概述)
2. [整体架构图](#2-整体架构图)
3. [模块详解](#3-模块详解)
   - [3.1 LLM 抽象层](#31-llm-抽象层)
   - [3.2 工具层](#32-工具层)
   - [3.3 沙箱与权限](#33-沙箱与权限)
   - [3.4 Hooks 引擎](#34-hooks-引擎)
   - [3.5 上下文管理](#35-上下文管理)
   - [3.6 记忆体系](#36-记忆体系)
   - [3.7 Checkpoint 快照](#37-checkpoint-快照)
   - [3.8 EventBus 通信总线](#38-eventbus-通信总线)
   - [3.9 StateManager 状态管理](#39-statemanager-状态管理)
   - [3.10 ExecutionEngine 执行引擎](#310-executionengine-执行引擎)
   - [3.11 Agent 基类与角色系统](#311-agent-基类与角色系统)
   - [3.12 AgentRegistry 注册中心](#312-agentregistry-注册中心)
   - [3.13 WorkerAgent 兼容层](#313-workeragent-兼容层)
4. [任务执行全流程](#4-任务执行全流程)
5. [与其他包的集成](#5-与其他包的集成)

---

## 1. 概述

`@my-agent/core` 是整个 my-agent 项目的**核心引擎库**。它提供了一套完整的 AI Agent 运行时框架，包括：

- **多 Provider LLM 调用**：统一 OpenAI / Anthropic / OpenAI-Compatible 的调用接口
- **工具系统**：内置文件、Shell、Git、搜索、Web 等工具，支持自定义扩展
- **ReAct 执行引擎**：驱动 Agent 的「观察 → 思考 → 行动 → 反思」推理循环
- **多 Agent 协作**：EventBus 消息总线 + StateManager 状态管理 + Agent 角色分工
- **安全沙箱**：权限注册表 + 命令白名单 + 路径约束 + 高危模式检测
- **记忆体系**：短期记忆 / 长期记忆 / 工作记忆三层结构
- **中断恢复**：Checkpoint 快照持久化，支持从断点继续执行
- **Hook 插件**：生命周期事件 + 内置日志/敏感信息过滤

这个库本身**不包含任何网络服务或 UI**——它是一个纯逻辑库，被 `packages/server` 和 `packages/web` 共同依赖。

---

## 2. 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           @my-agent/core                                     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                     AgentRegistry (注册中心)                              ││
│  │   创建、启动、查询、关闭 Agent 实例                                       ││
│  └────────────────────────────────┬────────────────────────────────────────┘│
│                                   │                                          │
│  ┌────────────────────────────────▼────────────────────────────────────────┐│
│  │                      Agent 基类 (核心抽象)                               ││
│  │   四层结构：Role → Reasoning → Runtime → Capability                      ││
│  │   ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  ││
│  │   │  Role    │  │  Reasoning   │  │   Runtime    │  │  Capability    │  ││
│  │   │ 身份/能力 │→│ 推理循环     │→│  执行引擎    │→│  工具集/路径   │  ││
│  │   │ system   │  │ ReAct Loop   │  │  Engine +    │  │  ToolRegistry  │  ││
│  │   │ prompt   │  │              │  │  Sandbox     │  │  + Paths       │  ││
│  │   └──────────┘  └──────────────┘  └──────────────┘  └────────────────┘  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         基础设施层                                       ││
│  │                                                                          ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   ││
│  │  │  EventBus    │  │ StateManager │  │   Memory     │                   ││
│  │  │  消息总线    │  │  状态管理    │  │  记忆体系    │                   ││
│  │  │  pub/sub     │  │  Task/Agent  │  │  Short/Long/ │                   ││
│  │  │  req/reply   │  │  /Artifact/  │  │  Working     │                   ││
│  │  │              │  │  Workflow    │  │              │                   ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘                   ││
│  │                                                                          ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   ││
│  │  │  Checkpoint  │  │   Context    │  │   Sandbox    │                   ││
│  │  │  执行快照    │  │  上下文管理  │  │  沙箱守卫    │                   ││
│  │  │  持久化/恢复 │  │  消息历史    │  │  权限/路径   │                   ││
│  │  │              │  │  Token压缩   │  │  安全校验    │                   ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘                   ││
│  │                                                                          ││
│  │  ┌──────────────┐  ┌──────────────┐                                     ││
│  │  │    Hooks     │  │  Execution   │                                     ││
│  │  │  生命周期    │  │   Engine     │                                     ││
│  │  │  事件驱动    │  │  ReAct 循环  │                                     ││
│  │  │              │  │              │                                     ││
│  │  └──────────────┘  └──────────────┘                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         底层能力                                         ││
│  │                                                                          ││
│  │  ┌──────────────┐  ┌──────────────────────────────────────────────────┐ ││
│  │  │  LLM 抽象层  │  │              工具层 (Tools)                      │ ││
│  │  │              │  │  ┌────────┐┌────────┐┌────────┐┌──────┐┌──────┐ │ ││
│  │  │  Provider    │  │  │ File   ││ Shell  ││  Git   ││Search││ Web  │ │ ││
│  │  │  工厂        │  │  │ 读写   ││ 执行   ││ 版本   ││代码  ││ 请求 │ │ ││
│  │  │  协议检测    │  │  │        ││        ││ 控制   ││搜索  ││      │ │ ││
│  │  │  重试机制    │  │  └────────┘└────────┘└────────┘└──────┘└──────┘ │ ││
│  │  │              │  │  ToolRegistry + createLangChainTool              │ ││
│  │  └──────────────┘  └──────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 模块详解

### 3.1 LLM 抽象层

**位置**: `src/llm/`

**职责**: 对不同 LLM Provider 提供统一调用接口。

```
src/llm/
├── types.ts      # 核心类型（ModelConfig, UnifiedResponse, StreamChunk 等）
├── factory.ts    # createChatModel() —— 根据配置创建 LangChain ChatModel 实例
├── protocol.ts   # detectProtocol() —— HTTP 探测 API 协议类型
└── retry.ts      # withRetry() —— 指数退避重试 + fetchWithRetry()
```

**设计思路**：

- **Provider 三元模型**：`openai` | `anthropic` | `openai-compatible`，覆盖 OpenAI 官方、Anthropic 官方和本地 Ollama/LM Studio/vLLM 等兼容端点
- **工厂模式**：`createChatModel(config)` 返回 LangChain 的 `BaseChatModel`，调用方不感知底层差异
- **协议自动检测**：`detectProtocol(baseURL)` 通过 HTTP 探测 `/v1/models` 端点，自动判断远端协议类型
- **重试机制**：指数退避 + 随机抖动，区分 429（限流）/ 5xx（服务端错误）可重试 vs 4xx（客户端错误）不重试
- **直接复用 LangChain**：不做额外包装层，直接使用 `@langchain/openai` 和 `@langchain/anthropic`

**关键类型**：

```typescript
// ModelConfig: 创建模型的完整参数
interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible';
  model: string;          // 模型名称如 'gpt-4o', 'claude-opus-4-6'
  apiKey: string;
  baseURL?: string;       // 自定义端点
  maxRetries?: number;
  temperature?: number;
}

// UnifiedResponse: 统一响应（屏蔽不同 Provider 的差异）
interface UnifiedResponse {
  role: 'assistant' | 'tool';
  content: string | null;
  toolCalls: ToolCall[];
}
```

---

### 3.2 工具层

**位置**: `src/tools/`

**职责**: 定义、注册和分发给 Agent 使用的工具集合。

```
src/tools/
├── index.ts      # 统一导出
├── base.ts       # ToolDefinition 接口 + createLangChainTool 适配器
├── registry.ts   # ToolRegistry —— 工具的注册和按需分发
├── file.ts       # file_read, file_write, file_list
├── shell.ts      # shell_exec（命令白名单 + 超时控制）
├── git.ts        # git_status, git_diff, git_log, git_commit, git_branch
├── search.ts     # code_search（基于 grep）
└── web.ts        # web_fetch（GET 请求，文本/JSON 内容）
```

**设计核心**：

- **Zod Schema 驱动**：每个工具用 Zod 定义输入 schema，自动获得类型推断和运行时校验
- **权限标签**：每个工具声明 `permission: 'safe' | 'confirm'`，供 SandboxGuard 使用
- **LangChain 适配**：`createLangChainTool()` 将内部的 `ToolDefinition` 包装为 LangChain 的 `StructuredTool`
- **ToolRegistry**：根据 Agent 的 `capability.tools[]` 过滤和分发工具，可选挂载 SandboxGuard 进行权限拦截

**工具清单**：

| 工具名 | 权限 | 描述 |
|--------|------|------|
| `file_read` | safe | 读取文件内容（UTF-8） |
| `file_write` | confirm | 写入文件，自动创建父目录 |
| `file_list` | safe | 列出目录内容 |
| `shell_exec` | confirm | 执行命令（白名单限制） |
| `git_status` | safe | 查看 Git 工作区状态 |
| `git_diff` | safe | 查看差异对比 |
| `git_log` | safe | 查看提交日志 |
| `git_commit` | confirm | 创建提交 |
| `git_branch` | confirm | 列出/创建分支 |
| `code_search` | safe | 正则搜索代码 |
| `web_fetch` | safe | HTTP GET 获取内容 |

**安全机制（Shell）**：
- 命令白名单：`ls`, `cat`, `grep`, `git`, `npm`, `node` 等 23 个安全命令
- 30 秒超时 + 10MB 输出缓冲

**安全机制（File）**：
- `resolvePath()` 确保所有路径解析后在 `workspacePath` 内
- 路径穿越检测：拒绝 `../` 等尝试访问工作区外的路径

---

### 3.3 沙箱与权限

**位置**: `src/harness/sandbox/`

**职责**: 在工具执行前进行多层安全拦截。

```
src/harness/sandbox/
├── types.ts      # PermissionResult, ToolPermission, ConfirmRequiredError
├── registry.ts   # PermissionRegistry —— 工具权限策略的注册和查询
└── guard.ts      # SandboxGuard —— LangChain Callback 拦截 + 安全校验链
```

**六层安全校验链**（按优先级执行）：

```
1. Agent Capability 检查  → 工具是否在 Agent 声明的 tools[] 中？
2. 权限注册表查询         → 工具是否在 PermissionRegistry 中注册？
3. Shell 高危模式检测     → 命令是否匹配 DENY_PATTERNS？（仅 shell_exec）
4. 路径约束               → 参数中的 path 是否在 Agent 的 paths[] 前缀内？
5. 路径穿越检测           → 参数是否包含 ".." 片段？
6. 自定义参数校验         → ToolPermission.validateArgs()
```

**高危命令黑名单**（匹配任一即 deny）：
- `rm`、`sudo`、`chmod 777`、`chown`、`dd if=`
- `mkfs.`、`> /dev/...`
- `curl ... | sh/bash`、`wget ... | sh/bash`

**PermissionRegistry 内置配置**：
- **safe**（静默放行）：`file_read`, `file_list`, `code_search`, `git_status`, `git_diff`, `git_log`, `web_fetch`
- **confirm**（需确认）：`file_write`, `shell_exec`, `git_commit`, `git_branch`

---

### 3.4 Hooks 引擎

**位置**: `src/harness/hooks/`

**职责**: 事件驱动的插件机制，允许在 Agent 生命周期关键节点注入自定义逻辑。

```
src/harness/hooks/
├── types.ts             # HookEvent, HookContext, HookResult, HookHandler
├── engine.ts            # HooksEngine —— handler 注册/移除/触发
└── builtins/
    ├── logger.ts        # 日志记录 Hook
    └── secret-filter.ts # 敏感信息过滤 Hook
```

**7 个生命周期事件**：

```
agent:start ──→ message:send ──→ tool:before ──→ tool:after ──→ message:receive ──→ agent:end
                                                                                    ──→ agent:error
```

**HooksEngine 核心特性**：
- 同一事件可注册多个 handler，按注册顺序依次执行
- 单个 handler 异常不影响其他 handler（容错隔离）
- 多个 handler 的 `modifiedArgs` / `modifiedResult` 浅合并
- 任一 handler 返回 `skip: true` → 整体 skip = true

**内置 Hooks**：
- **LoggerHook**：`[ISO时间戳] [事件名] agent=xxx` 格式日志
- **SecretFilterHook**：过滤 API Key、Token、私钥等敏感信息
  - PEM 私钥块匹配（`-----BEGIN ... PRIVATE KEY-----`）
  - 敏感键名匹配（`api_key`, `token`, `secret`, `password` 等）
  - `tool:before` 过滤参数，`tool:after` 过滤结果

---

### 3.5 上下文管理

**位置**: `src/harness/context/`

**职责**: 管理 Agent 会话的完整上下文生命周期（消息历史 + Token 预算 + 自动压缩）。

```
src/harness/context/
├── types.ts       # ContextWindow, AgentContext, RuntimeContext
├── manager.ts     # ContextManager —— 上下文创建/追加/继承/销毁
└── compressor.ts  # compressMessages() —— 消息历史压缩为摘要
```

**两个层级**：

| 类型 | 用途 | 特点 |
|------|------|------|
| `AgentContext` | 完整 Agent 会话上下文 | 包含 sessionId、Window 配置、摘要 |
| `RuntimeContext` | ExecutionEngine 运行时上下文 | 轻量级，仅包含 messages + tokenCount + summary |

**Token 预算管理**：
- 默认最大 128000 tokens
- 压缩阈值 0.8（使用 80% 后触发自动压缩）
- 估算算法：`字符数 / 4`（简单估算，后续可替换 tiktoken）

**上下文压缩策略**：
- 保留最近 20 条消息完整内容
- 对更早的消息生成摘要（当前为简单截断，预留 LLM 摘要接口）
- 摘要注入到 `summary` 字段，在后续 LLM 调用时作为 System Prompt 前缀

**子 Agent 上下文继承**：
- `inheritForSubAgent()` 创建子 Agent 的上下文
- 子 Agent 继承父 Agent 的 sessionId 和摘要
- 子 Agent 不继承完整消息历史，拥有独立的 token 预算

---

### 3.6 记忆体系

**位置**: `src/harness/memory/`

**职责**: 三层记忆结构，覆盖不同时间尺度的信息存储。

```
src/harness/memory/
├── types.ts       # ShortTermMemory, LongTermMemory, WorkingMemory 接口
├── short-term.ts  # InMemoryShortTermMemory —— 循环数组（最多 200 条）
├── long-term.ts   # FileLongTermMemory —— JSON 文件持久化 + 关键词搜索
└── working.ts     # InMemoryWorkingMemory —— 共享白板（Map）
```

```
┌─────────────────────────────────────────────────────────────┐
│                     三层记忆体系                             │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Working Memory (工作记忆)                            │   │
│  │  当前 task 跨 Agent 共享的键值 "白板"                 │   │
│  │  task 结束即清理，无持久化                             │   │
│  │  例："当前项目语言" → "TypeScript"                    │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↕                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Short-Term Memory (短期记忆)                         │   │
│  │  单 Agent 当前对话上下文                               │   │
│  │  内存循环数组，最多 200 条消息                         │   │
│  │  超出上限自动淘汰最早的消息                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↕                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Long-Term Memory (长期记忆)                          │   │
│  │  跨会话知识存储，JSON 文件持久化                       │   │
│  │  关键词匹配搜索（预留 embedding 接口）                │   │
│  │  例：用户偏好、项目架构决策                            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Working Memory**：Agent 间通过 EventBus 协调访问，适用于共享中间结果。

**Long-Term Memory 搜索**：对 query 进行分词（按空格/标点拆分），遍历所有记忆计算关键词匹配分数，按分数降序返回 topK 结果。后续可替换为 `jieba` 分词 + 向量数据库。

---

### 3.7 Checkpoint 快照

**位置**: `src/harness/execution/checkpoint.ts`

**职责**: Agent 执行快照的持久化和恢复，支持中断恢复。

**核心接口**：

```typescript
interface ICheckpointManager {
  save(taskId: string, snapshot: Omit<CheckpointSnapshot, 'createdAt'>): Promise<void>;
  load(taskId: string): Promise<CheckpointSnapshot | null>;
  list(taskId: string): Promise<Array<{ step: number; createdAt: Date }>>;
  purge(taskId: string): Promise<void>;
  cleanup(olderThan: Date): Promise<void>;
}
```

**CheckpointSnapshot 包含**：
- `taskId` / `agentId`：任务和 Agent 标识
- `step`：当前执行步数
- `context`：RuntimeContext（消息历史 + token 计数 + 摘要）
- `toolHistory`：已完成的所有工具调用记录
- `reasoningTrail`：已完成的所有推理决策记录

**实现**：`FileCheckpointManager` —— 每个 task 一个 JSON 文件（`{basePath}/{taskId}.json`），每次 save 覆盖写入。

**恢复流程**：`ExecutionEngine.resume(taskId, ...)` → 加载 checkpoint → 从断点 step 继续 ReAct 循环。

---

### 3.8 EventBus 通信总线

**位置**: `src/event-bus/`

**职责**: 多 Agent 协作系统的消息中枢，提供四种通信模式。

```
src/event-bus/
├── types.ts   # BusMessage, IEventBus, CommandTopic/EventTopic
└── bus.ts     # InMemoryEventBus 实现
```

**四种通信模式**：

| 模式 | 方法 | 描述 |
|------|------|------|
| **发布/订阅（fire-and-forget）** | `publish(topic, payload)` | 广播给所有匹配订阅者 |
| **精确匹配订阅** | `subscribe(topic, handler)` | 订阅特定 topic |
| **通配符订阅** | `subscribePattern(pattern, handler)` | glob 模式匹配（`*` 单段，`**` 任意段） |
| **请求/响应** | `request(topic, payload, timeout?)` + `reply(inReplyTo, payload)` | 命令-响应模式，超时抛异常 |

**Topic 约定**：
- `agent.command.<动作>` —— Command 主题（如 `agent.command.run_tests`）
- `agent.event.<事件>` —— Event 主题（如 `agent.event.code_changed`）

**Glob 通配符示例**：
- `agent.event.*` → 匹配 `agent.event.code_changed`、`agent.event.test_passed`
- `agent.**.changed` → 匹配任意层级的 `.changed` 结尾 topic

**设计特性**：
- 错误隔离：单个 handler 异常不影响其他订阅者
- 超时控制：`request()` 默认 30 秒超时
- 当前为内存实现，后续可替换为 Redis / RabbitMQ

---

### 3.9 StateManager 状态管理

**位置**: `src/state/`

**职责**: 统一管理多 Agent 系统的四维状态。

```
src/state/
├── types.ts     # TaskState, WorkflowState, AgentState, ArtifactState 接口
└── manager.ts   # InMemoryStateManager 实现
```

**四个子状态模块**：

```
┌────────────────────────────────────────────────────────┐
│                  IStateManager                          │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐                     │
│  │  TaskState  │  │ WorkflowState│                     │
│  │             │  │              │                     │
│  │ 任务生命周期 │  │  工作流位置  │                     │
│  │ 状态机校验  │  │  计划/决策   │                     │
│  │ onChange    │  │              │                     │
│  └─────────────┘  └──────────────┘                     │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐                     │
│  │ AgentState  │  │ArtifactState │                     │
│  │             │  │              │                     │
│  │ Agent状态   │  │  产物追踪    │                     │
│  │ 心跳检测   │  │  files       │                     │
│  │ 空闲查找   │  │  commits     │                     │
│  │             │  │  tests       │                     │
│  └─────────────┘  └──────────────┘                     │
└────────────────────────────────────────────────────────┘
```

**Task 状态机**：

```
                    ┌──────────┐
                    │ pending  │
                    └────┬─────┘
                         │
                    ┌────▼─────┐
               ┌───→│ assigned │
               │    └────┬─────┘
               │         │
          ┌────┴────┐    │    ┌────────────────┐
          │cancelled│    │    │ awaiting_input │
          └─────────┘    │    └───────┬────────┘
                         │            │
                    ┌────▼────┐       │
                    │ running │←──────┘
                    └──┬──┬──┘
                       │  │
              ┌────────┘  └────────┐
              │                    │
         ┌────▼────┐         ┌────▼────┐
         │completed│         │  failed │──→ pending (可被 Replanner 重置)
         └─────────┘         └─────────┘
```

**EventBus 集成**：传入 `eventBus` 后，task 状态变更自动发 `agent.event.task_status_changed` 事件。

---

### 3.10 ExecutionEngine 执行引擎

**位置**: `src/harness/execution/engine.ts`

**职责**: 驱动 Agent 的 ReAct 推理循环，是 Agent 执行的「心脏」。

**ReAct 循环流程**：

```
                    开始
                     │
                     ▼
              ┌──────────────┐
        ┌────→│  Save Checkpoint  │  每步前保存快照
        │     └──────┬───────┘
        │            ▼
        │     ┌──────────────┐
        │     │   Observe    │  收集当前上下文 + 最近事件 + 上次工具结果
        │     └──────┬───────┘
        │            ▼
        │     ┌──────────────┐
        │     │   Think      │  LLM 调用 → 返回 JSON 决策
        │     └──────┬───────┘
        │            ▼
        │     ┌──────────────┐
        │     │    Act       │  根据 decision 分支执行：
        │     │              │  ┌─ use_tool      → 执行工具
        │     │              │  ├─ publish_event → 发布 EventBus 事件
        │     │              │  ├─ request_agent → 向其他 Agent 发请求
        │     │              │  ├─ done          → 成功结束
        │     │              │  └─ replan        → 需要重新规划
        │     └──────┬───────┘
        │            ▼
        │     ┌──────────────┐
        │     │   Reflect    │  追加工具结果到上下文，更新记忆
        │     └──────┬───────┘
        │            │
        │            ▼
        │     ┌──────────────┐
        │     │ Token Check  │  超 80% 阈值 → 上下文压缩
        │     └──────┬───────┘
        │            │
        │     step < maxIterations?
        │            │
        └────────yes─┘
                     │ no → timeout
                     ▼
                   结束
```

**5 种决策类型**：

| Decision | 含义 | 触发条件 |
|----------|------|----------|
| `use_tool` | 调用工具 | 需要执行某个操作 |
| `publish_event` | 发事件 | 通知其他 Agent |
| `request_agent` | 请求其他 Agent | 需要其他 Agent 的帮助 |
| `done` | 任务完成 | 任务已完成 |
| `replan` | 重新规划 | 计划需要调整 |

**Think 阶段的 Prompt 结构**：

```
{systemPrompt}

## Current State
{contextSummary + recentMessages}

## Recent Events
{事件列表}

## Last Tool Result
{上次工具执行结果}

## Instructions
必须返回纯 JSON（无 markdown 包裹）：
{
  "reasoning": "...",
  "decision": "use_tool | publish_event | request_agent | done | replan",
  "toolCall": { "name": "...", "args": {...} },
  ...
}
```

**超时控制**：每步检查 `Date.now() - startTime > timeoutMs`，超时前自动保存 checkpoint。

**LLM 容错**：纯文本响应或 JSON 解析失败时，默认视为 `done`。

---

### 3.11 Agent 基类与角色系统

**位置**: `src/agent/`

```
src/agent/
├── types.ts        # AgentConfig, AgentInput, AgentOutput, WorkerInput/Output
├── role.ts         # AgentRole 接口 + BUILTIN_ROLES 预置
├── agent.ts        # Agent 基类 —— 核心抽象
├── registry.ts     # AgentRegistry —— Agent 生命周期管理中心
├── reasoning.ts    # IReasoningLoop 接口 + DefaultReasoningLoop
├── worker.ts       # WorkerAgent 兼容层
├── index.ts        # 导出
└── roles/
    ├── code.ts     # CODE_AGENT_ROLE
    ├── test.ts     # TEST_AGENT_ROLE
    └── doc.ts      # DOC_AGENT_ROLE
```

#### Agent 基类的四层结构

```
┌─────────────────────────────────────────────────────┐
│                   Agent 基类                         │
│                                                      │
│  Layer 1: Role                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │ 身份定义、System Prompt、Command/Event 订阅、  │   │
│  │ 默认工具列表、委托权限                         │   │
│  └──────────────────────────────────────────────┘   │
│                      ↓                               │
│  Layer 2: Reasoning                                  │
│  ┌──────────────────────────────────────────────┐   │
│  │ IReasoningLoop 接口（当前委托 ExecutionEngine）│   │
│  │ 预留：Chain-of-Thought / Tree-of-Thought 等    │   │
│  └──────────────────────────────────────────────┘   │
│                      ↓                               │
│  Layer 3: Runtime                                    │
│  ┌──────────────────────────────────────────────┐   │
│  │ ExecutionEngine + SandboxGuard + HooksEngine  │   │
│  │ + ContextManager + MemoryManager              │   │
│  └──────────────────────────────────────────────┘   │
│                      ↓                               │
│  Layer 4: Capability                                 │
│  ┌──────────────────────────────────────────────┐   │
│  │ 允许的工具集 + 允许的路径 + Token/时间限制    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Agent 生命周期**：

```
new Agent(config)
       │
       ▼
  agent.start()
       │
       ├─→ 1. 向 StateManager 注册自身
       ├─→ 2. 订阅 Command 主题（领取任务）
       ├─→ 3. 订阅 Event 主题（观察环境）
       └─→ 4. 启动心跳定时器（每 5 秒）
       
       ... 运行中：被 EventBus 驱动 handleCommand() ...
       
       ▼
  agent.stop()
       │
       ├─→ 1. 取消所有 Bus 订阅
       ├─→ 2. 清除心跳定时器
       └─→ 3. 标记为 offline
```

**两种执行路径**：

1. **EventBus 路径**：Command 消息到达 → `handleCommand()` → 执行 → 发布结果事件
2. **Direct 路径**：`agent.executeTask(input)` → 直接执行 → 返回 AgentOutput

**三个预置角色**：

| 角色 | ID | 订阅的 Command | 默认工具 | 可委托 |
|------|-----|---------------|---------|--------|
| **Code Agent** | code | `code_review`, `code_modify`, `code_generate` | file_read, file_write, code_search, shell, git | ✅ → test, doc |
| **Test Agent** | test | `test_run`, `test_write` | shell, file_read, file_write, code_search | ❌ |
| **Doc Agent** | doc | `doc_generate`, `doc_update` | file_read, file_write, code_search | ❌ |

---

### 3.12 AgentRegistry 注册中心

**位置**: `src/agent/registry.ts`

**职责**: 统一管理所有 Agent 实例的创建、查询和关闭。

**核心功能**：

```
AgentRegistry
├── 角色管理
│   ├── registerRole(role)     → 注册自定义角色
│   ├── getRole(roleId)        → 查询角色定义
│   └── listRoles()            → 列出所有角色
│
├── Agent 生命周期
│   ├── createAgent(roleId, model, tools, overrides?)  → 创建并启动
│   ├── removeAgent(agentId)   → 停止并移除
│   ├── shutdown()             → 优雅关闭所有 Agent
│   └── reset()                → 完全重置（保留内置角色）
│
├── Agent 查询
│   ├── getAgent(roleId)       → 按角色查找（优先空闲）
│   ├── getAgents(roleId)      → 获取指定角色的所有 Agent
│   ├── getAgentById(agentId)  → 按 ID 查找
│   ├── getAllAgents()         → 获取所有 Agent
│   └── agentCount             → Agent 总数
```

**共享依赖自动注入**：`createAgent()` 自动注入共享的 `ExecutionEngine`、`EventBus`、`StateManager`、`ContextManager`，避免重复创建。

---

### 3.13 WorkerAgent 兼容层

**位置**: `src/agent/worker.ts`

**职责**: 保留旧版 WorkerAgent 的公开 API，内部委托给 Agent 基类。是向后兼容的桥梁。

**两种执行路径**：

```
WorkerAgent.run(input)
       │
       ├─→ 路径 1：Agent 委托（推荐）
       │   条件：ExecutionEngine 已初始化
       │   行为：懒初始化 Agent 实例 → agent.executeTask()
       │
       └─→ 路径 2：LangChain 原生（兼容）
           条件：无 ExecutionEngine
           行为：直接调用 langchain.createAgent()
```

---

## 4. 任务执行全流程

下面以「Orchestrator 派发一个编码任务给 Code Agent」为例，展示完整的执行流程：

```
                          Orchestrator (server 包)
                                  │
                                  │ 1. Dispatcher 选择 Code Agent
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                        EventBus                                  │
│                                                                  │
│   publish('agent.command.code_modify', {                         │
│     taskId: 'task-x',                                           │
│     description: '修改 login.ts 添加 JWT 验证'                   │
│   })                                                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ 2. Command 消息到达
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Code Agent                                 │
│                                                                  │
│  handleCommand(msg):                                            │
│    1. 标记 status = 'busy'                                     │
│    2. StateManager.agents.update({ status: 'busy' })           │
│    3. publish('agent.event.task_started')                      │
│    4. 构建 RuntimeContext（ContextManager.build）               │
│    5. 获取工具（ToolRegistry.getToolsForAgent）                 │
│    6. 委托给 ExecutionEngine.run()                             │
│                                                                  │
│    ┌──────────────────────────────────────────────────────┐     │
│    │              ExecutionEngine.run()                    │     │
│    │                                                       │     │
│    │  Step 1:                                              │     │
│    │   Save Checkpoint (step=0)                            │     │
│    │   Observe → 消息历史 + 事件                            │     │
│    │   Think   → LLM: { decision: "use_tool",              │     │
│    │                     toolCall: { name: "file_read",    │     │
│    │                                 args: { path: "login.ts" }}}│
│    │   Act     → SandboxGuard.check("file_read", args)     │     │
│    │             → safe → 执行 → 返回文件内容                │     │
│    │   Reflect → 追加工具结果到上下文                        │     │
│    │                                                       │     │
│    │  Step 2:                                              │     │
│    │   Save Checkpoint (step=1)                            │     │
│    │   Observe → 包含文件内容                                │     │
│    │   Think   → LLM: { decision: "use_tool",              │     │
│    │                     toolCall: { name: "file_write",   │     │
│    │                                 args: { path: "login.ts",│
│    │                                         content: "..." }}}│
│    │   Act     → SandboxGuard.check("file_write", args)    │     │
│    │             → confirm → onConfirmRequired?             │     │
│    │             → 用户批准 → 写入文件                        │     │
│    │   Reflect → 追加结果                                    │     │
│    │                                                       │     │
│    │  Step 3:                                              │     │
│    │   Think   → LLM: { decision: "done",                  │     │
│    │                     summary: "已为 login.ts 添加 JWT..."}│   │
│    │                                                       │     │
│    │   返回: { status: 'success', result: '...', ... }     │     │
│    └──────────────────────────────────────────────────────┘     │
│                                                                  │
│    7. publish('agent.event.task_completed', { result })         │
│    8. StateManager.agents.update({ status: 'idle' })           │
└─────────────────────────────────────────────────────────────────┘
                         │
                         │ 3. task_completed 事件
                         ▼
                  Orchestrator (server 包)
                  收到 task_completed → 继续下一个子任务
```

---

## 5. 与其他包的集成

```
┌──────────────────────────────────────────────────────────┐
│                     my-agent 项目                          │
│                                                           │
│  ┌─────────────────────┐   ┌─────────────────────┐       │
│  │   packages/web      │   │  packages/server     │       │
│  │   (前端 UI)         │   │  (后端服务)          │       │
│  │                     │   │                      │       │
│  │  React + Vite       │   │  Fastify + WS        │       │
│  │  Stores/Hooks       │   │  Orchestrator        │       │
│  │  Components         │   │  Gateway             │       │
│  │                     │   │  DB (SQLite)         │       │
│  └──────────┬──────────┘   └──────────┬───────────┘       │
│             │                         │                    │
│             └──────────┬──────────────┘                    │
│                        │                                   │
│                        ▼                                   │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              packages/core                           │  │
│  │              (本库 —— 纯逻辑引擎)                    │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**server 包如何使用 core**：
- 创建 `ToolRegistry` 并注册工具 → 注入到 `AgentRegistry`
- 创建 `AgentRegistry` → 按需 `createAgent('code', model, toolRegistry)`
- Orchestrator 通过 EventBus 派发 Command → Agent 自动领取执行
- 使用 `FileCheckpointManager` 持久化执行状态
- 使用 `FileLongTermMemory` 持久化长期记忆

**web 包如何使用 core**：
- 导入类型定义（`AgentStatus`, `Task`, `ArtifactList` 等）用于 UI 展示
- 通过 WebSocket 接收 server 推送的执行状态

---

## 核心设计原则总结

1. **依赖注入**：所有外部依赖通过构造函数注入，便于测试和替换
2. **接口优先**：关键组件都有接口定义（`IEventBus`, `IStateManager`, `ICheckpointManager`, `IMemoryManager`），实现可替换
3. **错误隔离**：EventBus handler 异常、Hook handler 异常、onChange 回调异常都不影响其他组件
4. **渐进式增强**：Checkpoint、Memory、EventBus、PermissionRegistry 都是可选的，不提供则使用 Noop 实现兜底
5. **Zod 驱动**：工具定义和参数校验用 Zod schema，获得编译时类型 + 运行时校验的双重保障
6. **兼容层策略**：WorkerAgent 保留旧 API，内部委托给 Agent 基类，向后兼容
7. **安全纵深防御**：命令白名单（shell）+ 路径约束（file）+ 高危模式检测（SandboxGuard）+ 权限注册表，四层安全防护
