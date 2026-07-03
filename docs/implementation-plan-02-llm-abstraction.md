# 实现计划 02：LLM 抽象层实现

**对应技术文档**：[2026-07-02-technical-implementation.md](./2026-07-02-technical-implementation.md) 第三节

**预计工时**：2 天（第 1 周后半段）

**前置模块**：[01-Monorepo 与基础设施](./implementation-plan-01-monorepo.md)

---

## 1. 目标

在 LangChain.js 的 `BaseChatModel` 之上构建**配置工厂 + 协议检测 + 重试机制**三个增强层，统一管理 OpenAI / Anthropic / OpenAI 兼容协议的模型调用。

## 2. 设计原则

- **不做新抽象**：直接复用 LangChain 的 `BaseChatModel`，不做额外包装
- **工厂模式**：根据 `ModelConfig` 动态创建对应的 ChatModel 实例
- **协议自动检测**：通过 HTTP 探测 `/v1/models` 端点判断 API 协议类型
- **双层重试**：LangChain 自带 `maxRetries` + 自定义 `withRetry` 兜底

## 3. 产出物清单

```
packages/core/src/llm/
├── types.ts        # ModelConfig, ChatOptions, UnifiedResponse, StreamChunk 类型
├── factory.ts      # createChatModel() 工厂函数
├── protocol.ts     # detectProtocol() 协议检测
└── retry.ts        # withRetry() 指数退避重试
```

## 4. 依赖

```json
{
  "@langchain/core": "^0.3",
  "@langchain/openai": "^0.3",
  "@langchain/anthropic": "^0.3"
}
```

## 5. 实现步骤

### 步骤 5.1：类型定义 (`types.ts`)

定义以下核心类型：

| 类型 | 说明 |
|------|------|
| `ModelProvider` | `'openai' \| 'anthropic' \| 'openai-compatible'` |
| `ModelConfig` | 包含 provider, model, apiKey, baseURL?, maxRetries?, temperature? |
| `ChatOptions` | tools?, maxTokens?, temperature?, stopSequences? |
| `UnifiedResponse` | 统一的调用响应：role, content, toolCalls |
| `StreamChunk` | 流式响应块：type('text'\|'tool_call'), content?, toolCall? |

**关键点**：
- `ModelConfig.temperature` 默认值 0.7
- `ModelConfig.maxRetries` 默认值 3
- `StreamChunk` 的 `toolCall` 使用 LangChain 的 `Partial<ToolCall>`

### 步骤 5.2：工厂函数 (`factory.ts`)

```typescript
export function createChatModel(config: ModelConfig): BaseChatModel
```

实现逻辑：
1. 根据 `provider` 字段分发
2. `openai` / `openai-compatible` → `new ChatOpenAI({...})`
3. `anthropic` → `new ChatAnthropic({...})`
4. 当 `baseURL` 存在时分别传入 `configuration.baseURL` 或 `clientOptions.baseURL`
5. 不支持的 provider 抛出明确错误

**注意事项**：
- `ChatOpenAI` 的 baseURL 通过 `configuration: { baseURL }` 传递
- `ChatAnthropic` 的 baseURL 通过 `clientOptions: { baseURL }` 传递
- 两个构造器的参数结构有差异，需要分别处理

### 步骤 5.3：协议检测 (`protocol.ts`)

```typescript
export async function detectProtocol(baseURL: string): Promise<'openai' | 'anthropic' | 'unknown'>
```

实现逻辑：
1. 向 `{baseURL}/v1/models` 发送 GET 请求
2. 检查响应头是否包含 `anthropic-version` → Anthropic 协议
3. 检查响应体是否为 `{ data: [...] }` 或 `{ object: 'list' }` → OpenAI 协议
4. 其他情况（包括网络错误）→ `'unknown'`

**测试要点**：
- 本地 Ollama/LM Studio 的 OpenAI 兼容端点应返回 `'openai'`
- Anthropic API 端点的 `anthropic-version` 响应头

### 步骤 5.4：重试机制 (`retry.ts`)

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; baseDelayMs?: number }
): Promise<T>
```

重试策略：
- 最大重试次数：默认 3
- 退避算法：指数退避 + 随机抖动
  - 延迟 = `baseDelayMs × 2^attempt + random(0, 1000)ms`
- 可重试条件：
  - HTTP 429（Rate Limit）
  - HTTP 5xx（服务端错误）
- 不可重试错误（4xx 非 429）直接抛出

**说明**：LangChain 构造器中的 `maxRetries` 已经覆盖了 SDK 层面的重试，`withRetry` 用于补充自定义调用场景（如协议检测、直接 fetch 调用）的容错。

### 步骤 5.5：统一导出

在 `packages/core/src/index.ts` 中导出 llm 模块：
```typescript
export * from './llm/types.js';
export * from './llm/factory.js';
export * from './llm/protocol.js';
export * from './llm/retry.js';
```

## 6. 验证方式

```typescript
// 单元测试 / 手动验证脚本
import { createChatModel } from '@my-agent/core';

const model = createChatModel({
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: process.env.LLM_API_KEY!,
});

const response = await model.invoke("Hello, who are you?");
console.log(response.content);
```

## 7. 验收标准

- [ ] `createChatModel` 支持 openai / anthropic / openai-compatible 三种 provider
- [ ] `detectProtocol` 正确区分 OpenAI 和 Anthropic 协议端点
- [ ] `withRetry` 在 429/5xx 时正确重试，4xx 时立即失败
- [ ] 错误情况下抛出有意义的异常信息
- [ ] TypeScript 类型检查通过
- [ ] 所有导出可由 `@my-agent/core` 包正确引入
