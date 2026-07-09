/**
 * Orchestrator —— 状态图构建
 *
 * 使用 LangGraph StateGraph 构建 Orchestrator 工作流：
 *
 *   User Message
 *       │
 *       ▼
 *   [planner] ──→ 生成 SubTask[]
 *       │
 *       ▼
 *   [dispatcher] ──→ 筛选就绪任务 → 并行派发 WorkerAgent
 *       │                │
 *       │  pending > 0?  │
 *       │   ├─ yes → loop back to dispatcher
 *       │   └─ no  → continue
 *       │
 *       ▼
 *   [summarizer] ──→ 汇总结果 → 最终回复
 *
 * 条件路由：dispatcher 根据 nextAction 决定继续循环或进入汇总。
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ToolRegistry, type PermissionRegistry } from '@my-agent/core';
import { OrchestratorState } from './state.js';
import { createPlannerNode } from './nodes/planner.js';
import { createDispatcherNode } from './nodes/dispatcher.js';
import { createSummarizerNode } from './nodes/summarizer.js';

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Orchestrator 状态图
 *
 * 构建完整的 Planner → Dispatcher → Summarizer 工作流，
 * 支持多轮 Dispatcher 循环（处理有依赖的子任务）。
 *
 * @param model - LLM 实例
 * @param toolRegistry - 工具注册表（提供工具列表 + 创建子 Agent）
 * @param workspacePath - 工作区根路径
 * @returns 编译后的 LangGraph CompiledStateGraph，可直接 invoke/stream
 *
 * @example
 * ```ts
 * import { createChatModel } from '@my-agent/core';
 *
 * const model = createChatModel({ provider: 'openai', model: 'gpt-4o', apiKey: '...' });
 * const registry = ToolRegistry.createDefault();
 * // ... register tools ...
 *
 * const graph = createOrchestratorGraph(model, registry, './workspace');
 *
 * const result = await graph.invoke({
 *   messages: [new HumanMessage('Read package.json and check git status')],
 * });
 * console.log(result.finalResponse);
 * ```
 */
export function createOrchestratorGraph(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permissionRegistry?: PermissionRegistry,
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>,
) {
  const plannerNode = createPlannerNode(model, toolRegistry);
  const dispatcherNode = createDispatcherNode(model, toolRegistry, workspacePath, permissionRegistry, onConfirmRequired);
  const summarizerNode = createSummarizerNode(model);

  const graph = new StateGraph(OrchestratorState)
    // 注册节点
    .addNode('planner', plannerNode)
    .addNode('dispatcher', dispatcherNode)
    .addNode('summarizer', summarizerNode)

    // 构建工作流边
    .addEdge(START, 'planner')
    .addEdge('planner', 'dispatcher')

    // 条件路由：dispatcher → continue（循环）或 summarize（结束）
    .addConditionalEdges(
      'dispatcher',
      (state: typeof OrchestratorState.State) => state.nextAction,
      {
        continue: 'dispatcher',
        summarize: 'summarizer',
      },
    )

    .addEdge('summarizer', END);

  return graph.compile();
}