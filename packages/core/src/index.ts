/**
 * @code-agent/core —— Harness 原语
 *
 * 只导出 integration surface；内部实现不要从包根泄漏。
 */

// LLM
export * from "./llm/types.js";
export * from "./llm/factory.js";

// 配置与路径
export * from "./config/index.js";

// 工具、权限、上下文、记忆
export * from "./tools/index.js";
export * from "./permissions/policy.js";
export * from "./permissions/paths.js";
export * from "./permissions/shell-policy.js";

// Hooks
export { HooksEngine } from "./hooks/engine.js";
export type { HooksEngineOptions } from "./hooks/engine.js";
export type {
  HookEvent,
  HookContext,
  HookResult,
  HookHandler,
} from "./hooks/types.js";
export { createLoggerHook } from "./hooks/builtins/logger.js";
export { createSecretFilterHook } from "./hooks/builtins/secret-filter.js";

// 上下文
export * from "./context/types.js";
export * from "./context/token-counter.js";
export * from "./context/compressor.js";
export * from "./context/summarizer.js";
export { ContextManager as CompactContextManager } from "./context/manager.js";
export type { CompactOptions } from "./context/manager.js";

// 长期记忆
export * from "./memory/in-memory-store.js";
export * from "./memory/file-store.js";
export * from "./memory/service.js";
export * from "./memory/extractor.js";
export * from "./memory/types.js";

// Checkpoint
export * from "./checkpoint/index.js";

// 执行引擎与 Agent 契约
export * from "./execution/index.js";

// 状态
export * from "./state/index.js";

// 类型化 Event Bus
export * from "./bus/index.js";
export type { EventBus as TypedEventBus } from "./bus/index.js";

// 版本
export const CORE_VERSION = "0.1.0";
