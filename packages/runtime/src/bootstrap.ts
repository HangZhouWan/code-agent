/**
 * Runtime 组合根
 *
 * 适配器通过这里构建 Harness / ports，避免直接依赖 core 内部模块。
 */

import { join } from "node:path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  FileCheckpointStore,
  FileMemoryStore,
  HooksEngine,
  LlmContextSummarizer,
  LlmMemoryExtractor,
  MemoryService,
  createBuiltinTools,
  createChatModel,
  createContextBudget,
  createTokenCounter,
  type ChatModelLike,
  type ResolvedConfig,
} from "@code-agent/core";
import { asWorkspaceId } from "@code-agent/protocol";
import type { RuntimeHarness } from "./factory.js";
import { createInMemoryPorts } from "./ports/in-memory.js";
import type { RuntimePorts } from "./ports/types.js";

export interface RuntimeBootstrapOptions {
  config: ResolvedConfig;
  hooks?: HooksEngine;
  memory?: boolean;
  writeLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface RuntimeBootstrap {
  harness: RuntimeHarness;
  memory?: MemoryService;
  memoryExtractor?: LlmMemoryExtractor;
  checkpointStore: FileCheckpointStore;
}

export function createRuntimeBootstrap(
  options: RuntimeBootstrapOptions,
): RuntimeBootstrap {
  const { config } = options;
  const model = createChatModel({
    provider: config.LLM_PROVIDER,
    model: config.LLM_MODEL,
    apiKey: config.LLM_API_KEY,
    baseURL: config.LLM_BASE_URL,
    maxRetries: config.LLM_MAX_RETRIES,
    ...(config.LLM_MAX_TOKENS ? { maxTokens: config.LLM_MAX_TOKENS } : {}),
  }) as unknown as ChatModelLike;

  const hooks = options.hooks ?? new HooksEngine();
  const memory =
    options.memory === false
      ? undefined
      : new MemoryService({
          store: new FileMemoryStore({
            filePath: join(config.paths.dataDir, "memory.json"),
          }),
          workspaceId: asWorkspaceId(config.WORKSPACE_PATH),
          config: {
            autoApplyConfidence: 0.8,
            maxOpsPerRun: 5,
            maxContentLength: 500,
          },
        });

  const memoryExtractor = memory
    ? new LlmMemoryExtractor(model as unknown as BaseChatModel, {
        maxOps: 5,
      })
    : undefined;

  const tokenCounter = createTokenCounter({
    provider: config.LLM_PROVIDER,
    model: config.LLM_MODEL,
  });
  const contextBudget = createContextBudget({
    modelWindow: tokenCounter.modelWindow,
    reservedOutput: config.CONTEXT.RESERVED_OUTPUT_TOKENS,
    softThreshold: config.CONTEXT.CONTEXT_SOFT_THRESHOLD,
    hardThreshold: config.CONTEXT.CONTEXT_HARD_THRESHOLD,
  });
  const contextSummarizer = new LlmContextSummarizer(model, {
    maxTokens: config.CONTEXT.SUMMARY_MAX_TOKENS,
  });

  const harness: RuntimeHarness = {
    model,
    tools: createBuiltinTools(),
    hooks,
    tokenCounter,
    contextBudget,
    contextSummarizer,
    inlineToolResultLimit: config.CONTEXT.INLINE_TOOL_RESULT_LIMIT,
    ...(memory ? { memory } : {}),
    ...(memoryExtractor ? { memoryExtractor } : {}),
    ...(options.writeLock ? { writeLock: options.writeLock } : {}),
    autoApprove: config.AUTO_MODE,
    planMode: config.PLAN_MODE,
  };

  return {
    harness,
    ...(memory ? { memory } : {}),
    ...(memoryExtractor ? { memoryExtractor } : {}),
    checkpointStore: new FileCheckpointStore({
      baseDir: config.paths.checkpointDir,
    }),
  };
}

/** 默认端口：内存 session/run/event + 文件 checkpoint */
export function createDefaultPorts(
  checkpointStore: FileCheckpointStore,
): RuntimePorts {
  const ports = createInMemoryPorts();
  ports.checkpoints = checkpointStore;
  return ports;
}

/** 进程内互斥锁，用于跨会话串行化写操作 */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
