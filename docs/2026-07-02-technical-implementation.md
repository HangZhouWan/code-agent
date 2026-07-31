# 通用 AI Agent 技术实现文档

**日期**：2026-07-02
**技术栈**：Node.js + TypeScript + LangChain + LangGraph + Fastify + React
**定位**：学习驱动的通用 AI Agent 平台

---

## 一、技术选型

| 维度 | 选择 | 说明 |
|------|------|------|
| 语言 | TypeScript | Harness 层类型安全需求高 |
| 运行时 | Node.js 22+ | LTS，ESM 原生支持 |
| 包管理 | pnpm + monorepo | 多包隔离，workspace 协议 |
| LLM 框架 | LangChain.js + LangGraph | LLM 抽象、工具系统、Agent 编排 |
| 后端框架 | Fastify 5 + @fastify/websocket | 高性能、TypeScript 友好 |
| 数据库 | SQLite (better-sqlite3) | 零配置、学习友好 |
| 前端 | React 19 + Vite 7 | 生态丰富 |
| 样式 | Tailwind CSS | 快速构建 UI |
| Markdown 渲染 | react-markdown + remark-gfm | Agent 回复渲染 |
| 代码高亮 | Shiki | 代码块语法高亮 |

---

## 二、项目结构

```
code-agent/
├── pnpm-workspace.yaml
├── package.json                    # 根 workspace 脚本
├── tsconfig.base.json              # 共享 TS 配置
├── .env.example
├── packages/
│   ├── core/                       # @code-agent/core
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            # 统一导出
│   │       ├── llm/                # LLM 抽象层
│   │       │   ├── types.ts
│   │       │   ├── factory.ts
│   │       │   ├── protocol.ts
│   │       │   └── retry.ts
│   │       ├── tools/              # 工具层
│   │       │   ├── registry.ts
│   │       │   ├── base.ts
│   │       │   ├── file.ts
│   │       │   ├── shell.ts
│   │       │   ├── search.ts
│   │       │   ├── git.ts
│   │       │   └── web.ts
│   │       ├── harness/            # Agent Runtime
│   │       │   ├── sandbox/
│   │       │   │   ├── types.ts
│   │       │   │   ├── registry.ts
│   │       │   │   └── guard.ts
│   │       │   ├── hooks/
│   │       │   │   ├── types.ts
│   │       │   │   ├── engine.ts
│   │       │   │   └── builtins/
│   │       │   │       ├── logger.ts
│   │       │   │       └── secret-filter.ts
│   │       │   └── context/
│   │       │       ├── types.ts
│   │       │       ├── manager.ts
│   │       │       └── compressor.ts
│   │       └── agent/              # 子 Agent (Worker)
│   │           ├── types.ts
│   │           ├── worker.ts
│   │           └── loop.ts
│   │
│   ├── server/                     # @code-agent/server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            # 入口
│   │       ├── config.ts           # 环境变量 + 配置
│   │       ├── gateway/
│   │       │   ├── server.ts       # Fastify 实例
│   │       │   ├── routes/
│   │       │   │   ├── sessions.ts
│   │       │   │   └── tools.ts
│   │       │   ├── ws/
│   │       │   │   └── chat.ts
│   │       │   └── middleware/
│   │       │       └── error.ts
│   │       ├── orchestrator/
│   │       │   ├── types.ts
│   │       │   ├── state.ts
│   │       │   ├── graph.ts
│   │       │   └── nodes/
│   │       │       ├── planner.ts
│   │       │       ├── dispatcher.ts
│   │       │       └── summarizer.ts
│   │       └── db/
│   │           ├── connection.ts
│   │           ├── schema.ts
│   │           └── repositories/
│   │               ├── sessions.ts
│   │               └── messages.ts
│   │
│   └── web/                        # @code-agent/web
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── components/
│           │   ├── Sidebar.tsx
│           │   ├── ChatArea.tsx
│           │   ├── MessageList.tsx
│           │   ├── TextMessage.tsx
│           │   ├── ToolCallCard.tsx
│           │   ├── ConfirmCard.tsx
│           │   └── InputBar.tsx
│           ├── hooks/
│           │   ├── useWebSocket.ts
│           │   └── useSessions.ts
│           └── stores/
│               └── chatStore.ts
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

### tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

### 根 package.json scripts

```json
{
  "scripts": {
    "dev": "pnpm --parallel -r dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  }
}
```

---

## 三、LLM 抽象层

### 3.1 设计思路

LangChain.js 提供了 `BaseChatModel` 统一接口和 `@langchain/openai`、`@langchain/anthropic` 等官方适配器。本层不做新的抽象，而是在 LangChain 之上做**配置工厂 + 协议检测 + 重试**三个增强。

### 3.2 依赖

```json
{
  "@langchain/core": "^0.3",
  "@langchain/openai": "^0.3",
  "@langchain/anthropic": "^0.3"
}
```

### 3.3 类型定义 — `packages/core/src/llm/types.ts`

```typescript
import type { BaseMessage, BaseMessageChunk, ToolCall } from "@langchain/core/messages";

export type ModelProvider = 'openai' | 'anthropic' | 'openai-compatible';

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  baseURL?: string;
  maxRetries?: number;
  temperature?: number;
}

export interface ChatOptions {
  tools?: any[];            // LangChain StructuredTool[]
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface UnifiedResponse {
  role: 'assistant';
  content: string | null;
  toolCalls: ToolCall[] | null;
}

export interface StreamChunk {
  type: 'text' | 'tool_call';
  content?: string;
  toolCall?: Partial<ToolCall>;
}
```

### 3.4 工厂函数 — `packages/core/src/llm/factory.ts`

```typescript
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { ModelConfig } from "./types.js";

export function createChatModel(config: ModelConfig): BaseChatModel {
  const { provider, model, apiKey, baseURL, maxRetries = 3, temperature = 0.7 } = config;

  switch (provider) {
    case "openai":
    case "openai-compatible":
      return new ChatOpenAI({
        model,
        apiKey,
        temperature,
        maxRetries,
        configuration: baseURL ? { baseURL } : undefined,
      });

    case "anthropic":
      return new ChatAnthropic({
        model,
        apiKey,
        temperature,
        maxRetries,
        clientOptions: baseURL ? { baseURL } : undefined,
      });

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
```

### 3.5 协议检测 — `packages/core/src/llm/protocol.ts`

```typescript
export type DetectedProtocol = 'openai' | 'anthropic' | 'unknown';

export async function detectProtocol(baseURL: string): Promise<DetectedProtocol> {
  try {
    const res = await fetch(`${baseURL}/v1/models`, {
      headers: { 'Authorization': 'Bearer test' }
    });

    // Anthropic 的 models 端点返回特征头
    if (res.headers.get('anthropic-version')) {
      return 'anthropic';
    }

    // OpenAI 兼容协议返回标准 JSON
    const body = await res.json();
    if (body && (body.data || body.object === 'list')) {
      return 'openai';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}
```

### 3.6 重试 — `packages/core/src/llm/retry.ts`

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      if (attempt === maxRetries) throw error;

      // 仅对可重试错误重试：rate limit、5xx
      const status = error?.status ?? error?.response?.status;
      if (status === 429 || (status && status >= 500)) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error("unreachable");
}
```

> 注意：实际上 LangChain 自带的 `maxRetries` 参数（配置在 ChatOpenAI/ChatAnthropic 构造器中）已处理大部分重试场景。`withRetry` 作为补充，用于处理 LangChain 未覆盖的边缘情况。

---

## 四、Agent Runtime（Harness 层）

### 4.1 权限沙箱

#### 类型定义 — `packages/core/src/harness/sandbox/types.ts`

```typescript
export type PermissionLevel = 'safe' | 'confirm' | 'deny';

export interface AgentCapability {
  tools: string[];            // 允许的工具名称列表
  paths: string[];            // 允许的文件系统路径
  maxTokens?: number;
  timeoutMs?: number;
}

export interface PermissionResult {
  allowed: boolean;
  level: PermissionLevel;
  reason?: string;
}

export interface ToolPermission {
  toolName: string;
  defaultLevel: PermissionLevel;
  /** 可选的参数校验函数 */
  validateArgs?: (args: Record<string, unknown>, capability: AgentCapability) => PermissionResult;
}
```

#### 权限注册表 — `packages/core/src/harness/sandbox/registry.ts`

```typescript
import type { PermissionLevel, ToolPermission, AgentCapability, PermissionResult } from "./types.js";

export class PermissionRegistry {
  private permissions = new Map<string, ToolPermission>();

  register(tp: ToolPermission): void {
    this.permissions.set(tp.toolName, tp);
  }

  get(toolName: string): ToolPermission | undefined {
    return this.permissions.get(toolName);
  }

  /** 初始化内置工具的权限注册 */
  static createDefault(): PermissionRegistry {
    const registry = new PermissionRegistry();

    registry.register({ toolName: "file.read",    defaultLevel: "safe" });
    registry.register({ toolName: "file.write",   defaultLevel: "confirm" });
    registry.register({ toolName: "file.list",    defaultLevel: "safe" });
    registry.register({ toolName: "file.search",  defaultLevel: "safe" });
    registry.register({ toolName: "shell.exec",   defaultLevel: "confirm" });
    registry.register({ toolName: "code_search",  defaultLevel: "safe" });
    registry.register({ toolName: "git.status",   defaultLevel: "safe" });
    registry.register({ toolName: "git.diff",     defaultLevel: "safe" });
    registry.register({ toolName: "git.log",      defaultLevel: "safe" });
    registry.register({ toolName: "git.commit",   defaultLevel: "confirm" });
    registry.register({ toolName: "git.branch",   defaultLevel: "confirm" });
    registry.register({ toolName: "web.fetch",    defaultLevel: "safe" });

    return registry;
  }
}
```

#### 沙箱守卫 — `packages/core/src/harness/sandbox/guard.ts`

```typescript
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { AgentAction } from "@langchain/core/agents";
import type { AgentCapability, PermissionLevel, PermissionResult } from "./types.js";
import { PermissionRegistry } from "./registry.js";

/** Shell 高危命令模式 */
const DENY_PATTERNS = [
  /rm\s+(-[rRf]+\s+)*(\/|\/.*)/,    // rm -rf /...
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bchown\b/,
  /\bdd\s+if=/,
  /\bmkfs\./,
  />\s*\/dev\//,
  /\bcurl\b.*\|\s*(ba)?sh\b/,       // curl | bash
];

export class SandboxGuard extends BaseCallbackHandler {
  name = "SandboxGuard";

  constructor(
    private capability: AgentCapability,
    private registry: PermissionRegistry = PermissionRegistry.createDefault(),
  ) {
    super();
  }

  check(toolName: string, args: Record<string, unknown>): PermissionResult {
    // 1. 检查 Agent 是否声明了该工具
    if (!this.capability.tools.includes(toolName)) {
      return {
        allowed: false,
        level: "deny",
        reason: `Tool "${toolName}" not in agent capability`,
      };
    }

    // 2. 获取工具的权限定义
    const tp = this.registry.get(toolName);
    if (!tp) {
      return {
        allowed: false,
        level: "deny",
        reason: `Tool "${toolName}" not registered`,
      };
    }

    // 3. Shell 命令高危模式检测
    if (toolName === "shell.exec") {
      const command = String(args.command ?? args.cmd ?? "");
      for (const pattern of DENY_PATTERNS) {
        if (pattern.test(command)) {
          return {
            allowed: false,
            level: "deny",
            reason: `Dangerous command pattern detected: ${command}`,
          };
        }
      }
    }

    // 4. 路径约束：涉及文件路径的工具，校验路径前缀
    if (this.capability.paths.length > 0 && args.path) {
      const targetPath = String(args.path);
      const allowed = this.capability.paths.some(p => targetPath.startsWith(p));
      if (!allowed) {
        return {
          allowed: false,
          level: "deny",
          reason: `Path "${targetPath}" is outside allowed paths: ${this.capability.paths.join(', ')}`,
        };
      }
    }

    // 5. 自定义参数校验
    if (tp.validateArgs) {
      const customResult = tp.validateArgs(args, this.capability);
      if (!customResult.allowed) return customResult;
    }

    return { allowed: true, level: tp.defaultLevel };
  }

  /** 通过 LangChain callback 在工具执行前拦截 */
  async handleAgentAction(action: AgentAction): Promise<void> {
    const result = this.check(action.tool, action.toolInput as Record<string, unknown>);

    if (result.level === "deny") {
      throw new Error(`[SandboxGuard] DENY: ${result.reason}`);
    }

    if (result.level === "confirm") {
      // 触发审批流程，抛出可恢复的错误
      throw new ConfirmRequiredError(action.tool, action.toolInput, result.reason);
    }
  }
}

export class ConfirmRequiredError extends Error {
  constructor(
    public toolName: string,
    public args: Record<string, unknown>,
    reason?: string,
  ) {
    super(`[ConfirmRequired] ${toolName}: ${reason ?? "requires user approval"}`);
    this.name = "ConfirmRequiredError";
  }
}
```

### 4.2 Hooks 引擎

#### 类型定义 — `packages/core/src/harness/hooks/types.ts`

```typescript
export type HookEvent =
  | 'agent:start'
  | 'agent:end'
  | 'tool:before'
  | 'tool:after'
  | 'agent:error'
  | 'message:send'
  | 'message:receive';

export interface HookContext {
  event: HookEvent;
  agentId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface HookResult {
  /** 修改后的工具参数（tool:before 时可用） */
  modifiedArgs?: Record<string, unknown>;
  /** 修改后的工具执行结果（tool:after 时可用） */
  modifiedResult?: string;
  /** 是否阻止后续执行（tool:before 返回 true 则跳过实际执行） */
  skip?: boolean;
}

export type HookHandler = (ctx: HookContext) => Promise<void | HookResult>;
```

#### 引擎 — `packages/core/src/harness/hooks/engine.ts`

```typescript
import type { HookEvent, HookHandler, HookContext, HookResult } from "./types.js";

export class HooksEngine {
  private handlers = new Map<HookEvent, HookHandler[]>();

  on(event: HookEvent, handler: HookHandler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  off(event: HookEvent, handler: HookHandler): void {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter(h => h !== handler));
  }

  /** 触发一个事件，返回合并后的 HookResult */
  async trigger(event: HookEvent, ctx: Partial<HookContext> = {}): Promise<HookResult> {
    const list = this.handlers.get(event) ?? [];
    const merged: HookResult = {};

    const fullCtx: HookContext = {
      event,
      agentId: ctx.agentId ?? "unknown",
      timestamp: new Date(),
      data: ctx.data ?? {},
    };

    for (const handler of list) {
      try {
        const result = await handler(fullCtx);
        if (result) {
          if (result.modifiedArgs)  merged.modifiedArgs  = { ...merged.modifiedArgs,  ...result.modifiedArgs };
          if (result.modifiedResult) merged.modifiedResult = result.modifiedResult;
          if (result.skip)           merged.skip           = true;
        }
      } catch (err) {
        console.error(`[HooksEngine] Handler error for ${event}:`, err);
      }
    }

    return merged;
  }
}
```

#### 内置 Hook：日志 — `packages/core/src/harness/hooks/builtins/logger.ts`

```typescript
import type { HookHandler } from "../types.js";

export function createLoggerHook(): HookHandler {
  return async (ctx) => {
    console.log(`[${ctx.timestamp.toISOString()}] [${ctx.event}] agent=${ctx.agentId}`, ctx.data);
  };
}
```

#### 内置 Hook：敏感信息过滤 — `packages/core/src/harness/hooks/builtins/secret-filter.ts`

```typescript
import type { HookHandler } from "../types.js";

const SECRET_PATTERNS = [
  /(?:sk|api[_-]?key|token|secret|password|bearer)\s*[:=]\s*['"]?[A-Za-z0-9_\-\.]{20,}['"]?/gi,
  /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/g,
];

function redact(text: string): string {
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return text;
}

export function createSecretFilterHook(): HookHandler {
  return async (ctx) => {
    // 过滤工具参数中的敏感信息
    if (ctx.data.args && typeof ctx.data.args === "object") {
      const args = ctx.data.args as Record<string, unknown>;
      for (const key of Object.keys(args)) {
        if (typeof args[key] === "string") {
          args[key] = redact(args[key] as string);
        }
      }
    }
    // 过滤工具结果中的敏感信息
    if (ctx.data.result && typeof ctx.data.result === "string") {
      ctx.data.result = redact(ctx.data.result as string);
    }
  };
}
```

### 4.3 上下文管理

#### 类型定义 — `packages/core/src/harness/context/types.ts`

```typescript
import type { BaseMessage } from "@langchain/core/messages";

export interface ContextWindow {
  maxTokens: number;
  currentTokens: number;
  threshold: number;          // 超过此比例触发压缩（如 0.8）
}

export interface AgentContext {
  sessionId: string;
  agentId: string;
  messages: BaseMessage[];    // 当前 Agent 的消息历史
  window: ContextWindow;
  summary?: string;           // 被压缩的旧消息摘要
}
```

#### 上下文管理器 — `packages/core/src/harness/context/manager.ts`

```typescript
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { AgentContext, ContextWindow } from "./types.js";
import { compressMessages } from "./compressor.js";

export class ContextManager {
  private contexts = new Map<string, AgentContext>();

  create(sessionId: string, agentId: string, window: Partial<ContextWindow> = {}): AgentContext {
    const ctx: AgentContext = {
      sessionId,
      agentId,
      messages: [],
      window: {
        maxTokens: window.maxTokens ?? 128_000,
        currentTokens: 0,
        threshold: window.threshold ?? 0.8,
      },
    };
    this.contexts.set(agentId, ctx);
    return ctx;
  }

  get(agentId: string): AgentContext | undefined {
    return this.contexts.get(agentId);
  }

  async addMessage(agentId: string, message: BaseMessage): Promise<void> {
    const ctx = this.contexts.get(agentId);
    if (!ctx) throw new Error(`Context not found for agent: ${agentId}`);

    ctx.messages.push(message);
    ctx.window.currentTokens = this.estimateTokens(ctx.messages);

    // 超过阈值触发压缩
    if (ctx.window.currentTokens > ctx.window.maxTokens * ctx.window.threshold) {
      ctx.summary = await compressMessages(ctx.messages, ctx.window.maxTokens);
    }
  }

  /** 为子 Agent 创建继承上下文（接收摘要，不继承完整历史） */
  inheritForSubAgent(
    parentAgentId: string,
    subAgentId: string,
    taskDescription: string,
    relevantContext: string,
  ): AgentContext {
    const parent = this.contexts.get(parentAgentId);
    const messages: BaseMessage[] = [];

    if (parent?.summary) {
      messages.push(new SystemMessage(`Previous context summary: ${parent.summary}`));
    }

    messages.push(new SystemMessage(relevantContext));
    messages.push(new HumanMessage(taskDescription));

    return this.create(parent?.sessionId ?? "", subAgentId);
  }

  /** 将工具调用结果注入上下文 */
  addToolResult(agentId: string, toolCallId: string, toolName: string, result: string): void {
    const ctx = this.contexts.get(agentId);
    if (!ctx) return;

    ctx.messages.push(new ToolMessage({
      tool_call_id: toolCallId,
      name: toolName,
      content: result,
    }));
  }

  delete(agentId: string): void {
    this.contexts.delete(agentId);
  }

  /** 简单 token 估算（按字符数 / 4，适用于中英文混合） */
  private estimateTokens(messages: BaseMessage[]): number {
    let chars = 0;
    for (const msg of messages) {
      chars += JSON.stringify(msg.content).length;
    }
    return Math.ceil(chars / 4);
  }
}
```

#### 上下文压缩 — `packages/core/src/harness/context/compressor.ts`

```typescript
import type { BaseMessage } from "@langchain/core/messages";

/**
 * 滑动窗口 + LLM 摘要的压缩策略：
 * 1. 保留最近 10 轮消息完整内容（保持当前对话连贯性）
 * 2. 对 10 轮之前的消息，用 LLM 生成滚动摘要
 * 3. 返回压缩后的消息列表
 *
 * 实现时将 "生成摘要" 的能力委托给调用方传入的 model，
 * 本身只负责窗口策略和裁剪逻辑。
 */
export interface CompressOptions {
  keepRecent: number;       // 保留最近 N 条消息
  maxTokens: number;
}

export async function compressMessages(
  messages: BaseMessage[],
  _maxTokens: number,
  options: Partial<CompressOptions> = {},
): Promise<string> {
  const { keepRecent = 20 } = options;

  if (messages.length <= keepRecent) {
    return summarize(messages);
  }

  const recent = messages.slice(-keepRecent);
  const old = messages.slice(0, -keepRecent);

  const oldSummary = summarize(old);
  const recentText = recent.map(m => `[${m.getType()}]: ${JSON.stringify(m.content)}`).join("\n");

  return `Summary of earlier messages:\n${oldSummary}\n\nRecent messages:\n${recentText}`;
}

/** 简单的基于文本抽取的摘要（完整实现中替换为 LLM 摘要） */
function summarize(messages: BaseMessage[]): string {
  return messages
    .slice(0, 5)
    .map(m => `[${m.getType()}]: ${String(m.content).slice(0, 200)}`)
    .join("\n");
}
```

---

## 五、工具层

### 5.1 依赖

```json
{
  "@langchain/core": "workspace:*",
  "zod": "^3"
}
```

### 5.2 工具基础接口 — `packages/core/src/tools/base.ts`

```typescript
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { StructuredTool } from "@langchain/core/tools";
import type { PermissionLevel } from "../harness/sandbox/types.js";

export interface ToolContext {
  workspacePath: string;
  sessionId: string;
}

export interface ToolDefinition<T extends z.ZodObject<any> = any> {
  name: string;
  description: string;
  schema: T;
  permission: PermissionLevel;
  execute(args: z.infer<T>, ctx: ToolContext): Promise<string>;
}

/** 将 ToolDefinition 包装为 LangChain StructuredTool */
export function createLangChainTool<T extends z.ZodObject<any>>(
  def: ToolDefinition<T>,
  ctx: ToolContext,
): StructuredTool {
  return new DynamicStructuredTool({
    name: def.name,
    description: def.description,
    schema: def.schema,
    func: async (args: z.infer<T>) => def.execute(args, ctx),
  });
}
```

### 5.3 工具注册表 — `packages/core/src/tools/registry.ts`

```typescript
import type { StructuredTool } from "@langchain/core/tools";
import type { ToolDefinition, ToolContext } from "./base.js";
import { createLangChainTool } from "./base.js";
import type { AgentCapability } from "../harness/sandbox/types.js";

export class ToolRegistry {
  private definitions = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): void {
    this.definitions.set(def.name, def);
  }

  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  /** 根据 Agent 的能力声明，返回其可用的 LangChain 工具实例 */
  getToolsForAgent(capability: AgentCapability, ctx: ToolContext): StructuredTool[] {
    const tools: StructuredTool[] = [];
    for (const toolName of capability.tools) {
      const def = this.definitions.get(toolName);
      if (def) {
        tools.push(createLangChainTool(def, ctx));
      }
    }
    return tools;
  }

  listAll(): ToolDefinition[] {
    return [...this.definitions.values()];
  }

  static createDefault(): ToolRegistry {
    // 工具实现在各子模块中注册
    const registry = new ToolRegistry();
    return registry;
  }
}
```

### 5.4 文件工具 — `packages/core/src/tools/file.ts`

```typescript
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolDefinition, ToolContext } from "./base.js";

function resolvePath(relativePath: string, ctx: ToolContext): string {
  const resolved = path.resolve(ctx.workspacePath, relativePath);
  if (!resolved.startsWith(ctx.workspacePath)) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
  return resolved;
}

export const fileReadTool: ToolDefinition = {
  name: "file.read",
  description: "Read file contents from the workspace",
  schema: z.object({ path: z.string().describe("File path relative to workspace") }),
  permission: "safe",
  async execute(args, ctx) {
    const fullPath = resolvePath(args.path, ctx);
    return await fs.readFile(fullPath, "utf-8");
  },
};

export const fileWriteTool: ToolDefinition = {
  name: "file.write",
  description: "Write content to a file in the workspace. Creates parent directories if needed.",
  schema: z.object({
    path: z.string().describe("File path relative to workspace"),
    content: z.string().describe("Content to write"),
  }),
  permission: "confirm",
  async execute(args, ctx) {
    const fullPath = resolvePath(args.path, ctx);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, args.content, "utf-8");
    return `File written: ${args.path}`;
  },
};

export const fileListTool: ToolDefinition = {
  name: "file.list",
  description: "List files and directories in a workspace path",
  schema: z.object({ path: z.string().default(".").describe("Directory path relative to workspace") }),
  permission: "safe",
  async execute(args, ctx) {
    const fullPath = resolvePath(args.path, ctx);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    return entries.map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
  },
};
```

### 5.5 Shell 工具 — `packages/core/src/tools/shell.ts`

```typescript
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolContext } from "./base.js";

const execAsync = promisify(exec);

const ALLOWED_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "find", "grep", "echo",
  "mkdir", "touch", "cp", "mv", "git", "npm", "npx", "pnpm",
  "node", "tsx", "which", "pwd", "whoami", "uname", "env",
]);

export const shellExecTool: ToolDefinition = {
  name: "shell.exec",
  description: "Execute a shell command. Only whitelisted commands are allowed.",
  schema: z.object({
    command: z.string().describe("The shell command to execute"),
    cwd: z.string().optional().describe("Working directory relative to workspace"),
  }),
  permission: "confirm",
  async execute(args, ctx) {
    const baseCmd = args.command.trim().split(/\s+/)[0];
    if (!ALLOWED_COMMANDS.has(baseCmd)) {
      return `Command "${baseCmd}" is not in the allowed list. Allowed commands: ${[...ALLOWED_COMMANDS].join(", ")}`;
    }

    const cwd = args.cwd ? path.resolve(ctx.workspacePath, args.cwd) : ctx.workspacePath;

    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd,
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout + (stderr ? `\n[stderr]\n${stderr}` : "");
    } catch (error: any) {
      return `Command failed (exit code ${error.code}): ${error.stderr || error.message}`;
    }
  },
};
```

### 5.6 代码搜索工具 — `packages/core/src/tools/search.ts`

```typescript
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolContext } from "./base.js";

const execAsync = promisify(exec);

export const codeSearchTool: ToolDefinition = {
  name: "code_search",
  description: "Search code in the workspace using grep. Supports regex patterns.",
  schema: z.object({
    pattern: z.string().describe("Search pattern (regex supported)"),
    path: z.string().default(".").describe("Directory to search in"),
    fileTypes: z.string().optional().describe("Comma-separated file extensions, e.g. '.ts,.tsx'"),
    maxResults: z.number().default(20).describe("Maximum number of results"),
  }),
  permission: "safe",
  async execute(args, ctx) {
    const includeFlag = args.fileTypes
      ? `--include='*.${args.fileTypes.replace(/,/g, " --include='*.")}'`
      : "";

    try {
      const { stdout } = await execAsync(
        `grep -rn --color=never ${includeFlag} -m ${args.maxResults} '${args.pattern}' '${args.path}'`,
        { cwd: ctx.workspacePath, timeout: 10_000, maxBuffer: 5 * 1024 * 1024 },
      );
      return stdout || "No matches found.";
    } catch (error: any) {
      // grep returns exit 1 when no matches
      if (error.code === 1) return "No matches found.";
      throw error;
    }
  },
};
```

### 5.7 Git 工具 — `packages/core/src/tools/git.ts`

```typescript
import { z } from "zod";
import { simpleGit } from "simple-git";
import type { ToolDefinition, ToolContext } from "./base.js";

function git(ctx: ToolContext) {
  return simpleGit(ctx.workspacePath);
}

export const gitStatusTool: ToolDefinition = {
  name: "git.status",
  description: "Show the working tree status",
  schema: z.object({}),
  permission: "safe",
  async execute(_args, ctx) {
    return await git(ctx).status().then(s => JSON.stringify(s, null, 2));
  },
};

export const gitDiffTool: ToolDefinition = {
  name: "git.diff",
  description: "Show changes between commits, commit and working tree, etc.",
  schema: z.object({
    staged: z.boolean().default(false).describe("Show staged changes only"),
  }),
  permission: "safe",
  async execute(args, ctx) {
    const g = git(ctx);
    return args.staged ? await g.diff(["--staged"]) : await g.diff();
  },
};

export const gitLogTool: ToolDefinition = {
  name: "git.log",
  description: "Show commit logs, max 20 entries",
  schema: z.object({
    maxCount: z.number().default(20).describe("Maximum number of commits"),
  }),
  permission: "safe",
  async execute(args, ctx) {
    const log = await git(ctx).log({ maxCount: args.maxCount });
    return log.all.map(c => `${c.hash.slice(0, 7)} ${c.date.slice(0, 10)} ${c.message}`).join("\n");
  },
};

export const gitCommitTool: ToolDefinition = {
  name: "git.commit",
  description: "Create a new commit with all staged changes",
  schema: z.object({
    message: z.string().describe("Commit message"),
  }),
  permission: "confirm",
  async execute(args, ctx) {
    const result = await git(ctx).commit(args.message);
    return `Committed: ${result.commit}`;
  },
};

export const gitBranchTool: ToolDefinition = {
  name: "git.branch",
  description: "List or create branches",
  schema: z.object({
    name: z.string().optional().describe("New branch name (creates if provided)"),
    checkout: z.boolean().default(false).describe("Checkout after creating"),
  }),
  permission: "confirm",
  async execute(args, ctx) {
    const g = git(ctx);
    if (args.name) {
      await g.checkoutLocalBranch(args.name);
      return `Created and switched to branch: ${args.name}`;
    }
    const branches = await g.branchLocal();
    return Object.keys(branches.branches).join("\n");
  },
};
```

### 5.8 Web 工具 — `packages/core/src/tools/web.ts`

```typescript
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./base.js";

export const webFetchTool: ToolDefinition = {
  name: "web.fetch",
  description: "Fetch content from a URL (GET only). Returns text content.",
  schema: z.object({
    url: z.string().describe("URL to fetch"),
    maxLength: z.number().default(50000).describe("Maximum response length in characters"),
  }),
  permission: "safe",
  async execute(args, _ctx) {
    const res = await fetch(args.url, {
      headers: { "User-Agent": "MyAgent/1.0" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });

    if (!res.ok) {
      return `HTTP ${res.status}: ${res.statusText}`;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/") && !contentType.includes("application/json")) {
      return `Cannot fetch binary content (${contentType}). Use this tool for text/JSON only.`;
    }

    const text = await res.text();
    if (text.length > args.maxLength) {
      return text.slice(0, args.maxLength) + `\n\n[Truncated, original length: ${text.length}]`;
    }
    return text;
  },
};
```

---

## 六、Agent 编排层

### 6.1 子 Agent (Worker)

#### 类型 — `packages/core/src/agent/types.ts`

```typescript
export interface WorkerInput {
  taskId: string;
  description: string;
  tools: string[];              // 允许的工具名称列表
  context: string;              // 来自主 Agent 的上下文摘要
  workspacePath: string;
  maxIterations?: number;
  timeoutMs?: number;
}

export type WorkerStatus = 'running' | 'success' | 'failed' | 'timeout' | 'awaiting_approval';

export interface WorkerOutput {
  taskId: string;
  status: WorkerStatus;
  result?: string;
  error?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
}
```

#### Worker Agent — `packages/core/src/agent/worker.ts`

```typescript
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { WorkerInput, WorkerOutput } from "./types.js";
import { ToolRegistry } from "../tools/registry.js";
import { SandboxGuard, ConfirmRequiredError } from "../harness/sandbox/guard.js";
import { HooksEngine } from "../harness/hooks/engine.js";
import { ContextManager } from "../harness/context/manager.js";
import type { AgentCapability } from "../harness/sandbox/types.js";

export class WorkerAgent {
  private contextManager: ContextManager;
  private hooksEngine: HooksEngine;

  constructor(
    private model: BaseChatModel,
    private toolRegistry: ToolRegistry,
  ) {
    this.contextManager = new ContextManager();
    this.hooksEngine = new HooksEngine();
  }

  async run(input: WorkerInput): Promise<WorkerOutput> {
    const capability: AgentCapability = {
      tools: input.tools,
      paths: [input.workspacePath],
      timeoutMs: input.timeoutMs,
    };

    // 1. 创建子 Agent 独立上下文
    const ctx = this.contextManager.create(
      `session-${input.taskId}`,
      `agent-${input.taskId}`,
    );

    // 2. 获取受限工具集
    const tools = this.toolRegistry.getToolsForAgent(capability, {
      workspacePath: input.workspacePath,
      sessionId: `session-${input.taskId}`,
    });

    // 3. 权限守卫
    const guard = new SandboxGuard(capability);

    // 4. 构建 Agent
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", this.buildSystemPrompt()],
      ["human", "{input}"],
      ["placeholder", "{agent_scratchpad}"],
    ]);

    const agent = createToolCallingAgent({
      llm: this.model,
      tools,
      prompt,
    });

    const executor = AgentExecutor.fromAgentAndTools({
      agent,
      tools,
      callbacks: [guard],  // LangChain callback 体系 —— 每次 tool call 被 guard 拦截
      maxIterations: input.maxIterations ?? 15,
      verbose: false,
    });

    // 5. 触发 hook: agent:start
    await this.hooksEngine.trigger("agent:start", {
      agentId: `agent-${input.taskId}`,
      data: { task: input.description },
    });

    // 6. 执行（带超时控制）
    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), input.timeoutMs ?? 60_000);

      const result = await executor.invoke({
        input: `${input.context}\n\nTask: ${input.description}`,
      }, {
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      await this.hooksEngine.trigger("agent:end", {
        agentId: `agent-${input.taskId}`,
        data: { result: result.output },
      });

      return {
        taskId: input.taskId,
        status: "success",
        result: result.output,
      };
    } catch (error: any) {
      if (error instanceof ConfirmRequiredError) {
        return {
          taskId: input.taskId,
          status: "awaiting_approval",
          error: error.message,
        };
      }

      if (error.name === "AbortError") {
        await this.hooksEngine.trigger("agent:error", {
          agentId: `agent-${input.taskId}`,
          data: { error: "timeout" },
        });
        return { taskId: input.taskId, status: "timeout", error: "Task timeout" };
      }

      await this.hooksEngine.trigger("agent:error", {
        agentId: `agent-${input.taskId}`,
        data: { error: error.message },
      });

      return { taskId: input.taskId, status: "failed", error: error.message };
    } finally {
      this.contextManager.delete(`agent-${input.taskId}`);
    }
  }

  private buildSystemPrompt(): string {
    return `You are a specialized worker agent. Your task is to complete the assigned subtask using the available tools.

Rules:
- You do NOT interact with the user directly. Only use tools and return results.
- Stay within the scope of the assigned task.
- If a tool fails, try an alternative approach or report the failure.
- All file paths are relative to the assigned workspace.`;
  }
}
```

### 6.2 主 Agent (Orchestrator) — LangGraph 实现

#### 状态定义 — `packages/server/src/orchestrator/state.ts`

```typescript
import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { WorkerOutput } from "@code-agent/core";

export interface SubTask {
  id: string;
  description: string;
  tools: string[];
  dependsOn?: string[];
}

export const OrchestratorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  plan: Annotation<SubTask[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  completedTasks: Annotation<Record<string, WorkerOutput>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  pendingTasks: Annotation<SubTask[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  finalResponse: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),
  nextAction: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),
});
```

#### 节点：计划器 — `packages/server/src/orchestrator/nodes/planner.ts`

```typescript
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { SubTask } from "../types.js";

const PLANNER_SYSTEM_PROMPT = `You are an AI orchestrator. Analyze the user's request and break it down into subtasks.

Output a JSON array of subtasks, each with:
- id: unique string identifier
- description: detailed description of what this subtask should accomplish
- tools: array of tool names the subtask needs (choose from: file.read, file.write, file.list, shell.exec, code_search, git.status, git.diff, git.log, git.commit, git.branch, web.fetch)
- dependsOn: array of subtask IDs this task depends on (empty array if independent)

Rules:
- Make subtasks as independent as possible to allow parallel execution.
- Only declare dependencies when output from one task is required by another.
- Each subtask should be focused and well-defined.`;

export async function plannerNode(
  state: { messages: any[] },
  model: BaseChatModel,
): Promise<{ plan: SubTask[]; pendingTasks: SubTask[] }> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userInput = typeof lastMessage.content === "string"
    ? lastMessage.content
    : JSON.stringify(lastMessage.content);

  const response = await model.invoke([
    new SystemMessage(PLANNER_SYSTEM_PROMPT),
    new HumanMessage(`User request: ${userInput}\n\nGenerate the subtask plan as JSON:`),
  ]);

  const content = typeof response.content === "string" ? response.content : "";
  // 提取 JSON 数组（处理模型可能包裹在 markdown code block 中）
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  const plan: SubTask[] = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

  return {
    plan,
    pendingTasks: plan,
  };
}
```

#### 节点：派发器 — `packages/server/src/orchestrator/nodes/dispatcher.ts`

```typescript
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { SubTask } from "../types.js";
import type { WorkerOutput } from "@code-agent/core";
import { WorkerAgent, ToolRegistry } from "@code-agent/core";

export async function dispatcherNode(
  state: {
    pendingTasks: SubTask[];
    completedTasks: Record<string, WorkerOutput>;
  },
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
): Promise<{
  completedTasks: Record<string, WorkerOutput>;
  pendingTasks: SubTask[];
  nextAction: string;
}> {
  const { pendingTasks, completedTasks } = state;

  if (pendingTasks.length === 0) {
    return { completedTasks: {}, pendingTasks: [], nextAction: "summarize" };
  }

  // 分类：可并行执行的任务（依赖已满足）vs 需等待的任务
  const ready: SubTask[] = [];
  const waiting: SubTask[] = [];

  for (const task of pendingTasks) {
    const deps = task.dependsOn ?? [];
    const allDepsCompleted = deps.every(depId => completedTasks[depId]?.status === "success");

    if (allDepsCompleted) {
      ready.push(task);
    } else {
      waiting.push(task);
    }
  }

  if (ready.length === 0 && waiting.length > 0) {
    // 所有剩余任务都在等待依赖完成（不应出现，除非依赖的 subtask 失败了）
    return { completedTasks: {}, pendingTasks: waiting, nextAction: "continue" };
  }

  // 并行执行所有就绪的子任务
  const results = await Promise.all(
    ready.map(async (task) => {
      const worker = new WorkerAgent(model, toolRegistry);
      const depsContext = (task.dependsOn ?? [])
        .map(depId => completedTasks[depId]?.result)
        .filter(Boolean)
        .join("\n\n");

      return worker.run({
        taskId: task.id,
        description: task.description,
        tools: task.tools,
        context: depsContext,
        workspacePath,
        timeoutMs: 60_000,
      });
    }),
  );

  const newCompleted: Record<string, WorkerOutput> = {};
  for (const result of results) {
    newCompleted[result.taskId] = result;
  }

  // waiting task 和可能还有更多就绪任务 → 继续循环
  const next = waiting.length > 0 ? "continue" : "summarize";

  return {
    completedTasks: newCompleted,
    pendingTasks: waiting,
    nextAction: next,
  };
}
```

#### 节点：汇总器 — `packages/server/src/orchestrator/nodes/summarizer.ts`

```typescript
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { WorkerOutput } from "@code-agent/core";

const SUMMARIZER_SYSTEM_PROMPT = `You are an AI orchestrator. Synthesize the results from multiple worker agents into a coherent response for the user.

Guidelines:
- Present findings clearly using markdown formatting.
- If all workers succeeded, present the complete results.
- If some workers failed, explain what went wrong and what was accomplished.
- Be concise but thorough.`;

export async function summarizerNode(
  state: {
    messages: any[];
    completedTasks: Record<string, WorkerOutput>;
  },
  model: BaseChatModel,
): Promise<{ finalResponse: string }> {
  const { completedTasks } = state;

  const taskSummaries = Object.entries(completedTasks)
    .map(([id, output]) => {
      const icon = output.status === "success" ? "✅" : "❌";
      return `${icon} **${id}**: ${output.result ?? output.error}`;
    })
    .join("\n\n");

  const originalRequest = state.messages[state.messages.length - 1];

  const response = await model.invoke([
    new SystemMessage(SUMMARIZER_SYSTEM_PROMPT),
    new HumanMessage(
      `Original user request: ${JSON.stringify(originalRequest.content)}\n\nWorker results:\n${taskSummaries}\n\nPlease synthesize a final response.`,
    ),
  ]);

  return {
    finalResponse: typeof response.content === "string" ? response.content : "",
  };
}
```

#### LangGraph 状态图 — `packages/server/src/orchestrator/graph.ts`

```typescript
import { StateGraph, END } from "@langchain/langgraph";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { OrchestratorState } from "./state.js";
import { ToolRegistry } from "@code-agent/core";
import { plannerNode } from "./nodes/planner.js";
import { dispatcherNode } from "./nodes/dispatcher.js";
import { summarizerNode } from "./nodes/summarizer.js";

export function createOrchestratorGraph(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
) {
  const graph = new StateGraph(OrchestratorState)
    // 添加节点
    .addNode("planner", async (state) => {
      return plannerNode(state, model);
    })
    .addNode("dispatcher", async (state) => {
      return dispatcherNode(state, model, toolRegistry, workspacePath);
    })
    .addNode("summarizer", async (state) => {
      return summarizerNode(state, model);
    })
    // 边
    .addEdge("__start__", "planner")
    .addEdge("planner", "dispatcher")
    .addConditionalEdges("dispatcher", (state) => state.nextAction, {
      continue: "dispatcher",
      summarize: "summarizer",
    })
    .addEdge("summarizer", END);

  return graph.compile();
}
```

#### 编排调度逻辑总结

```
用户消息
  │
  ▼
planner ──→ 生成 SubTask[]
  │
  ▼
dispatcher ──→ 无依赖任务 → Promise.all 并行派发 WorkerAgent
  │              有依赖任务 → 等前置完成
  │              子任务完成 → 写入 completedTasks
  │
  │ pendingTasks.length > 0?
  │   ├─ yes → 回到 dispatcher (continue)
  │   └─ no  → summarizer
  │
  ▼
summarizer ──→ 汇总所有 Worker 结果 → 最终回复
```

---

## 七、API Gateway

### 7.1 依赖

```json
{
  "fastify": "^5",
  "@fastify/websocket": "^11",
  "@fastify/cors": "^10",
  "@fastify/env": "^5",
  "zod": "^3"
}
```

### 7.2 Fastify 服务 — `packages/server/src/gateway/server.ts`

```typescript
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import { createChatWebSocket } from "./ws/chat.js";
import { sessionRoutes } from "./routes/sessions.js";
import { toolRoutes } from "./routes/tools.js";
import { errorHandler } from "./middleware/error.js";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ToolRegistry } from "@code-agent/core";

export interface AppOptions {
  model: BaseChatModel;
  toolRegistry: ToolRegistry;
  workspacePath: string;
}

export async function createServer(options: AppOptions) {
  const app = Fastify({ logger: true });

  // 插件注册
  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // 错误处理
  app.setErrorHandler(errorHandler);

  // HTTP 路由
  await app.register(sessionRoutes, { prefix: "/api" });
  await app.register(toolRoutes, { prefix: "/api" });

  // WebSocket
  await app.register(async (scope) => {
    scope.get("/api/sessions/:id/chat", { websocket: true }, createChatWebSocket(options));
  });

  return app;
}
```

### 7.3 WebSocket 聊天 — `packages/server/src/gateway/ws/chat.ts`

```typescript
import type { FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { HumanMessage } from "@langchain/core/messages";
import { createOrchestratorGraph } from "../../orchestrator/graph.js";
import type { AppOptions } from "../server.js";

interface WSMessage {
  type: "message";
  content: string;
}

interface ToolApproval {
  type: "approval";
  callId: string;
  approved: boolean;
}

// 维护待审批的工具调用
const pendingApprovals = new Map<string, {
  resolve: (approved: boolean) => void;
  ws: WebSocket;
}>();

export function createChatWebSocket(options: AppOptions) {
  return (socket: WebSocket, req: FastifyRequest) => {
    const sessionId = (req.params as any).id;
    const { model, toolRegistry, workspacePath } = options;

    const graph = createOrchestratorGraph(model, toolRegistry, workspacePath);

    socket.on("message", async (raw) => {
      try {
        const msg: WSMessage | ToolApproval = JSON.parse(raw.toString());

        // 审批回调
        if (msg.type === "approval") {
          const pending = pendingApprovals.get(msg.callId);
          if (pending) {
            pending.resolve(msg.approved);
            pendingApprovals.delete(msg.callId);
          }
          return;
        }

        // 用户消息
        if (msg.type === "message") {
          // 使用 streamEvents 流式推送每个节点的执行状态
          const stream = graph.streamEvents(
            { messages: [new HumanMessage(msg.content)] },
            { version: "v2" },
          );

          for await (const event of stream) {
            switch (event.event) {
              case "on_chat_model_stream":
                // LLM 流式输出 —— 推送文本增量
                const chunk = event.data?.chunk;
                if (chunk?.content) {
                  socket.send(JSON.stringify({
                    type: "text",
                    delta: typeof chunk.content === "string" ? chunk.content : "",
                  }));
                }
                break;

              case "on_tool_start":
                // 工具调用开始 —— 推送状态
                socket.send(JSON.stringify({
                  type: "tool_start",
                  tool: event.name,
                  args: event.data?.input,
                }));
                break;

              case "on_tool_end":
                // 工具调用结束
                socket.send(JSON.stringify({
                  type: "tool_end",
                  tool: event.name,
                  result: event.data?.output,
                }));
                break;

              case "on_chain_end":
                // 节点完成
                if (event.name === "summarizer") {
                  socket.send(JSON.stringify({
                    type: "done",
                    finalResponse: event.data?.output?.finalResponse,
                  }));
                }
                break;
            }
          }
        }
      } catch (error: any) {
        socket.send(JSON.stringify({
          type: "error",
          message: error.message,
        }));
      }
    });

    socket.on("close", () => {
      // 清理该 session 的待审批项
      for (const [callId, pending] of pendingApprovals) {
        if (pending.ws === socket) {
          pendingApprovals.delete(callId);
        }
      }
    });
  };
}
```

### 7.4 HTTP 路由

#### 会话管理 — `packages/server/src/gateway/routes/sessions.ts`

```typescript
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { SessionRepository } from "../../db/repositories/sessions.js";

const CreateSessionSchema = z.object({
  title: z.string().optional().default("New Chat"),
});

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const repo = new SessionRepository(app.db);

  app.post("/sessions", async (req, reply) => {
    const body = CreateSessionSchema.parse(req.body);
    const session = repo.create(body.title);
    reply.status(201).send(session);
  });

  app.get("/sessions", async (_req, reply) => {
    const sessions = repo.list();
    reply.send(sessions);
  });

  app.get("/sessions/:id/history", async (req, reply) => {
    const { id } = req.params as { id: string };
    const messages = repo.getMessages(id);
    reply.send(messages);
  });

  app.delete("/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    repo.delete(id);
    reply.status(204).send();
  });
};
```

#### 工具审批 — `packages/server/src/gateway/routes/tools.ts`

```typescript
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const ApproveSchema = z.object({
  approved: z.boolean(),
});

export const toolRoutes: FastifyPluginAsync = async (app) => {
  app.post("/tools/:callId/approve", async (req, reply) => {
    const { callId } = req.params as { callId: string };
    const body = ApproveSchema.parse(req.body);

    // 审批结果通过 WebSocket 的 pendingApprovals map 传递
    // 此处仅做日志记录
    req.log.info({ callId, approved: body.approved }, "Tool approval received");

    reply.send({ callId, approved: body.approved });
  });
};
```

### 7.5 全局错误处理 — `packages/server/src/gateway/middleware/error.ts`

```typescript
import type { FastifyError, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";

export function errorHandler(
  error: FastifyError | Error,
  _req: FastifyRequest,
  reply: FastifyReply,
) {
  // Zod 校验错误 → 400
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: "ValidationError",
      details: error.errors,
    });
  }

  // LLM 配置错误 → 503
  if (error.message.includes("API key") || error.message.includes("authentication")) {
    return reply.status(503).send({
      error: "ConfigurationError",
      message: "Model configuration error. Please check your API keys.",
    });
  }

  // 其余 → 500
  request.log.error(error);
  return reply.status(500).send({
    error: "InternalError",
    message: error.message,
  });
}
```

---

## 八、数据库

### 8.1 依赖

```json
{
  "better-sqlite3": "^11",
  "drizzle-orm": "^0.38",
  "drizzle-kit": "^0.30"
}
```

### 8.2 Schema — `packages/server/src/db/schema.ts`

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New Chat"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["human", "assistant", "system", "tool"] }).notNull(),
  content: text("content").notNull(),
  toolName: text("tool_name"),
  toolArgs: text("tool_args"),     // JSON string
  toolResult: text("tool_result"), // JSON string
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});
```

### 8.3 连接 — `packages/server/src/db/connection.ts`

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export function createDb(path: string = "./data/code-agent.db") {
  // 确保 data 目录存在
  const dir = path.split("/").slice(0, -1).join("/");
  if (dir) {
    import("node:fs").then(fs => fs.mkdirSync(dir, { recursive: true }));
  }

  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite);
}
```

### 8.4 Repository — `packages/server/src/db/repositories/sessions.ts`

```typescript
import { randomUUID } from "node:crypto";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { sessions, messages } from "../schema.js";
import { eq, desc } from "drizzle-orm";

export class SessionRepository {
  constructor(private db: BetterSQLite3Database) {}

  create(title: string) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.insert(sessions).values({ id, title, createdAt: now, updatedAt: now }).run();
    return { id, title, createdAt: now };
  }

  list() {
    return this.db.select().from(sessions).orderBy(desc(sessions.updatedAt)).all();
  }

  getMessages(sessionId: string) {
    return this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all();
  }

  addMessage(sessionId: string, msg: {
    role: "human" | "assistant" | "system" | "tool";
    content: string;
    toolName?: string;
    toolArgs?: string;
    toolResult?: string;
  }) {
    this.db.insert(messages).values({
      sessionId,
      role: msg.role,
      content: msg.content,
      toolName: msg.toolName,
      toolArgs: msg.toolArgs,
      toolResult: msg.toolResult,
      createdAt: new Date().toISOString(),
    }).run();

    // 更新 session 时间戳
    this.db.update(sessions)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  delete(sessionId: string) {
    this.db.delete(messages).where(eq(messages.sessionId, sessionId)).run();
    this.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  }
}
```

---

## 九、Web 聊天界面

### 9.1 依赖

```json
{
  "react": "^19",
  "react-dom": "^19",
  "react-markdown": "^9",
  "remark-gfm": "^4",
  "shiki": "^1",
  "tailwindcss": "^4",
  "@tailwindcss/vite": "^4",
  "vite": "^7",
  "@vitejs/plugin-react": "^4"
}
```

### 9.2 WebSocket Hook — `packages/web/src/hooks/useWebSocket.ts`

```typescript
import { useEffect, useRef, useState, useCallback } from "react";

export type WSStatus = "connecting" | "connected" | "disconnected";

export interface WSMessage {
  type: "text" | "tool_start" | "tool_end" | "done" | "error";
  delta?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  finalResponse?: string;
  message?: string;
}

interface UseWebSocketOptions {
  sessionId: string;
  onMessage: (msg: WSMessage) => void;
}

export function useWebSocket({ sessionId, onMessage }: UseWebSocketOptions) {
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/sessions/${sessionId}/chat`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("disconnected");

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        onMessageRef.current(msg);
      } catch {
        // ignore malformed
      }
    };

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const send = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "message", content }));
    }
  }, []);

  const approve = useCallback((callId: string, approved: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "approval", callId, approved }));
    }
  }, []);

  return { status, send, approve };
}
```

### 9.3 聊天状态管理 — `packages/web/src/stores/chatStore.ts`

```typescript
import { useReducer, useCallback } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming: boolean;
  toolCalls: ToolCallState[];
}

export interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "running" | "done" | "error" | "awaiting_approval";
}

type Action =
  | { type: "ADD_USER_MESSAGE"; content: string }
  | { type: "ADD_ASSISTANT_MESSAGE" }
  | { type: "APPEND_TEXT"; delta: string }
  | { type: "TOOL_START"; tool: string; args: Record<string, unknown> }
  | { type: "TOOL_END"; tool: string; result: string }
  | { type: "DONE"; finalResponse: string }
  | { type: "ERROR"; message: string };

function reducer(state: Message[], action: Action): Message[] {
  switch (action.type) {
    case "ADD_USER_MESSAGE":
      return [...state, {
        id: crypto.randomUUID(),
        role: "user",
        content: action.content,
        isStreaming: false,
        toolCalls: [],
      }];

    case "ADD_ASSISTANT_MESSAGE":
      return [...state, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: true,
        toolCalls: [],
      }];

    case "APPEND_TEXT": {
      const updated = [...state];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant") {
        updated[updated.length - 1] = { ...last, content: last.content + action.delta };
      }
      return updated;
    }

    case "TOOL_START": {
      const updated = [...state];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          toolCalls: [...last.toolCalls, {
            id: crypto.randomUUID(),
            name: action.tool,
            args: action.args,
            status: "running",
          }],
        };
      }
      return updated;
    }

    case "TOOL_END": {
      const updated = [...state];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          toolCalls: last.toolCalls.map(tc =>
            tc.name === action.tool ? { ...tc, result: action.result, status: "done" as const } : tc,
          ),
        };
      }
      return updated;
    }

    case "DONE": {
      const updated = [...state];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          content: action.finalResponse || last.content,
          isStreaming: false,
        };
      }
      return updated;
    }

    case "ERROR": {
      const updated = [...state];
      const last = updated[updated.length - 1];
      if (last && last.role === "assistant") {
        updated[updated.length - 1] = {
          ...last,
          content: last.content + `\n\n❌ Error: ${action.message}`,
          isStreaming: false,
        };
      }
      return updated;
    }

    default:
      return state;
  }
}

export function useChatStore() {
  const [messages, dispatch] = useReducer(reducer, []);

  const sendMessage = useCallback((_content: string) => {
    // 实际发送在组件中通过 ws.send() 完成
    // 这里只更新本地状态
  }, []);

  return { messages, dispatch };
}
```

### 9.4 核心组件

#### App — `packages/web/src/App.tsx`

```typescript
import { useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { ChatArea } from "./components/ChatArea.js";

export default function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <Sidebar
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
      />
      <ChatArea sessionId={activeSessionId} />
    </div>
  );
}
```

#### ChatArea — `packages/web/src/components/ChatArea.tsx`

```typescript
import { useCallback, useRef, useEffect } from "react";
import { useWebSocket, type WSMessage } from "../hooks/useWebSocket.js";
import { useChatStore } from "../stores/chatStore.js";
import { MessageList } from "./MessageList.js";
import { InputBar } from "./InputBar.js";

interface Props {
  sessionId: string | null;
}

export function ChatArea({ sessionId }: Props) {
  const { messages, dispatch } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const onMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case "text":
        dispatch({ type: "APPEND_TEXT", delta: msg.delta ?? "" });
        break;
      case "tool_start":
        dispatch({ type: "TOOL_START", tool: msg.tool!, args: msg.args! });
        break;
      case "tool_end":
        dispatch({ type: "TOOL_END", tool: msg.tool!, result: msg.result! });
        break;
      case "done":
        dispatch({ type: "DONE", finalResponse: msg.finalResponse! });
        break;
      case "error":
        dispatch({ type: "ERROR", message: msg.message! });
        break;
    }
  }, [dispatch]);

  const { status, send, approve } = useWebSocket({
    sessionId: sessionId ?? "",
    onMessage,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (content: string) => {
    dispatch({ type: "ADD_USER_MESSAGE", content });
    dispatch({ type: "ADD_ASSISTANT_MESSAGE" });
    send(content);
  };

  if (!sessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        Select or create a session to start
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <MessageList messages={messages} onApprove={approve} />
      <div ref={messagesEndRef} />
      <InputBar onSend={handleSend} disabled={status !== "connected"} />
    </div>
  );
}
```

#### MessageList — `packages/web/src/components/MessageList.tsx`

```typescript
import type { Message } from "../stores/chatStore.js";
import { TextMessage } from "./TextMessage.js";
import { ToolCallCard } from "./ToolCallCard.js";
import { ConfirmCard } from "./ConfirmCard.js";

interface Props {
  messages: Message[];
  onApprove: (callId: string, approved: boolean) => void;
}

export function MessageList({ messages, onApprove }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[80%] ${msg.role === "user" ? "bg-blue-600" : "bg-gray-800"} rounded-lg p-4`}>
            <TextMessage content={msg.content} isStreaming={msg.isStreaming} />

            {msg.toolCalls.map((tc) => (
              <div key={tc.id} className="mt-2">
                {tc.status === "awaiting_approval" ? (
                  <ConfirmCard
                    toolName={tc.name}
                    args={tc.args}
                    onApprove={(approved) => onApprove(tc.id, approved)}
                  />
                ) : (
                  <ToolCallCard name={tc.name} args={tc.args} result={tc.result} status={tc.status} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

#### TextMessage — `packages/web/src/components/TextMessage.tsx`

```typescript
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
  isStreaming: boolean;
}

export function TextMessage({ content, isStreaming }: Props) {
  return (
    <div className="prose prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1" />}
    </div>
  );
}
```

#### ToolCallCard — `packages/web/src/components/ToolCallCard.tsx`

```typescript
interface Props {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "running" | "done" | "error";
}

const STATUS_ICONS: Record<Props["status"], string> = {
  running: "⏳",
  done: "✅",
  error: "❌",
};

export function ToolCallCard({ name, args, result, status }: Props) {
  return (
    <div className="border border-gray-700 rounded p-2 mt-2 text-sm">
      <div className="flex items-center gap-2 text-gray-400">
        <span>{STATUS_ICONS[status]}</span>
        <span className="font-mono text-blue-400">{name}</span>
        <span className="text-gray-500">{truncate(JSON.stringify(args), 80)}</span>
      </div>
      {result && status === "done" && (
        <pre className="mt-1 text-gray-300 text-xs overflow-x-auto max-h-32">
          {truncate(result, 500)}
        </pre>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
```

#### ConfirmCard — `packages/web/src/components/ConfirmCard.tsx`

```typescript
interface Props {
  toolName: string;
  args: Record<string, unknown>;
  onApprove: (approved: boolean) => void;
}

export function ConfirmCard({ toolName, args, onApprove }: Props) {
  return (
    <div className="border border-yellow-600 bg-yellow-900/30 rounded-lg p-3 mt-2">
      <div className="flex items-center gap-2 text-yellow-400 mb-2">
        <span>⚠️</span>
        <span className="font-semibold">Confirm Action: {toolName}</span>
      </div>
      <pre className="text-xs text-gray-300 mb-3 max-h-24 overflow-auto">
        {JSON.stringify(args, null, 2)}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(true)}
          className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-500 text-sm"
        >
          Approve
        </button>
        <button
          onClick={() => onApprove(false)}
          className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 text-sm"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
```

#### Sidebar — `packages/web/src/components/Sidebar.tsx`

```typescript
import { useState, useEffect } from "react";

interface Session {
  id: string;
  title: string;
  updatedAt: string;
}

interface Props {
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

export function Sidebar({ activeSessionId, onSelectSession }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    fetch("/api/sessions")
      .then(res => res.json())
      .then(setSessions)
      .catch(console.error);
  }, []);

  const createSession = async () => {
    const res = await fetch("/api/sessions", { method: "POST" });
    const session = await res.json();
    setSessions(prev => [session, ...prev]);
    onSelectSession(session.id);
  };

  return (
    <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
      <div className="p-3">
        <button
          onClick={createSession}
          className="w-full py-2 px-3 bg-blue-600 text-white rounded hover:bg-blue-500 text-sm"
        >
          + New Chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => onSelectSession(s.id)}
            className={`w-full text-left px-3 py-2 text-sm truncate hover:bg-gray-800 ${
              s.id === activeSessionId ? "bg-gray-800 text-white" : "text-gray-400"
            }`}
          >
            {s.title}
          </button>
        ))}
      </div>
    </aside>
  );
}
```

#### InputBar — `packages/web/src/components/InputBar.tsx`

```typescript
import { useState, useRef, type KeyboardEvent } from "react";

interface Props {
  onSend: (content: string) => void;
  disabled: boolean;
}

export function InputBar({ onSend, disabled }: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-800 p-3">
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message... (Enter to send, Shift+Enter for new line)"
          rows={2}
          disabled={disabled}
          className="flex-1 bg-gray-800 text-gray-100 rounded p-2 resize-none text-sm
                     placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                     disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500
                     disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

---

## 十、错误处理

| 场景 | 处理层级 | 实现 |
|------|----------|------|
| LLM 调用失败 | LLM 层 / LangChain | `maxRetries: 3` 指数退避（1s/2s/4s），仅重试 429/5xx；耗尽后抛异常向上传递 |
| 工具执行失败 | 子 Agent | WorkerAgent catch 工具异常文本，作为 ToolMessage 注入 Agent 上下文，让 Agent 自行决策重试或换方案 |
| 子 Agent 超时 | 子 Agent | `AbortSignal.timeout(60_000)`；主 Agent 收到 `{status: 'timeout'}`；Orchestrator 可决定重试或跳过 |
| 不可恢复错误 | API Gateway | Fastify errorHandler 捕获配置错误（API key 无效等），通过 WS 推送 `{type:'error', message}` 并终止会话 |
| 用户拒绝审批 | WebSocket | Worker 收到拒绝信号后立即终止当前工具调用，返回 `{status:'failed', error:'User denied tool execution'}` |

---

## 十一、环境变量

```bash
# .env.example

# LLM Configuration
LLM_PROVIDER=openai              # openai | anthropic | openai-compatible
LLM_MODEL=gpt-4o                 # or claude-sonnet-4-6-20250514
LLM_API_KEY=sk-xxx
LLM_BASE_URL=                    # optional, for proxies / compatible services
LLM_MAX_RETRIES=3

# Server
HOST=0.0.0.0
PORT=3000

# Workspace
WORKSPACE_PATH=./workspace       # Agent 工作目录

# Database
DB_PATH=./data/code-agent.db
```

### 配置加载 — `packages/server/src/config.ts`

```typescript
import { z } from "zod";

const envSchema = z.object({
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]).default("openai"),
  LLM_MODEL: z.string().default("gpt-4o"),
  LLM_API_KEY: z.string(),
  LLM_BASE_URL: z.string().optional(),
  LLM_MAX_RETRIES: z.coerce.number().default(3),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(3000),
  WORKSPACE_PATH: z.string().default("./workspace"),
  DB_PATH: z.string().default("./data/code-agent.db"),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadConfig(): EnvConfig {
  return envSchema.parse(process.env);
}
```

---

## 十二、入口文件 — `packages/server/src/index.ts`

```typescript
import { config } from "dotenv";
config();

import { loadConfig } from "./config.js";
import { createChatModel } from "@code-agent/core/llm/factory.js";
import { ToolRegistry } from "@code-agent/core/tools/registry.js";
import { createServer } from "./gateway/server.js";
import { createDb } from "./db/connection.js";

// 注册所有内置工具
import {
  fileReadTool, fileWriteTool, fileListTool,
} from "@code-agent/core/tools/file.js";
import { shellExecTool } from "@code-agent/core/tools/shell.js";
import { codeSearchTool } from "@code-agent/core/tools/search.js";
import {
  gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool, gitBranchTool,
} from "@code-agent/core/tools/git.js";
import { webFetchTool } from "@code-agent/core/tools/web.js";

async function main() {
  const cfg = loadConfig();

  // LLM
  const model = createChatModel({
    provider: cfg.LLM_PROVIDER,
    model: cfg.LLM_MODEL,
    apiKey: cfg.LLM_API_KEY,
    baseURL: cfg.LLM_BASE_URL,
    maxRetries: cfg.LLM_MAX_RETRIES,
  });

  // Tools
  const toolRegistry = ToolRegistry.createDefault();
  toolRegistry.register(fileReadTool);
  toolRegistry.register(fileWriteTool);
  toolRegistry.register(fileListTool);
  toolRegistry.register(shellExecTool);
  toolRegistry.register(codeSearchTool);
  toolRegistry.register(gitStatusTool);
  toolRegistry.register(gitDiffTool);
  toolRegistry.register(gitLogTool);
  toolRegistry.register(gitCommitTool);
  toolRegistry.register(gitBranchTool);
  toolRegistry.register(webFetchTool);

  // DB
  const db = createDb(cfg.DB_PATH);

  // Server
  const app = await createServer({
    model,
    toolRegistry,
    workspacePath: cfg.WORKSPACE_PATH,
  });

  // 将 db 实例挂载到 app 上，供路由使用
  app.decorate("db", db);

  await app.listen({ host: cfg.HOST, port: cfg.PORT });
  console.log(`Server running at http://${cfg.HOST}:${cfg.PORT}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
```

---

## 十三、package.json 关键依赖汇总

### packages/core/package.json

```json
{
  "name": "@code-agent/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@langchain/core": "^0.3.0",
    "@langchain/openai": "^0.3.0",
    "@langchain/anthropic": "^0.3.0",
    "langchain": "^0.3.0",
    "zod": "^3.0.0",
    "simple-git": "^3.0.0"
  },
  "peerDependencies": {
    "better-sqlite3": "^11.0.0"
  }
}
```

### packages/server/package.json

```json
{
  "name": "@code-agent/server",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@code-agent/core": "workspace:*",
    "@langchain/core": "^0.3.0",
    "@langchain/langgraph": "^0.2.0",
    "langchain": "^0.3.0",
    "fastify": "^5.0.0",
    "@fastify/websocket": "^11.0.0",
    "@fastify/cors": "^10.0.0",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.38.0",
    "drizzle-kit": "^0.30.0",
    "zod": "^3.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/ws": "^8.0.0"
  }
}
```

### packages/web/package.json

```json
{
  "name": "@code-agent/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^7.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0"
  }
}
```

---

## 十四、开发路线

鉴于 1-2 个月的学习周期，建议按以下阶段推进：

| 阶段 | 内容 | 预计时间 |
|------|------|----------|
| Phase 1 | 搭建 monorepo、LLM 抽象层、基础工具（File/Search）、单 Agent 对话循环 | 第 1 周 |
| Phase 2 | Harness 核心：权限沙箱 + Hooks 引擎 + 上下文管理 | 第 2-3 周 |
| Phase 3 | LangGraph Orchestrator + 子 Agent 派发 | 第 3-4 周 |
| Phase 4 | API Gateway (Fastify + WebSocket) + 数据库 | 第 4-5 周 |
| Phase 5 | React 聊天界面 + 流式显示 + 审批卡片 | 第 5-6 周 |
| Phase 6 | 测试、调试、文档、边界情况处理 | 第 6-8 周 |
