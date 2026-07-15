/**
 * Agent 包 —— 统一出口
 *
 * 导出 Agent 基类、角色定义、推理循环、注册中心和相关类型。
 */

// 类型
export type {
  WorkerInput,
  WorkerOutput,
  WorkerStatus,
  AgentConfig,
  AgentInput,
  AgentOutput,
  AgentStatus,
} from './types.js';

// 角色
export type { AgentRole } from './role.js';
export { BUILTIN_ROLES } from './role.js';

// 推理循环
export type { IReasoningLoop } from './reasoning.js';
export { DefaultReasoningLoop } from './reasoning.js';

// Agent 基类
export { Agent } from './agent.js';

// Agent 注册中心
export { AgentRegistry } from './registry.js';

// WorkerAgent（兼容层）
export { WorkerAgent } from './worker.js';
