# 实现计划 04：Agent Runtime（Harness 层）实现

**对应技术文档**：[2026-07-02-technical-implementation.md](./2026-07-02-technical-implementation.md) 第四节

**预计工时**：5-7 天（第 2-3 周）

**前置模块**：[01-Monorepo](./implementation-plan-01-monorepo.md)、[02-LLM 抽象层](./implementation-plan-02-llm-abstraction.md)、[03-工具层](./implementation-plan-03-tools-layer.md)

---

## 1. 目标

构建 Agent 安全运行环境，包含三个子系统：

| 子系统 | 职责 |
|--------|------|
| **权限沙箱** | 工具调用前的权限校验，拦截危险操作 |
| **Hooks 引擎** | 事件驱动的插件机制，日志、过滤等横切关注点 |
| **上下文管理** | 会话消息历史的 token 预算和自动压缩 |

## 2. 产出物清单

```
packages/core/src/harness/
├── sandbox/
│   ├── types.ts          # AgentCapability, PermissionLevel, PermissionResult, ToolPermission
│   ├── registry.ts       # PermissionRegistry（工具 → 权限级别映射）
│   └── guard.ts          # SandboxGuard（LangChain callback 拦截）
├── hooks/
│   ├── types.ts          # HookEvent, HookContext, HookHandler, HookResult
│   ├── engine.ts         # HooksEngine（事件注册/触发/结果合并）
│   └── builtins/
│       ├── logger.ts      # 日志 Hook
│       └── secret-filter.ts  # 敏感信息过滤 Hook
└── context/
    ├── types.ts          # ContextWindow, AgentContext
    ├── manager.ts        # ContextManager（创建/消息注入/继承/删除）
    └── compressor.ts     # compressMessages（滑动窗口 + 摘要）
```

---

## 3. 子系统一：权限沙箱

### 3.1 类型定义 (`sandbox/types.ts`)

| 类型 | 说明 |
|------|------|
| `PermissionLevel` | `'safe'`（静默放行）/ `'confirm'`（需用户确认）/ `'deny'`（禁止） |
| `AgentCapability` | Agent 的能力声明：tools[], paths[], maxTokens?, timeoutMs? |
| `PermissionResult` | 校验结果：allowed, level, reason? |
| `ToolPermission` | 全局权限策略：toolName, defaultLevel, validateArgs? |

### 3.2 权限注册表 (`sandbox/registry.ts`)

`PermissionRegistry` 类：
- `register(tp: ToolPermission)` — 注册工具的权限策略
- `get(toolName)` — 查询工具权限
- `static createDefault()` — 返回预置 12 个内置工具的权限配置

预置权限级别：
```
safe:    file.read, file.list, file.search, code_search,
         git.status, git.diff, git.log, web.fetch
confirm: file.write, shell.exec, git.commit, git.branch
deny:   (无内置 deny，由 SandboxGuard 动态判断)
```

### 3.3 沙箱守卫 (`sandbox/guard.ts`)

`SandboxGuard extends BaseCallbackHandler`，通过 LangChain 的 callback 机制在工具执行前拦截：

**`check(toolName, args)` 校验链**：
```
1. Agent capability 检查 → 工具是否在 Agent 声明的 tools[] 中
2. 权限注册表查询       → 工具是否已注册
3. Shell 高危模式检测   → 正则匹配 DENY_PATTERNS（仅 shell.exec）
4. 路径约束             → 参数中的 path 是否在 Agent 的 paths[] 前缀内
5. 自定义参数校验       → ToolPermission.validateArgs()
6. 返回 PermissionResult
```

**高危命令黑名单**（`DENY_PATTERNS`）：
- `rm -rf /...`
- `sudo`
- `chmod 777`
- `chown`
- `dd if=`
- `mkfs.`
- `> /dev/...`
- `curl ... | sh/bash`

**`handleAgentAction()` callback**：
- `level === 'deny'` → 抛出 `Error`
- `level === 'confirm'` → 抛出 `ConfirmRequiredError`（包含 toolName + args，供上层审批流程捕获）

**`ConfirmRequiredError` 类**：
```typescript
export class ConfirmRequiredError extends Error {
  constructor(
    public toolName: string,
    public args: Record<string, unknown>,
    reason?: string,
  ) { ... }
}
```

---

## 4. 子系统二：Hooks 引擎

### 4.1 类型定义 (`hooks/types.ts`)

| 类型 | 说明 |
|------|------|
| `HookEvent` | 7 个生命周期事件：`agent:start`, `agent:end`, `tool:before`, `tool:after`, `agent:error`, `message:send`, `message:receive` |
| `HookContext` | 事件上下文：event, agentId, timestamp, data |
| `HookResult` | 返回结果：modifiedArgs?, modifiedResult?, skip? |
| `HookHandler` | 处理函数签名：`(ctx: HookContext) => Promise<void \| HookResult>` |

### 4.2 引擎实现 (`hooks/engine.ts`)

`HooksEngine` 类：

```typescript
class HooksEngine {
  on(event, handler)    // 注册处理器
  off(event, handler)   // 移除处理器
  async trigger(event, partialCtx)  // 触发事件，返回合并 HookResult
}
```

**`trigger()` 合并逻辑**：
- 遍历该事件的所有 handler
- 单个 handler 异常不阻塞其他 handler
- 多个 `modifiedArgs` / `modifiedResult` → 浅合并
- 任一 handler 返回 `skip: true` → 合并结果 `skip = true`

### 4.3 内置 Hook：日志 (`builtins/logger.ts`)

```typescript
export function createLoggerHook(): HookHandler
```

功能：将事件以 `[ISO时间戳] [事件名] agent=xxx` 格式输出到 console.log。

### 4.4 内置 Hook：敏感信息过滤 (`builtins/secret-filter.ts`)

```typescript
export function createSecretFilterHook(): HookHandler
```

**过滤模式**：
- API Key / Token / Secret / Password 等键值对（正则：`(sk|api_key|token|...)['\"]?\s*[:=]\s*['\"]?[A-Za-z0-9_\-\.]{20,}`）
- PEM 私钥块（`-----BEGIN ... PRIVATE KEY-----` 到 `-----END ... PRIVATE KEY-----`）

**作用时机**：
- `tool:before`：过滤工具参数中的敏感值
- `tool:after`：过滤工具返回结果中的敏感值

---

## 5. 子系统三：上下文管理

### 5.1 类型定义 (`context/types.ts`)

```typescript
interface ContextWindow {
  maxTokens: number;        // 默认 128000
  currentTokens: number;
  threshold: number;        // 默认 0.8（超过触发压缩）
}

interface AgentContext {
  sessionId: string;
  agentId: string;
  messages: BaseMessage[];
  window: ContextWindow;
  summary?: string;         // 压缩后的旧消息摘要
}
```

### 5.2 上下文管理器 (`context/manager.ts`)

`ContextManager` 类：

| 方法 | 功能 |
|------|------|
| `create(sessionId, agentId, window?)` | 创建新的 Agent 上下文 |
| `get(agentId)` | 查询上下文 |
| `addMessage(agentId, message)` | 追加消息，超阈值时触发压缩 |
| `addToolResult(agentId, toolCallId, toolName, result)` | 注入工具调用结果 |
| `inheritForSubAgent(...)` | 为子 Agent 创建继承上下文（摘要传递） |
| `delete(agentId)` | 销毁上下文 |
| `estimateTokens(messages)` | 简单估算（字符数 / 4） |

**压缩触发逻辑**：
```
addMessage → estimateTokens → currentTokens > maxTokens × threshold?
  → yes → compressMessages → 更新 summary
  → no  → 直接追加
```

### 5.3 上下文压缩 (`context/compressor.ts`)

```typescript
export async function compressMessages(
  messages: BaseMessage[],
  maxTokens: number,
  options?: { keepRecent?: number }
): Promise<string>
```

**压缩策略**：
1. 消息总数 ≤ `keepRecent`（默认 20）→ 对全部消息生成摘要
2. 消息总数 > `keepRecent` → 保留最近 20 条完整内容，更早的消息生成摘要
3. 摘要函数（`summarize`）当前为「前 5 条消息的前 200 字符」，标注为后续替换为 LLM 摘要

---

## 6. 模块间接口约定

```
SandboxGuard ──→ 通过 LangChain callback 拦截工具调用
HooksEngine  ──→ WorkerAgent 在关键节点手动触发
ContextManager ──→ WorkerAgent 创建/维护每个子 Agent 的消息历史
```

三个子系统彼此独立，通过 `WorkerAgent`（在后续编排层中实现）串联使用。

---

## 7. 验收标准

### 沙箱
- [ ] `PermissionRegistry.createDefault()` 正确返回 12 个工具权限
- [ ] `SandboxGuard.check()` 对未知工具返回 `deny`
- [ ] Shell 高危命令全部被 `DENY_PATTERNS` 拦截
- [ ] 路径穿越在 check 阶段被拦截
- [ ] `handleAgentAction` 对 confirm 级别抛出 `ConfirmRequiredError`

### Hooks
- [ ] `HooksEngine.on/off/trigger` 功能正常
- [ ] 多个 handler 的 `modifiedArgs` 正确合并
- [ ] 单个 handler 异常不影响其他 handler
- [ ] `secret-filter` 正确脱敏 API Key 和私钥

### 上下文
- [ ] `ContextManager` CRUD 操作正常
- [ ] `addMessage` 超阈值后 `summary` 字段被填充
- [ ] `inheritForSubAgent` 子 Agent 获得摘要而非完整历史
- [ ] `addToolResult` 正确注入 `ToolMessage`
