/**
 * Agent 编排 —— 类型定义
 *
 * 定义 WorkerAgent 的输入/输出接口和状态枚举，
 * 以及 Agent 基类所需的配置和运行时类型。
 * 与 Orchestrator 的 SubTask 接口（定义在 server 包中）配合使用。
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { IEventBus } from '../event-bus/types.js';
import type { IStateManager } from '../state/types.js';
import type { ExecutionEngine } from '../harness/execution/engine.js';
import type { ContextManager } from '../harness/context/manager.js';
import type { HooksEngine } from '../harness/hooks/engine.js';
import type { PermissionRegistry } from '../harness/sandbox/registry.js';
import type { ToolRegistry, AgentCapability } from '../tools/registry.js';
import type { AgentRole } from './role.js';

// ─────────────────────────────────────────────
// Worker 类型（保留兼容）
// ─────────────────────────────────────────────

/**
 * Worker 输入 —— 父 Agent（Orchestrator）派发给子 Agent 的任务描述
 *
 * 包含完成任务所需的所有信息：工具列表、上下文摘要、工作区路径等。
 * 子 Agent 不直接与用户交互，只看此输入结构。
 */
export interface WorkerInput {
  /** 子任务唯一标识，由 Orchestrator 分配 */
  taskId: string;
  /** 子任务的自然语言描述，Worker 的 System Prompt 直接使用 */
  description: string;
  /** 允许使用的工具名称列表，如 ["file_read", "code_search"] */
  tools: string[];
  /** 上下文摘要：依赖任务的结果或父 Agent 的背景信息 */
  context: string;
  /** 文件系统工作区根路径，所有文件操作限定在此路径下 */
  workspacePath: string;
  /** 最大迭代次数，默认 15 */
  maxIterations?: number;
  /** 执行超时时间（毫秒），默认 60000 */
  timeoutMs?: number;
  /**
   * 确认回调（可选）
   *
   * 当 Worker 使用的工具需要用户确认时（如 file_write），调用此回调。
   * 回调返回 Promise<boolean>：true = 批准，false = 拒绝。
   * 如不提供，confirm 级别的工具将抛出 ConfirmRequiredError。
   */
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
}

/**
 * Worker 执行状态
 *
 * - running: 正在执行
 * - success: 成功完成
 * - failed: 执行失败（工具错误、LLM 错误等）
 * - timeout: 超时中断
 * - awaiting_approval: 需要用户确认敏感操作
 */
export type WorkerStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'awaiting_approval';

/**
 * Worker 输出 —— 子 Agent 返回给 Orchestrator 的结构化结果
 *
 * 包含执行状态、结果文本、工具调用记录和错误信息。
 */
export interface WorkerOutput {
  /** 对应 WorkerInput.taskId */
  taskId: string;
  /** 执行结果状态 */
  status: WorkerStatus;
  /** 成功时的最终回复文本 */
  result?: string;
  /** 失败/超时/待审批时的错误信息 */
  error?: string;
  /** 工具调用记录，用于审计和调试 */
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
}

// ─────────────────────────────────────────────
// Agent 基类类型（Step 3 新增）
// ─────────────────────────────────────────────

/**
 * Agent 配置 —— 创建 Agent 实例所需的完整依赖注入
 *
 * 所有依赖通过构造函数注入，便于测试和替换。
 */
export interface AgentConfig {
  /** Agent 角色定义（含 system prompt、订阅主题等） */
  role: AgentRole;

  /** LLM 模型 */
  model: BaseChatModel;

  /** 执行引擎（ReAct 循环） */
  engine: ExecutionEngine;

  /** EventBus 实例（用于发布/订阅消息） */
  eventBus: IEventBus;

  /** 状态管理器（用于注册 Agent 状态） */
  stateManager: IStateManager;

  /** 工具注册表 */
  toolRegistry: ToolRegistry;

  /** 上下文管理器（用于构建执行上下文） */
  contextManager: ContextManager;

  /** Hook 引擎（可选） */
  hooks?: HooksEngine;

  /** 权限注册表（可选，用于沙箱控制） */
  permissionRegistry?: PermissionRegistry;

  /** Agent 能力声明（工具集 + 路径 + 限制） */
  capability?: AgentCapability;

  /** 工作区根路径 */
  workspacePath?: string;
}

/**
 * Agent 输入 —— 直接调用 Agent.executeTask() 时的参数
 *
 * 相比 WorkerInput 更精简，不包含工具列表（由 Agent.role 决定）。
 */
export interface AgentInput {
  /** 任务唯一标识 */
  taskId: string;
  /** 任务的自然语言描述 */
  description: string;
  /** 上下文信息（依赖任务的结果或父 Agent 的背景） */
  context?: string;
  /** 最大迭代次数（覆盖 Agent 默认值） */
  maxIterations?: number;
  /** 超时时间（毫秒，覆盖 Agent 默认值） */
  timeoutMs?: number;
  /**
   * 确认回调（可选）
   *
   * 当工具需要用户确认时调用。
   */
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  /**
   * AbortSignal（可选）
   *
   * 用于传播取消信号到 ExecutionEngine.runLoop()。
   * 当用户按 Ctrl+C 时，此 signal 被 abort，引擎检测后停止执行。
   */
  signal?: AbortSignal;
}

/**
 * Agent 输出 —— Agent.executeTask() 的返回结构
 *
 * 与 ExecutionResult 类似，但增加了 Agent 级别的元信息。
 */
export interface AgentOutput {
  /** 对应 AgentInput.taskId */
  taskId: string;
  /** Agent 唯一标识 */
  agentId: string;
  /** 执行状态 */
  status: 'success' | 'failed' | 'timeout' | 'replan_needed';
  /** 成功时的最终输出 */
  result?: string;
  /** 失败/超时时的错误信息 */
  error?: string;
  /** 工具调用记录 */
  toolCalls?: Array<{
    tool: string;
    args: Record<string, unknown>;
    result: string;
  }>;
}

/**
 * Agent 运行时状态
 */
export type AgentStatus = 'idle' | 'busy' | 'error';
