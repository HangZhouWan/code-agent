/**
 * Orchestrator —— Dispatcher 节点
 *
 * 职责：筛选可执行的子任务，并行派发给 WorkerAgent 执行，收集结果。
 *
 * 执行逻辑：
 * 1. 分类 pendingTasks → ready（依赖已满足）/ waiting（尚需等待）
 * 2. 无 ready 任务 → 返回 { nextAction: 'continue' } 等待下次循环
 * 3. 并行执行所有 ready 任务（Promise.all）
 * 4. 结果写入 completedTasks，更新 pendingTasks 和 nextAction
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ToolRegistry, WorkerAgent, type WorkerOutput } from '@my-agent/core';
import type { SubTask, NextAction } from '../types.js';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** Dispatcher 节点的输入状态（所需字段） */
interface DispatcherInput {
  plan: SubTask[];
  pendingTasks: SubTask[];
  completedTasks: Record<string, WorkerOutput>;
}

/** Dispatcher 节点的输出状态（更新字段） */
export interface DispatcherOutput {
  completedTasks: Record<string, WorkerOutput>;
  pendingTasks: SubTask[];
  nextAction: NextAction;
}

// ---------------------------------------------------------------------------
// Node 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Dispatcher 节点
 *
 * @param model - LLM 实例（传递给每个 WorkerAgent）
 * @param toolRegistry - 工具注册表（传递给每个 WorkerAgent）
 * @param workspacePath - 工作区路径（传递给每个 WorkerAgent）
 * @returns LangGraph 节点函数
 */
export function createDispatcherNode(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
) {
  return async function dispatcherNode(
    state: DispatcherInput,
  ): Promise<DispatcherOutput> {
    const { pendingTasks, completedTasks } = state;

    // 1. 无待处理任务 → 汇总
    if (pendingTasks.length === 0) {
      return {
        completedTasks,
        pendingTasks: [],
        nextAction: 'summarize',
      };
    }

    // 2. 分类：ready vs waiting
    const completedIds = new Set(Object.keys(completedTasks));
    const ready: SubTask[] = [];
    const waiting: SubTask[] = [];

    for (const task of pendingTasks) {
      const deps = task.dependsOn ?? [];
      const dependenciesSatisfied = deps.every((depId) =>
        completedIds.has(depId),
      );

      if (dependenciesSatisfied) {
        ready.push(task);
      } else {
        waiting.push(task);
      }
    }

    // 3. 无就绪任务但有等待任务 → 继续循环等待
    if (ready.length === 0 && waiting.length > 0) {
      return {
        completedTasks,
        pendingTasks: waiting,
        nextAction: 'continue',
      };
    }

    if (ready.length === 0) {
      // 理论不会到达（pendingTasks 非空但 ready 和 waiting 都为空）
      return {
        completedTasks,
        pendingTasks: [],
        nextAction: 'summarize',
      };
    }

    // 4. 并行派发所有就绪任务
    const worker = new WorkerAgent(model, toolRegistry);

    const results = await Promise.all(
      ready.map(async (task): Promise<WorkerOutput> => {
        // 构建上下文：包含依赖任务的输出
        const contextParts: string[] = [];
        if (task.dependsOn && task.dependsOn.length > 0) {
          for (const depId of task.dependsOn) {
            const depResult = completedTasks[depId];
            if (depResult) {
              contextParts.push(
                `[Result of "${depId}"]: ${depResult.result ?? depResult.error ?? 'No output'}`,
              );
            }
          }
        }

        return worker.run({
          taskId: task.id,
          description: task.description,
          tools: task.tools,
          context: contextParts.join('\n\n'),
          workspacePath,
        });
      }),
    );

    // 5. 合并结果
    const newCompleted = { ...completedTasks };
    for (const result of results) {
      newCompleted[result.taskId] = result;
    }

    // 6. 决定下一步动作
    const nextAction: NextAction =
      waiting.length > 0 ? 'continue' : 'summarize';

    return {
      completedTasks: newCompleted,
      pendingTasks: waiting,
      nextAction,
    };
  };
}