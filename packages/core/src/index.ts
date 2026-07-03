/**
 * @my-agent/core —— 核心库统一入口
 *
 * 此模块提供：
 * - LLM 抽象层（多 Provider 支持、协议适配、重试机制）
 * - 工具注册与执行层（文件、Git、Shell、搜索、Web 等内置工具）
 * - Agent Runtime（沙箱、Hook 引擎、上下文管理）
 * - 子 Agent 编排（Agent 生命周期、主循环）
 */

// LLM 抽象层
export * from './llm/types.js';
export * from './llm/factory.js';
export * from './llm/protocol.js';
export * from './llm/retry.js';

// 工具层
export * from './tools/index.js';

// Agent Runtime
export * from './harness/sandbox/types.js';
export { PermissionRegistry } from './harness/sandbox/registry.js';
export { SandboxGuard } from './harness/sandbox/guard.js';
export type { HookEvent, HookContext, HookResult, HookHandler } from './harness/hooks/types.js';
export { HooksEngine } from './harness/hooks/engine.js';
export { createLoggerHook } from './harness/hooks/builtins/logger.js';
export { createSecretFilterHook } from './harness/hooks/builtins/secret-filter.js';
export type { ContextWindow, AgentContext } from './harness/context/types.js';
export { ContextManager } from './harness/context/manager.js';
export { compressMessages } from './harness/context/compressor.js';

// 子 Agent（后续步骤实现）
// export * from './agent/types.js';

// 核心版本标识
export const CORE_VERSION = '0.1.0';