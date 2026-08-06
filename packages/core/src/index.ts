/**
 * @code-agent/core —— 核心库统一入口
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

// 全局配置管理
export { GlobalConfigManager, globalConfigSchema } from './config/index.js';
export type { GlobalConfig } from './config/index.js';

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
export type { ContextWindow, AgentContext, RuntimeContext } from './harness/context/types.js';
export { ContextManager } from './harness/context/manager.js';
export { compressMessages } from './harness/context/compressor.js';

// 子 Agent 编排（兼容层）
export type { WorkerInput, WorkerOutput, WorkerStatus } from './agent/types.js';
export { WorkerAgent } from './agent/worker.js';

// Agent 基类 + 角色 + 注册中心（Step 3）
export type {
  AgentConfig,
  AgentInput,
  AgentOutput,
  AgentStatus as AgentRuntimeStatus,
} from './agent/types.js';
export type { AgentRole } from './agent/role.js';
export { BUILTIN_ROLES } from './agent/role.js';
export { CODE_AGENT_ROLE } from './agent/roles/code.js';
export { TEST_AGENT_ROLE } from './agent/roles/test.js';
export { DOC_AGENT_ROLE } from './agent/roles/doc.js';
export type { IReasoningLoop } from './agent/reasoning.js';
export { DefaultReasoningLoop } from './agent/reasoning.js';
export { Agent } from './agent/agent.js';
export { AgentRegistry } from './agent/registry.js';

// EventBus —— 多 Agent 通信基础设施
export type {
  BusMessage,
  BusMessageMetadata,
  MessageId,
  CommandTopic,
  EventTopic,
  IEventBus,
  MessageHandler,
  Unsubscribe as EventBusUnsubscribe,
} from './event-bus/types.js';
export { BusTimeoutError } from './event-bus/types.js';
export { InMemoryEventBus } from './event-bus/bus.js';

// State Manager —— 多 Agent 状态管理基础设施
export type {
  TaskStatus,
  Task,
  TaskState,
  AgentStatus,
  AgentState,
  FileChange,
  CommitRecord,
  TestResult,
  ArtifactList,
  ArtifactState,
  Plan,
  SubTask,
  WorkflowState,
  IStateManager,
} from './state/types.js';
export { InvalidTransitionError } from './state/types.js';
export { InMemoryStateManager } from './state/manager.js';

// ExecutionEngine —— Agent 执行引擎（Step 2）
export type {
  ExecutionContext,
  ExecutionResult,
  AgentLike,
} from './harness/execution/engine.js';
export { ExecutionEngine } from './harness/execution/engine.js';

// CheckpointManager —— 执行快照持久化（Step 2）
export type {
  ICheckpointManager,
  CheckpointSnapshot,
  Thought,
  ToolCallRecord,
  RuntimeContext as CheckpointRuntimeContext,
} from './harness/execution/checkpoint.js';
export { FileCheckpointManager } from './harness/execution/checkpoint.js';

// Orchestrator Checkpoint (Step 5)
export type {
  OrchestratorCheckpoint,
  SerializedMessage,
  IOrchestratorCheckpointManager,
} from './harness/execution/checkpoint.js';
export { FileOrchestratorCheckpointManager } from './harness/execution/checkpoint.js';

// Memory —— 三层记忆体系（Step 2）
export type {
  ShortTermMemory,
  LongTermMemory,
  LongTermEntry,
  WorkingMemory,
  IMemoryManager,
} from './harness/memory/types.js';
export { InMemoryShortTermMemory } from './harness/memory/short-term.js';
export { InMemoryWorkingMemory } from './harness/memory/working.js';
export { FileLongTermMemory } from './harness/memory/long-term.js';

// 核心版本标识
export const CORE_VERSION = '0.1.0';