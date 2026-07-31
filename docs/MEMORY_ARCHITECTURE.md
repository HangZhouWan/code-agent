# Memory 体系架构详解

> 本文档从代码调用顺序的角度，详细分析 my-agent 项目中记忆系统的设计、架构和运作机制。

---

## 目录

1. [架构全景](#1-架构全景)
2. [三层记忆体系 (Core SDK)](#2-三层记忆体系-core-sdk)
3. [上下文管理器 (ContextManager)](#3-上下文管理器-contextmanager)
4. [上下文压缩器 (ContextCompressor)](#4-上下文压缩器-contextcompressor)
5. [Checkpoint 机制](#5-checkpoint-机制)
6. [Memory 在 ReAct 循环中的运作](#6-memory-在-react-循环中的运作)
7. [Memory 在 Agent 生命周期中的运作](#7-memory-在-agent-生命周期中的运作)
8. [数据库持久化（服务端层）](#8-数据库持久化服务端层)
9. [Memory 初始化与注入链路](#9-memory-初始化与注入链路)
10. [核心文件索引](#10-核心文件索引)

---

## 1. 架构全景

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Memory 体系全景                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────┐   ┌──────────────────────────────┐ │
│  │     Core SDK (runtime memory)    │   │   Server (persistent memory)  │ │
│  │                                 │   │                              │ │
│  │  ┌───────────────────────────┐  │   │  ┌────────────────────────┐  │ │
│  │  │     IMemoryManager        │  │   │  │     SQLite Database     │  │ │
│  │  │  ┌─────────────────────┐  │  │   │  │                        │  │ │
│  │  │  │  ShortTermMemory    │  │  │   │  │  ● sessions            │  │ │
│  │  │  │  (循环数组, 200条)   │  │  │   │  │  ● messages            │  │ │
│  │  │  └─────────────────────┘  │  │   │  │  ● long_term_memory    │  │ │
│  │  │  ┌─────────────────────┐  │  │   │  │  ● tasks               │  │ │
│  │  │  │  WorkingMemory      │  │  │   │  │  ● artifacts           │  │ │
│  │  │  │  (KV 白板, Map)      │  │  │   │  │  ● events              │  │ │
│  │  │  └─────────────────────┘  │  │   │  └────────────────────────┘  │ │
│  │  │  ┌─────────────────────┐  │  │   └──────────────────────────────┘ │
│  │  │  │  LongTermMemory     │  │  │                                    │
│  │  │  │  (JSON文件/关键词)   │  │  │   ┌──────────────────────────────┐ │
│  │  │  └─────────────────────┘  │  │   │     File System               │ │
│  │  └───────────────────────────┘  │   │                              │ │
│  │                                 │   │  ● data/checkpoints/*.json   │ │
│  │  ┌───────────────────────────┐  │   │  ● data/long-term-memory.json │ │
│  │  │     ContextManager        │  │   └──────────────────────────────┘ │
│  │  │  ● AgentContext Map       │  │                                    │
│  │  │  ● Token 预算管理          │  │                                    │
│  │  │  ● 自动压缩触发            │  │                                    │
│  │  │  ● 子 Agent 上下文继承     │  │                                    │
│  │  └───────────────────────────┘  │                                    │
│  │                                 │                                    │
│  │  ┌───────────────────────────┐  │                                    │
│  │  │  FileCheckpointManager    │  │                                    │
│  │  │  ● 每 Step 前保存快照      │  │                                    │
│  │  │  ● resume() 恢复执行       │  │                                    │
│  │  └───────────────────────────┘  │                                    │
│  └─────────────────────────────────┘                                    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

整个 Memory 体系由 **Core SDK（运行时记忆）** 和 **Server（持久化记忆）** 两部分组成：

| 组件 | 存储位置 | 生命周期 | 职责 |
|------|---------|---------|------|
| ShortTermMemory | 内存循环数组 | 单次 Agent 执行 | 当前任务的对话轮次记忆 |
| WorkingMemory | 内存 Map | 单次 Task | 多 Agent 共享的白板 |
| LongTermMemory (Core) | JSON 文件 | 跨会话 | 跨会话知识检索 |
| ContextManager | 内存 Map | 单次 Agent 执行 | 消息历史 + Token 预算管理 |
| CheckpointManager | JSON 文件 | 任务执行期间 | 断点恢复快照 |
| SQLite 表 (Server) | SQLite 数据库 | 永久 | 会话/消息/长期记忆持久化 |

---

## 2. 三层记忆体系 (Core SDK)

位于 [packages/core/src/harness/memory/](packages/core/src/harness/memory/)，是 Agent Runtime 的核心记忆抽象。

### 2.1 类型定义

**接口文件**：[memory/types.ts](packages/core/src/harness/memory/types.ts)

```typescript
// 三层记忆的总接口
interface IMemoryManager {
  shortTerm: ShortTermMemory;   // 短期记忆
  longTerm: LongTermMemory;     // 长期记忆
  working: WorkingMemory;       // 工作记忆
}
```

### 2.2 ShortTermMemory — 短期记忆

**实现文件**：[memory/short-term.ts](packages/core/src/harness/memory/short-term.ts)

```
┌──────────────────────────────────────────┐
│          ShortTermMemory                  │
│                                           │
│  内部结构: Array<{role, content}>         │
│  最大容量: 200 条                         │
│  淘汰策略: FIFO（超出后 shift 最早消息）    │
│  持久化:   无（纯内存）                    │
│                                           │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┐  │
│  │ 1 │ 2 │ 3 │...│198│199│200│   │   │  │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┘  │
│    ← 旧消息          新消息 →             │
│    (超出时自动淘汰)                        │
└──────────────────────────────────────────┘
```

- **用途**：记录单次 Agent 执行中的对话流（`user` → `assistant` → `tool` → ...）
- **写入时机**：ExecutionEngine 的 Act 阶段，每次工具调用完成后调用 `this.memory.shortTerm.add()`
- **容量**：最多 200 条，超出后自动移除最旧条目
- **线程安全**：否，仅供单个 ExecutionEngine 使用

关键方法：
| 方法 | 说明 |
|------|------|
| `add(entry)` | 追加一条消息，超出 200 条时自动淘汰最早的 |
| `recent(n)` | 获取最近 n 条消息 |
| `all()` | 获取所有消息的副本 |
| `clear()` | 清空所有消息 |

### 2.3 WorkingMemory — 工作记忆（共享白板）

**实现文件**：[memory/working.ts](packages/core/src/harness/memory/working.ts)

```
┌────────────────────────────────────────────────────┐
│              WorkingMemory (白板)                    │
│                                                     │
│  内部结构: Map<string, unknown>                      │
│  持久化:   无（task 结束即清理）                       │
│  共享范围: 同一 task 内的所有 Agent                   │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  "project_language"  → "TypeScript"         │    │
│  │  "dependencies"      → ["react", "fastify"] │    │
│  │  "found_issues"      → [{...}, {...}]       │    │
│  │  "current_branch"    → "main"               │    │
│  │  ...                                        │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Agent A (code) ──── write() ──→  Map               │
│  Agent B (test) ←──── read()  ──  Map               │
│  Agent C (doc)  ←──── read()  ──  Map               │
└────────────────────────────────────────────────────┘
```

- **用途**：同一 task 内多个 Agent 共享中间结果（如"当前项目语言"、"已发现的问题列表"）
- **写入时机**：Agent 在推理过程中通过 ExecutionEngine 写入
- **协调机制**：Agent 之间通过 EventBus 协调读写顺序，避免竞态
- **生命周期**：task 开始创建，task 结束清理

关键方法：
| 方法 | 说明 |
|------|------|
| `write(key, value)` | 写入键值对 |
| `read<T>(key)` | 读取键值，不存在返回 `null` |
| `snapshot()` | 获取全部快照的副本 |
| `clear()` | 清空所有键值 |

### 2.4 LongTermMemory — 长期记忆

**实现文件**：[memory/long-term.ts](packages/core/src/harness/memory/long-term.ts)

```
┌────────────────────────────────────────────────────┐
│              LongTermMemory                         │
│                                                     │
│  存储位置: data/long-term-memory.json               │
│  持久化:   是（JSON 文件）                            │
│  搜索方式: 关键词匹配（预留 embedding 接口）           │
│  存储结构: Array<LongTermEntry>                     │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  [                                          │    │
│  │    {                                        │    │
│  │      id: "ltm_1690...",                     │    │
│  │      sessionId: "session-abc",              │    │
│  │      content: "用户喜欢使用 React + TS",     │    │
│  │      metadata: { type: "preference" },      │    │
│  │      createdAt: "2026-07-28T..."            │    │
│  │    },                                       │    │
│  │    ...                                      │    │
│  │  ]                                          │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  搜索流程:                                          │
│    query "React 项目结构"                            │
│         │                                           │
│         ▼                                           │
│    分词: ["react", "项目", "结构"]                    │
│         │                                           │
│         ▼                                           │
│    匹配评分（关键词命中数 + 精确匹配加分）              │
│         │                                           │
│         ▼                                           │
│    返回 Top-K 结果（默认 5 条）                       │
└────────────────────────────────────────────────────┘
```

- **用途**：跨会话存储重要知识（用户偏好、项目约定、常见问题解答）
- **搜索算法**：
  1. 对 query 进行中英文分词（按非字母数字/中文分割，保留长度 ≥ 2 的词条）
  2. 遍历所有记忆，统计每个 token 在 content 中的命中次数
  3. 精确匹配额外加分（+2）
  4. 按分数降序排序，返回 Top-K
- **延迟加载**：首次 `store()`/`search()` 时才从文件读取，减少启动开销
- **预留**：`search()` 方法的签名预留了 embedding 语义搜索接口，后续可替换为向量数据库

关键方法：
| 方法 | 说明 |
|------|------|
| `store(entry)` | 存储一条记忆（生成唯一 ID，写入 JSON 文件） |
| `search(query, topK)` | 关键词搜索记忆，返回 Top-K 结果 |
| `deleteBySession(sessionId)` | 删除指定会话的所有记忆 |
| `count()` | 获取记忆总数 |

---

## 3. 上下文管理器 (ContextManager)

**实现文件**：[context/manager.ts](packages/core/src/harness/context/manager.ts)

### 3.1 核心数据结构

```typescript
// ContextWindow —— Token 预算窗口
interface ContextWindow {
  maxTokens: number;      // 最大 token 数，默认 128000
  currentTokens: number;  // 当前已使用 token 数（估算值）
  threshold: number;      // 压缩触发阈值，默认 0.8（80%）
}

// AgentContext —— 完整 Agent 会话上下文
interface AgentContext {
  sessionId: string;      // 父会话 ID
  agentId: string;        // Agent 唯一标识
  messages: BaseMessage[]; // 消息历史
  window: ContextWindow;  // Token 窗口配置
  summary?: string;       // 压缩后生成的历史摘要
}

// RuntimeContext —— 轻量级运行时上下文（ExecutionEngine 使用）
interface RuntimeContext {
  messages: BaseMessage[]; // 消息历史
  tokenCount: number;      // 当前 token 使用量（估算值）
  summary?: string;        // 压缩后生成的历史摘要
}
```

### 3.2 核心职责

ContextManager 是 Agent 上下文的唯一管理中心，管理所有活跃 Agent 的会话状态。

```
┌─────────────────────────────────────────────────────────┐
│                  ContextManager                          │
│                                                         │
│  contexts: Map<agentId, AgentContext>                   │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Agent A  │  │ Agent B  │  │ Agent C  │              │
│  │ 上下文    │  │ 上下文    │  │ 上下文    │              │
│  │          │  │          │  │          │              │
│  │ messages │  │ messages │  │ messages │              │
│  │ window   │  │ window   │  │ window   │              │
│  │ summary  │  │ summary  │  │ summary  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                         │
│  功能：                                                 │
│  1. create()          — 创建新上下文                     │
│  2. addMessage()      — 追加消息 → 自动检查压缩          │
│  3. addToolResult()   — 注入工具结果                     │
│  4. inheritForSubAgent() — 子 Agent 上下文继承           │
│  5. build()           — 构建 RuntimeContext（给引擎用）   │
│  6. append()          — 运行时追加内容                    │
│  7. compress()        — 运行时压缩上下文                  │
│  8. estimateTokens()  — Token 估算（字符数 / 4）         │
└─────────────────────────────────────────────────────────┘
```

### 3.3 自动压缩触发机制

```
      消息追加 (addMessage / addToolResult / append)
         │
         ▼
    estimateTokens() 估算当前 token 数
         │
         ├── currentTokens ≤ maxTokens × threshold (80%)
         │      → 不触发压缩，直接返回
         │
         └── currentTokens > maxTokens × threshold (80%)
                │
                ▼
           触发压缩 compress()
                │
                ▼
           保留最近 20 条消息完整内容
           对更早的消息生成摘要 → ctx.summary
                │
                ▼
           压缩后重新估算 token 数
```

### 3.4 子 Agent 上下文继承

当 Orchestrator 派生子 Agent 执行子任务时，`inheritForSubAgent()` 实现上下文继承：

```
父 Agent 上下文
  │
  ├── 父 Agent 的 summary（如果有）→ 注入为子 Agent 首条消息前缀
  ├── 父 Agent 最近 4 条消息  → 追加到子 Agent 消息历史
  └── 父 Agent 的 sessionId  → 子 Agent 继承（同一会话）
  │
  ▼
子 Agent 上下文
  ● 独立的消息历史（不继承完整历史）
  ● 独立的 token 窗口（默认 128000）
  ● 继承父 Agent 的摘要（获取任务背景）
```

**设计意图**：子 Agent 通过摘要了解任务背景，同时拥有独立的 token 预算，避免父 Agent 的消息历史撑满子 Agent 的上下文窗口。

### 3.5 Token 估算

```typescript
estimateTokens(messages: BaseMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    // 递归计算所有文本内容的字符数
    totalChars += content.length;
  }
  return Math.ceil(totalChars / 4); // 粗略估算：4 字符 ≈ 1 token
}
```

- 这是一个**粗略估算**，实际 token 数取决于具体的 tokenizer
- 预留了替换为 tiktoken 或 Anthropic tokenizer 的接口

---

## 4. 上下文压缩器 (ContextCompressor)

**实现文件**：[context/compressor.ts](packages/core/src/harness/context/compressor.ts)

```
         完整消息历史 (100 条)
              │
              ▼
    ┌─────────────────────┐
    │    compressMessages  │
    │                     │
    │  keepRecent = 20    │
    └─────────────────────┘
              │
              ▼
    ┌──────────┼──────────┐
    │                      │
    ▼                      ▼
  前 80 条                 后 20 条
  (需要压缩)               (保留完整)
    │
    ▼
  summarize() 摘要生成
    │
    ├── 取前 5 条消息的前 200 字符
    ├── 格式: "[Summary of N earlier messages]\n[1] role: content\n..."
    └── @todo: 替换为 LLM 驱动的摘要生成
```

**当前实现**：简单截断 + 文本拼接，取前 5 条消息的前 200 字符作为摘要。代码中明确标注 `@todo 替换为 LLM 摘要实现`。

**压缩策略**：
1. 消息总数 ≤ `keepRecent` → 对全部消息生成摘要
2. 消息总数 > `keepRecent` → 保留最近 N 条完整内容，更早的消息生成摘要

**压缩在 ReAct 循环中的表现**：当 token 使用超过 80% 阈值时触发，保留最近 20 条消息完整不变，对更早的消息生成摘要存入 `summary` 字段。下一轮 Think 阶段发生 LLM 调用时，摘要会作为 context 前缀注入到 prompt 中。

---

## 5. Checkpoint 机制

**实现文件**：[execution/checkpoint.ts](packages/core/src/harness/execution/checkpoint.ts)

### 5.1 Checkpoint 快照结构

```typescript
interface CheckpointSnapshot {
  taskId: string;                    // 任务 ID
  agentId: string;                   // Agent ID
  step: number;                      // 当前执行步数
  createdAt: Date;                   // 快照创建时间
  context: RuntimeContext;           // 运行时上下文（消息历史 + token 信息）
  toolHistory: ToolCallRecord[];     // 工具调用历史
  reasoningTrail: Thought[];         // 推理记录
}
```

### 5.2 保存与恢复

```
           ReAct 循环每次迭代 (step)
                    │
                    ▼
          ┌──────────────────┐
          │ checkpoint.save() │ ← 每 Step 前自动保存
          └──────────────────┘
                    │
          ┌─────────┼─────────┐
          │                   │
       执行正常             执行中断（超时/崩溃）
          │                   │
          ▼                   ▼
     继续下一步       ┌──────────────────┐
                     │ checkpoint.load() │ ← 从文件恢复
                     └──────────────────┘
                              │
                              ▼
                     ┌────────────────────┐
                     │ engine.resume()    │ ← 从 snapshot 继续执行
                     └────────────────────┘
```

- **存储格式**：每个 task 对应一个 JSON 文件，路径为 `data/checkpoints/{taskId}.json`
- **覆盖策略**：每次 `save()` 覆盖上次记录（只保留最新 checkpoint）
- **保存时机**：每轮 ReAct 循环的 Step 开始前自动保存，超时时保存一次
- **恢复机制**：`resume()` 从文件加载 snapshot，从 `snapshot.step` 继续执行

### 5.3 序列化

- **序列化**：将 `BaseMessage` 转为 `toJSON()` 后的 plain object 存储
- **反序列化**：根据`lc_id`（LangChain 类型标识）或 `role` 字段重建对应的消息类型
- **容错**：文件损坏时返回 `null`，不会导致程序崩溃

---

## 6. Memory 在 ReAct 循环中的运作

ExecutionEngine 的 ReAct 循环是记忆系统最核心的消费者。每轮循环都涉及多个记忆组件的读写。

### 6.1 完整调用链路

```
ExecutionEngine.run()
│
├── while (step < maxIterations)
│   │
│   ├── [1] checkpoint.save()        ← 每 Step 前保存快照
│   │
│   ├── [2] Observe 阶段
│   │   └── 从 RuntimeContext 读取当前消息历史
│   │
│   ├── [3] Think 阶段（LLM 调用）
│   │   ├── 构建 prompt：systemPrompt + summary（压缩摘要）+ 最近 10 条消息
│   │   ├── LLM 调用 → 返回 JSON 决策
│   │   └── parseThought() 解析为 Thought 对象
│   │
│   ├── [4] Act 阶段
│   │   ├── use_tool:
│   │   │   ├── 执行工具
│   │   │   ├── appendToContext() → 追加工具结果到消息历史
│   │   │   └── memory.shortTerm.add() → 写入短期记忆
│   │   │
│   │   ├── publish_event:
│   │   │   └── eventBus.publish() → 跨 Agent 通信
│   │   │
│   │   ├── request_agent:
│   │   │   ├── eventBus.request() → 向其他 Agent 发起请求
│   │   │   └── appendToContext() → 追加回复到消息历史
│   │   │
│   │   ├── done:
│   │   │   └── 返回 ExecutionResult（含 toolHistory + reasoningTrail）
│   │   │
│   │   └── replan:
│   │       └── 返回 status: 'replan_needed'
│   │
│   ├── [5] Context Compress Check
│   │   ├── estimateTokens(ctx.messages)
│   │   ├── if (currentTokens > 128000 * 0.8)
│   │   │   └── compressContext()
│   │   │       ├── 保留最近 20 条消息
│   │   │       ├── 对更早的消息生成摘要 → ctx.summary
│   │   │       └── 更新 ctx.tokenCount
│   │   │
│   │   └── step++
│   │
│   └── [到达 maxIterations] → 返回 timeout
│
└── 返回 ExecutionResult
```

### 6.2 Think 阶段的 Prompt 构建

这是记忆数据被实际"消费"的环节。`ExecutionEngine.think()` 将记忆组件的数据拼接为 LLM Prompt：

```typescript
// context-manager.ts 中的 think 方法
private async think(model, systemPrompt, obs): Promise<Thought> {
  // 1. 如果有压缩摘要，作为上下文前缀注入
  const contextSummary = obs.context.summary
    ? `Summary of earlier context:\n${obs.context.summary}\n\n`
    : '';

  // 2. 提取最近 10 条消息（截断至 300 字符）
  const recentMessages = obs.context.messages
    .slice(-10)
    .map(m => `[${m.getType()}] ${m.content.slice(0, 300)}`)
    .join('\n');

  // 3. 构建完整 Prompt
  const prompt = `${systemPrompt}

## Current State
${contextSummary}${recentMessages}

## Recent Events
${eventsText}

## Last Tool Result
${obs.lastToolResult ?? 'None'}

## Instructions
...(JSON 格式的输出要求)...`;

  return model.invoke([new HumanMessage(prompt)]);
}
```

**Prompt 结构**：

```
┌────────────────────────────────────────────┐
│  System Prompt（角色定义和能力边界）         │
├────────────────────────────────────────────┤
│  ## Current State                          │
│  ├── Summary of earlier context (如有压缩) │
│  └── Recent messages (最近 10 条)          │
├────────────────────────────────────────────┤
│  ## Recent Events                          │
│  └── EventBus 收集的事件（预留）            │
├────────────────────────────────────────────┤
│  ## Last Tool Result                       │
│  └── 上一个工具的执行结果                   │
├────────────────────────────────────────────┤
│  ## Instructions                           │
│  └── JSON 输出格式要求                     │
└────────────────────────────────────────────┘
```

---

## 7. Memory 在 Agent 生命周期中的运作

### 7.1 Agent 启动时的初始化

```typescript
// agent.ts → Agent.start()
async start(): Promise<void> {
  // 1. 注册到 StateManager（状态记忆）
  this.stateManager.agents.register(this.id, this.role.id);

  // 2. 订阅 EventBus 的 Command/Event 主题
  for (const topic of this.role.commandSubscriptions) {
    this.eventBus.subscribe(topic, msg => this.handleCommand(msg));
  }
  for (const topic of this.role.eventSubscriptions) {
    this.eventBus.subscribe(topic, msg => this.handleEvent(msg));
  }

  // 3. 启动心跳（每 5 秒，向 StateManager 报告存活）
  this.heartbeatTimer = setInterval(() => {
    this.stateManager.agents.heartbeat(this.id);
  }, 5000);
}
```

### 7.2 Agent 接收任务时

```
Dispatcher 派发任务
        │
        ├── direct 路径 → agent.executeTask()
        └── bus 路径   → eventBus.publish("agent.command.{role}", ...)
                                │
                                ▼
                          Agent.handleCommand()
                                │
                    ┌───────────┼───────────┐
                    │                       │
              [1] Context 构建      [2] 状态更新
              contextManager.build()  stateManager.agents.update()
              (HumanMessage →       busy + currentTask
               RuntimeContext)
                    │
                    ▼
              [3] 获取工具集
              toolRegistry.getToolsForAgent()
              (根据角色能力过滤)
                    │
                    ▼
              [4] 委托 ExecutionEngine
              engine.run({ model, tools, context, ... })
                    │
                    ▼
              [5] ReAct 循环（见第 6 节）
                    │
          ┌─────────┼─────────┐
          │                   │
       success              failure
          │                   │
          ▼                   ▼
   publish("task_     publish("task_
   completed")        failed")
          │
          ▼
   [6] 恢复 idle
   stateManager.agents.update()
   status: 'idle', currentTask: undefined
```

### 7.3 运行时上下文的两种使用模式

#### 模式一：ContextManager 管理模式（Agent 内部）

通过 `contextManager.build()` 从原始消息构建 `RuntimeContext`，由 `ContextManager` 集中管理：

```typescript
// agent.ts → handleCommand()
const context = this.contextManager.build([
  new HumanMessage(`Task: ${payloadText}`),
]);

// 执行后 context 由 ExecutionEngine 内部追加和压缩
const result = await this.engine.run({ ..., context });
```

#### 模式二：ExecutionEngine 自管理模式（引擎内部）

ExecutionEngine 内部有**重复的压缩逻辑**（`engine.ts` 中的 `compressContext()` 和 `appendToContext()`），与 `ContextManager` 的方法功能相同但独立实现。这是当前架构中的一个**设计冗余**：两个压缩实现共存，`ContextManager` 提供对外接口，`ExecutionEngine` 在内部自维护压缩。

### 7.4 Dispatcher 的上下文编排

Dispatcher 在派发子任务时，会构建跨任务的上下文关联：

```typescript
// dispatcher.ts → buildContext()
function buildContext(task: SubTask, completed: Record<string, WorkerOutput>): string {
  const parts: string[] = [];
  for (const depId of task.dependsOn) {       // 遍历依赖任务
    const dep = completed[depId];              // 获取已完成任务的输出
    parts.push(`[前置任务 "${depId}" 的结果]：${dep.result}`);
  }
  return parts.join('\n\n');
}

// 构建后的 context 作为 AgentInput.context 传入
const context = buildContext(task, completed);
agent.executeTask({ taskId, description, context });
```

这意味着子 Agent 执行时，其 RuntimeContext 的首条消息将包含前置任务的完整结果。

---

## 8. 数据库持久化（服务端层）

服务端通过 SQLite 提供**永久层**记忆，与 Core SDK 的运行时记忆形成互补。

### 8.1 数据库 Schema

**定义文件**：[server/src/db/schema.ts](packages/server/src/db/schema.ts)

```
          SQLite Database
┌──────────────────────────────────────┐
│                                      │
│  ┌────────────┐  ┌────────────────┐  │
│  │  sessions  │  │   messages     │  │
│  │            │  │                │  │
│  │  id        │←─│  session_id FK │  │
│  │  title     │  │  role          │  │
│  │  created_at│  │  content       │  │
│  │  updated_at│  │  created_at    │  │
│  └────────────┘  └────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │     long_term_memory           │  │
│  │                                │  │
│  │  id          TEXT PK           │  │
│  │  session_id  TEXT FK → sessions│  │
│  │  content     TEXT              │  │
│  │  metadata    TEXT (JSON)       │  │
│  │  created_at  INTEGER (unix)    │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────┐  ┌────────────────┐  │
│  │   tasks    │  │   artifacts    │  │
│  └────────────┘  └────────────────┘  │
│                                      │
│  ┌────────────────┐                  │
│  │    events      │                  │
│  └────────────────┘                  │
│                                      │
└──────────────────────────────────────┘
```

### 8.2 sessions / messages 表

这是传统的对话持久化，由 `SessionRepository` 管理：

- **写入时机**：WebSocket 收到用户消息时、Orchestrator 完成后
- **读取代码**：[server/src/gateway/ws/chat.ts](packages/server/src/gateway/ws/chat.ts)

```typescript
// 用户消息到达 → 持久化
case "message": {
  repo.addMessage(sessionId, { role: "human", content });
  await streamOrchestrator(...);
}

// finalizer 完成 → 持久化 assistant 回复
case "on_chain_end": {
  if (event.name === "finalizer") {
    repo.addMessage(sessionId, { role: "assistant", content: finalResponse });
    send(socket, { type: "done", finalResponse });
  }
}
```

### 8.3 long_term_memory 表

这是数据库层的长期记忆表，与 Core SDK 的 `FileLongTermMemory`（JSON 文件）**是两套独立的长期记忆实现**：

| 维度 | Core SDK FileLongTermMemory | Server SQLite long_term_memory |
|------|---------------------------|-------------------------------|
| 存储位置 | `data/long-term-memory.json` | SQLite 数据库 |
| 搜索方式 | 关键词分词匹配 | SQL 查询（预留） |
| 关联关系 | sessionId 字段 | session_id FK → sessions 表 |
| 使用场景 | Agent 运行时查询 | HTTP API 查询、管理 |
| 当前状态 | 在 ExecutionEngine 中通过 NoopMemoryManager 默认禁用 | Schema 已定义，待接入 |

**注意**：两套长期内存在当前代码中是**解耦且独立的**，没有同步机制。ExecutionEngine 默认使用 `NoopMemoryManager`（所有方法为空操作），真正的 MemoryManager 实例需要在服务启动时注入。

---

## 9. Memory 初始化与注入链路

### 9.1 服务启动时的初始化

**文件**：[server/src/index.ts](packages/server/src/index.ts) — `main()` 函数

```
main()
│
├── [1] 加载配置
├── [2] 创建 LLM 模型
├── [3] 注册 11 个内置工具
├── [4] 初始化 Agent 基础设施
│       ├── new InMemoryEventBus()
│       ├── new InMemoryStateManager(eventBus)
│       ├── new FileCheckpointManager("./data/checkpoints")
│       └── new ExecutionEngine()
│            ↑
│            注意：这里未注入 MemoryManager！
│            ExecutionEngine 使用 NoopMemoryManager
│            (所有 shortTerm/longTerm/working 操作都是空操作)
│
├── [5] 创建 AgentRegistry 并注册 3 个 Agent
│       └── agentRegistry.createAgent("code/test/doc", ...)
│
├── [6] 初始化 SQLite 数据库
├── [7] 创建 Fastify 服务
├── [8] 装饰共享实例
│       ├── app.decorate("db", db)
│       ├── app.decorate("permissionRegistry", permRegistry)
│       ├── app.decorate("checkpointManager", checkpointManager)
│       └── app.decorate("executionEngine", executionEngine)
│
└── [9] 启动 HTTP + WebSocket 监听
```

### 9.2 当前注入现状

```
┌─────────────────────────────────────────────────────────────────┐
│                      初始化 vs 实际使用                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  组件              服务端初始化      实际注入给 ExecutionEngine    │
│  ────              ──────────       ─────────────────────────   │
│  EventBus          ✅ 已创建         ❌ 未注入                    │
│  StateManager      ✅ 已创建         ❌ 未注入                    │
│  CheckpointManager ✅ 已创建         ❌ 未注入                    │
│  MemoryManager     ❌ 未创建         ❌ 未注入（Noop 默认）       │
│  ContextManager    ❌ 未创建         ❌ 未注入                    │
│  ExecutionEngine   ✅ 无参构造       N/A（自身就是引擎）          │
│                                                                 │
│  实际效果：ExecutionEngine 的所有记忆操作都是空操作                │
│  （NoopCheckpointManager + NoopMemoryManager）                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**当前状态**：Memory 体系的核心组件（ShortTermMemory、WorkingMemory、LongTermMemory、CheckpointManager、ContextManager）**代码已全部实现并通过测试**，但在服务端初始化时**尚未完整注入到 ExecutionEngine**。ExecutionEngine 默认使用 Noop 实现（空操作），需要一次集中的"连线"工作将各组件接入。

### 9.3 理想的注入链路

```
main()
│
├── 创建 EventBus
├── 创建 StateManager(eventBus)
├── 创建 CheckpointManager("./data/checkpoints")
├── 创建 ShortTermMemory()
├── 创建 WorkingMemory()
├── 创建 LongTermMemory("./data")
├── 创建 MemoryManager({ shortTerm, longTerm, working })  ← 聚合
├── 创建 ContextManager()
│
└── 创建 ExecutionEngine(
      checkpointManager,    // ← 启用断点恢复
      memoryManager,        // ← 启用三层记忆
      eventBus,             // ← 启用事件收集
      contextManager,       // ← 启用上下文管理
    )
    │
    ▼
  Agent.executeTask() → engine.run()
    │
    ├── checkpoint.save()   ✅ 每 Step 保存
    ├── memory.shortTerm    ✅ 记录工具调用
    ├── memory.working      ✅ 共享中间状态
    ├── memory.longTerm     ✅ 跨会话知识
    └── contextManager      ✅ 上下文压缩
```

---

## 10. 核心文件索引

### Core SDK 记忆模块

| 文件 | 职责 |
|------|------|
| [harness/memory/types.ts](packages/core/src/harness/memory/types.ts) | ShortTermMemory、WorkingMemory、LongTermMemory、IMemoryManager 接口定义 |
| [harness/memory/short-term.ts](packages/core/src/harness/memory/short-term.ts) | InMemoryShortTermMemory — 循环数组实现（200 条上限） |
| [harness/memory/working.ts](packages/core/src/harness/memory/working.ts) | InMemoryWorkingMemory — Map 白板实现 |
| [harness/memory/long-term.ts](packages/core/src/harness/memory/long-term.ts) | FileLongTermMemory — JSON 文件 + 关键词搜索 |
| [harness/context/types.ts](packages/core/src/harness/context/types.ts) | ContextWindow、AgentContext、RuntimeContext 类型 |
| [harness/context/manager.ts](packages/core/src/harness/context/manager.ts) | ContextManager — 上下文生命周期 + Token 预算 + 压缩触发 |
| [harness/context/compressor.ts](packages/core/src/harness/context/compressor.ts) | compressMessages — 消息历史摘要生成 |
| [harness/execution/checkpoint.ts](packages/core/src/harness/execution/checkpoint.ts) | CheckpointSnapshot、ICheckpointManager、FileCheckpointManager |

### 执行引擎中的记忆消费

| 文件 | 关键方法 | 记忆组件交互 |
|------|---------|-------------|
| [harness/execution/engine.ts](packages/core/src/harness/execution/engine.ts) | `run()` / `runFromSnapshot()` | 每 Step 前保存 checkpoint，Act 阶段写入 shortTerm |
| 同上 | `think()` | 从 RuntimeContext 读取消息 + summary，拼接为 LLM Prompt |
| 同上 | `compressContext()` | 保留最近 20 条，对早期消息生成摘要 |
| 同上 | `appendToContext()` | 追加工具/事件/Agent 回复到消息历史 |

### Agent 层中的记忆消费

| 文件 | 关键方法 | 记忆组件交互 |
|------|---------|-------------|
| [agent/agent.ts](packages/core/src/agent/agent.ts) | `handleCommand()` / `executeTask()` | 用 `contextManager.build()` 构建 RuntimeContext |
| [agent/agent.ts:229](packages/core/src/agent/agent.ts#L229) | `handleCommand()` | `this.contextManager.build([new HumanMessage(...)])` |
| [agent/reasoning.ts](packages/core/src/agent/reasoning.ts) | `DefaultReasoningLoop` | 委托给 ExecutionEngine，由引擎内部消费记忆 |

### 服务端持久化

| 文件 | 职责 |
|------|------|
| [server/src/db/schema.ts](packages/server/src/db/schema.ts) | sessions、messages、long_term_memory、tasks、artifacts、events 表定义 |
| [server/src/db/index.ts](packages/server/src/db/index.ts) | Drizzle ORM 初始化，导出所有 schema |
| [server/src/db/repositories/sessions.ts](packages/server/src/db/repositories/sessions.ts) | SessionRepository — 会话/消息 CRUD |
| [server/src/index.ts](packages/server/src/index.ts) | 服务启动入口 — 初始化所有基础设施 |
| [server/src/gateway/ws/chat.ts](packages/server/src/gateway/ws/chat.ts) | WebSocket handler — 消息持久化入口 |

### 编排层中的上下文构建

| 文件 | 关键函数 | 记忆交互 |
|------|---------|---------|
| [server/src/orchestrator/nodes/dispatcher.ts](packages/server/src/orchestrator/nodes/dispatcher.ts#L59) | `buildContext()` | 将依赖任务的输出拼接为上下文 |
| [server/src/orchestrator/nodes/planner.ts](packages/server/src/orchestrator/nodes/planner.ts) | planner node | 从 OrchestratorState 读取 messages 历史 |
| [server/src/orchestrator/nodes/finalizer.ts](packages/server/src/orchestrator/nodes/finalizer.ts) | finalizer node | 汇总所有子任务结果生成最终回复 |

---

## 附录：术语对照

| 术语 | 英文 | 说明 |
|------|------|------|
| 短期记忆 | ShortTermMemory | 单次 Agent 执行的对话轮次记忆，循环数组，200 条上限 |
| 工作记忆 | WorkingMemory | 同一 Task 内多 Agent 共享的 KV 白板 |
| 长期记忆 | LongTermMemory | 跨会话的知识存储，支持关键词搜索 |
| 上下文窗口 | ContextWindow | Token 预算配置，含最大 token 数和压缩阈值 |
| 运行时上下文 | RuntimeContext | ExecutionEngine 使用的轻量级上下文（消息 + token 数 + 摘要） |
| Agent 上下文 | AgentContext | ContextManager 管理的完整 Agent 会话状态 |
| 检查点 | Checkpoint | 执行快照，每 Step 前保存，用于中断恢复 |
| 压缩器 | Compressor | 当 token 超过阈值时对早期消息生成摘要 |
| 上下文管理器 | ContextManager | 统一管理所有活跃 Agent 的会话上下文生命周期 |
| 记忆管理器 | IMemoryManager | 聚合三层记忆的总接口 |
