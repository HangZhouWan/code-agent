/**
 * Orchestrator —— 状态图构建
 *
 * 使用 LangGraph StateGraph 构建 Orchestrator 工作流：
 *
 *   User Message
 *       │
 *       ▼
 *   [planner] ──→ 生成 Plan（含 complexity + routing + role）
 *       │
 *       ▼
 *   [dispatcher] ──→ 双通道派发（direct / bus）
 *       │                │
 *       │  ┌─────────────┤
 *       │  │             │
 *       │  ▼             ▼
 *       │ continue    replan ──→ [replanner] ──→ 修正 Plan
 *       │  │                                │
 *       │  └────────────────────────────────┘
 *       │
 *       ▼
 *   [finalizer] ──→ 汇总结果 + 产物 → 最终回复
 *
 * 条件路由：dispatcher 根据 nextAction 决定：
 * - continue: 还有等待任务，循环
 * - replan: 有任务需要修正计划
 * - finalize: 全部完成，生成最终回复
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  ToolRegistry,
  type PermissionRegistry,
  type IEventBus,
  type AgentRegistry,
} from '@code-agent/core';
import type { IOrchestratorCheckpointManager } from '@code-agent/core';
import { OrchestratorState } from './state.js';
import { createPlannerNode } from './nodes/planner.js';
import { createDispatcherNode } from './nodes/dispatcher.js';
import { createReplannerNode } from './nodes/replanner.js';
import { createFinalizerNode } from './nodes/finalizer.js';

// ---------------------------------------------------------------------------
// 工厂函数配置
// ---------------------------------------------------------------------------

/** createOrchestratorGraph 的配置选项 */
export interface OrchestratorGraphOptions {
  /** LLM 实例 */
  model: BaseChatModel;
  /** 工具注册表 */
  toolRegistry: ToolRegistry;
  /** 工作区根路径 */
  workspacePath: string;
  /** 权限注册表（可选） */
  permissionRegistry?: PermissionRegistry;
  /** 确认回调（可选） */
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  /** EventBus 实例（bus 通道使用） */
  eventBus?: IEventBus;
  /** Agent 注册表（direct 通道使用） */
  agentRegistry?: AgentRegistry;
  /** AbortSignal —— 传播取消信号到 Agent */
  signal?: AbortSignal;
  /** Orchestrator Checkpoint 管理器 */
  checkpointManager?: IOrchestratorCheckpointManager;
  /** 会话 ID（用于 checkpoint 文件命名） */
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Orchestrator 状态图
 *
 * 构建完整的 Planner → Dispatcher → (Replanner) → Finalizer 工作流，
 * 支持双通道任务派发（direct/bus）和计划修正。
 *
 * @param options - 配置选项（model, toolRegistry, workspacePath 等）
 * @returns 编译后的 LangGraph CompiledStateGraph，可直接 invoke/stream
 *
 * @example
 * ```ts
 * import { createChatModel, InMemoryEventBus, InMemoryStateManager, AgentRegistry } from '@code-agent/core';
 *
 * const model = createChatModel({ provider: 'openai', model: 'gpt-4o', apiKey: '...' });
 * const registry = ToolRegistry.createDefault();
 * const eventBus = new InMemoryEventBus();
 * const stateManager = new InMemoryStateManager(eventBus);
 * const agentRegistry = new AgentRegistry(eventBus, stateManager);
 *
 * const graph = createOrchestratorGraph({
 *   model, toolRegistry: registry,
 *   workspacePath: './workspace',
 *   eventBus, agentRegistry,
 * });
 *
 * const result = await graph.invoke({
 *   messages: [new HumanMessage('Read package.json and check git status')],
 * });
 * console.log(result.finalResponse);
 * ```
 */
export function createOrchestratorGraph(options: OrchestratorGraphOptions) {
  const {
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    eventBus,
    agentRegistry,
    signal,
    checkpointManager,
    sessionId,
  } = options;

  const plannerNode = createPlannerNode(model, toolRegistry, agentRegistry, checkpointManager, sessionId);
  const dispatcherNode = createDispatcherNode(
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
    eventBus,
    agentRegistry,
    signal,
    checkpointManager,
    sessionId,
  );
  const replannerNode = createReplannerNode(model);
  const finalizerNode = createFinalizerNode(model, checkpointManager, sessionId);

  const graph = new StateGraph(OrchestratorState)
    // 注册节点
    .addNode('planner', plannerNode)
    .addNode('dispatcher', dispatcherNode)
    .addNode('replanner', replannerNode)
    .addNode('finalizer', finalizerNode)

    // 条件启动：从 checkpoint 恢复时跳过 planner 直接从 dispatcher 开始
    .addConditionalEdges(
      START,
      (state: typeof OrchestratorState.State) =>
        state.resumeFromCheckpoint ? 'dispatcher' : 'planner',
      {
        planner: 'planner',
        dispatcher: 'dispatcher',
      },
    )

    .addEdge('planner', 'dispatcher')

    // 条件路由：dispatcher → continue（循环）/ replan（修正）/ finalize（结束）
    .addConditionalEdges(
      'dispatcher',
      (state: typeof OrchestratorState.State) => state.nextAction,
      {
        continue: 'dispatcher',
        replan: 'replanner',
        finalize: 'finalizer',
      },
    )

    // replanner 修正后回到 dispatcher 重试
    .addEdge('replanner', 'dispatcher')

    .addEdge('finalizer', END);

  return graph.compile();
}

/**
 * 创建 Orchestrator 状态图（兼容旧签名）
 *
 * 保留旧 API 不变，内部转换为新的 options 格式。
 * 用于不需要 EventBus/AgentRegistry 的简单场景。
 *
 * @deprecated 请使用 createOrchestratorGraph(options) 新签名
 */
export function createOrchestratorGraphLegacy(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permissionRegistry?: PermissionRegistry,
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>,
) {
  return createOrchestratorGraph({
    model,
    toolRegistry,
    workspacePath,
    permissionRegistry,
    onConfirmRequired,
  });
}
