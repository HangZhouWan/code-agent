/**
 * Orchestrator —— Dispatcher 节点
 *
 * 职责：筛选可执行的子任务，根据 routing 字段选择通道派发，收集结果。
 *
 * 双通道设计：
 * - direct：从 AgentRegistry 获取 Agent，直接调用 agent.executeTask()
 * - bus：发布 command 到 EventBus，等待 Agent 协作完成
 *
 * 执行逻辑：
 * 1. 分类 pendingTasks → ready（依赖已满足）/ waiting（尚需等待）
 * 2. 无 ready 任务 → 返回 { nextAction: 'continue' } 等待下次循环
 * 3. 按 routing 分两组并行执行
 * 4. 检测 replan_needed 信号
 * 5. 结果写入 completedTasks，更新 pendingTasks 和 nextAction
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  ToolRegistry,
  WorkerAgent,
  type WorkerOutput,
  type PermissionRegistry,
  type IEventBus,
  type AgentRegistry,
  type AgentOutput,
} from '@code-agent/core';
import type { SubTask, NextAction, ReplanSignal } from '../types.js';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** Dispatcher 节点的输入状态（所需字段） */
interface DispatcherInput {
  plan: { tasks: SubTask[]; complexity: string };
  pendingTasks: SubTask[];
  completedTasks: Record<string, WorkerOutput>;
}

/** Dispatcher 节点的输出状态（更新字段） */
export interface DispatcherOutput {
  completedTasks: Record<string, WorkerOutput>;
  pendingTasks: SubTask[];
  nextAction: NextAction;
  replanSignal?: ReplanSignal | null;
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 构建任务上下文
 *
 * 将依赖任务的执行结果拼接为上下文字符串，
 * 供当前任务在执行时参考。
 */
function buildContext(
  task: SubTask,
  completed: Record<string, WorkerOutput>,
): string {
  const parts: string[] = [];
  if (task.dependsOn?.length) {
    for (const depId of task.dependsOn) {
      const dep = completed[depId];
      if (dep) {
        parts.push(
          `[前置任务 "${depId}" 的结果]：${dep.result ?? dep.error ?? 'No output'}`,
        );
      }
    }
  }
  return parts.join('\n\n');
}

/**
 * 将 AgentOutput 转换为 WorkerOutput 格式
 *
 * 保持 completedTasks 的类型一致性。
 */
function agentOutputToWorkerOutput(output: AgentOutput): WorkerOutput {
  return {
    taskId: output.taskId,
    status: output.status === 'replan_needed' ? 'failed' : output.status,
    result: output.result,
    error: output.error,
    toolCalls: output.toolCalls?.map(
      (tc: { tool: string; args: Record<string, unknown>; result: string }) => ({
        tool: tc.tool,
        args: tc.args,
        result: tc.result,
      }),
    ),
  };
}

/**
 * 从执行结果中检测 replan_needed 信号
 */
function detectReplanSignal(
  results: WorkerOutput[],
): ReplanSignal | null {
  for (const r of results) {
    // 检查 error 中是否包含 replan 标记
    if (r.error?.includes('replan_needed')) {
      return {
        sourceTaskId: r.taskId,
        reason: r.error,
        suggestion: 'Task indicated plan needs adjustment',
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Node 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Dispatcher 节点
 *
 * @param model - LLM 实例（传递给 WorkerAgent 兼容路径）
 * @param toolRegistry - 工具注册表（传递给 WorkerAgent）
 * @param workspacePath - 工作区路径
 * @param permissionRegistry - 权限注册表（可选）
 * @param eventBus - EventBus 实例（bus 通道必需）
 * @param agentRegistry - Agent 注册表（direct 通道使用）
 * @returns LangGraph 节点函数
 */
export function createDispatcherNode(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permissionRegistry?: PermissionRegistry,
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>,
  eventBus?: IEventBus,
  agentRegistry?: AgentRegistry,
) {
  return async function dispatcherNode(
    state: DispatcherInput,
  ): Promise<DispatcherOutput> {
    const { pendingTasks, completedTasks } = state;

    // 1. 无待处理任务 → finalize
    if (pendingTasks.length === 0) {
      return {
        completedTasks,
        pendingTasks: [],
        nextAction: 'finalize',
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
      return {
        completedTasks,
        pendingTasks: [],
        nextAction: 'finalize',
      };
    }

    // 4. 按 routing 分两组
    const directTasks = ready.filter((t) => t.routing === 'direct');
    const busTasks = ready.filter((t) => t.routing === 'bus');

    // 如果没有 routing 字段（旧格式兼容），全部走 direct
    const unmarkedTasks = ready.filter((t) => !t.routing);
    const allDirectTasks = [...directTasks, ...unmarkedTasks];

    const results: WorkerOutput[] = [];

    // ── 通道 1：direct ─────────────────────
    if (allDirectTasks.length > 0) {
      const directResults = await executeDirectTasks(
        allDirectTasks,
        completedTasks,
        model,
        toolRegistry,
        workspacePath,
        permissionRegistry,
        onConfirmRequired,
        agentRegistry,
      );
      results.push(...directResults);
    }

    // ── 通道 2：bus ────────────────────────
    if (busTasks.length > 0) {
      const busResults = await executeBusTasks(
        busTasks,
        completedTasks,
        eventBus,
      );
      results.push(...busResults);
    }

    // 5. 合并结果
    const newCompleted = { ...completedTasks };
    for (const result of results) {
      newCompleted[result.taskId] = result;
    }

    // 6. 检测 replan 信号
    const replanSignal = detectReplanSignal(results);

    // 7. 决定下一步动作
    let nextAction: NextAction;
    if (replanSignal) {
      nextAction = 'replan';
    } else if (waiting.length > 0) {
      nextAction = 'continue';
    } else {
      nextAction = 'finalize';
    }

    return {
      completedTasks: newCompleted,
      pendingTasks: waiting,
      nextAction,
      replanSignal,
    };
  };
}

// ---------------------------------------------------------------------------
// Direct 通道执行
// ---------------------------------------------------------------------------

/**
 * Direct 通道：从 AgentRegistry 获取 Agent 直接执行
 *
 * 当 AgentRegistry 可用时使用 Agent.executeTask()，
 * 否则回退到 WorkerAgent（兼容模式）。
 */
async function executeDirectTasks(
  tasks: SubTask[],
  completed: Record<string, WorkerOutput>,
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  workspacePath: string,
  permissionRegistry?: PermissionRegistry,
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>,
  agentRegistry?: AgentRegistry,
): Promise<WorkerOutput[]> {
  return Promise.all(
    tasks.map(async (task): Promise<WorkerOutput> => {
      const context = buildContext(task, completed);

      // 优先使用 AgentRegistry
      if (agentRegistry) {
        try {
          const agent = agentRegistry.getAgent(task.role);
          if (agent) {
            const output: AgentOutput = await agent.executeTask({
              taskId: task.id,
              description: task.description,
              context,
              onConfirmRequired,
            });
            return agentOutputToWorkerOutput(output);
          }
        } catch (error) {
          return {
            taskId: task.id,
            status: 'failed',
            error: `Agent execution failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      // 回退：WorkerAgent 兼容模式
      const worker = new WorkerAgent(
        model,
        toolRegistry,
        undefined,
        permissionRegistry,
      );

      return worker.run({
        taskId: task.id,
        description: task.description,
        tools: task.tools,
        context,
        workspacePath,
        onConfirmRequired,
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Bus 通道执行
// ---------------------------------------------------------------------------

/**
 * Bus 通道：发布 command 到 EventBus 等待 Agent 协作
 *
 * 为每个任务发布 agent.command.<role> 消息，
 * 等待 Agent 处理完成后通过 reply 返回结果。
 */
async function executeBusTasks(
  tasks: SubTask[],
  completed: Record<string, WorkerOutput>,
  eventBus?: IEventBus,
): Promise<WorkerOutput[]> {
  return Promise.all(
    tasks.map(async (task): Promise<WorkerOutput> => {
      if (!eventBus) {
        return {
          taskId: task.id,
          status: 'failed',
          error: 'EventBus not available for bus-routed task',
        };
      }

      try {
        const context = buildContext(task, completed);

        const reply = await eventBus.request(
          `agent.command.${task.role}` as any,
          {
            type: 'subtask_assigned',
            taskId: task.id,
            description: task.description,
            context,
          },
          120_000, // 2 min timeout per subtask
        );

        // 解析 Agent 的回复
        const payload = reply.payload as Record<string, unknown> | undefined;
        if (payload?.status === 'success') {
          return {
            taskId: task.id,
            status: 'success',
            result: (payload.result as string) ?? 'Task completed via bus',
            toolCalls: (payload.toolCalls as WorkerOutput['toolCalls']) ?? undefined,
          };
        } else if (payload?.status === 'replan_needed') {
          return {
            taskId: task.id,
            status: 'failed',
            error: `replan_needed: ${payload.reason ?? 'Agent requested replan'}`,
          };
        } else {
          return {
            taskId: task.id,
            status: 'failed',
            error: (payload?.error as string) ?? 'Unknown bus task error',
          };
        }
      } catch (error) {
        return {
          taskId: task.id,
          status: 'failed',
          error: `Bus task failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );
}
