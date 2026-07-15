/**
 * Orchestrator —— Replanner 节点
 *
 * 职责：当 Dispatcher 检测到 replan_needed 信号时，
 * 分析失败原因并用 LLM 生成修正后的计划。
 *
 * 执行逻辑：
 * 1. 读取 replanSignal（失败任务信息）
 * 2. 读取 completedTasks（已完成的任务）
 * 3. 读取原有 plan
 * 4. 调用 LLM 生成修正后的任务列表
 * 5. 将新任务放入 pendingTasks
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { WorkerOutput } from '@my-agent/core';
import type { SubTask, Plan, ReplanSignal } from '../types.js';
import { extractJsonArray, validateSubTask } from './planner.js';

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const REPLANNER_SYSTEM_PROMPT = `You are a Plan Reviser. A subtask execution indicated the current plan needs adjustment.

## Instructions
1. Analyze the issue described in the Replan Signal.
2. Review the remaining uncompleted tasks.
3. Determine what needs to change: add, remove, reorder, or modify tasks.
4. Return a valid JSON array of the adjusted remaining SubTask objects.
5. Keep completed tasks OUT of the new plan — only return tasks that still need to run.
6. Preserve dependency relationships where possible; update them if necessary.
7. Each task must have: id, description, tools, dependsOn (array), routing, role.

## Output Format
\`\`\`json
[
  {
    "id": "task-id",
    "description": "What to do",
    "tools": ["tool_name"],
    "dependsOn": [],
    "routing": "direct",
    "role": "code"
  }
]
\`\`\`

## Rules
- Task IDs must be unique.
- Use the same routing rules as the original plan (direct for simple, bus for complex).
- Only return the JSON array, nothing else.`;

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 构建已完成任务的摘要
 */
function buildCompletedSummary(
  completedTasks: Record<string, WorkerOutput>,
): string {
  const entries = Object.entries(completedTasks);
  if (entries.length === 0) {
    return 'No tasks completed yet.';
  }

  return entries
    .map(([taskId, output]) => {
      const status = output.status;
      const summary = (output.result ?? output.error ?? 'No output').slice(0, 300);
      return `- **${taskId}** (${status}): ${summary}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Node 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Replanner 节点
 *
 * @param model - LLM 实例，用于生成修正后的计划
 * @returns LangGraph 节点函数
 */
export function createReplannerNode(model: BaseChatModel) {
  return async function replannerNode(state: {
    plan: Plan;
    completedTasks: Record<string, WorkerOutput>;
    replanSignal: ReplanSignal | null;
  }): Promise<{
    plan: Plan;
    pendingTasks: SubTask[];
    nextAction: 'continue';
    replanSignal: null;
  }> {
    const { plan, completedTasks, replanSignal } = state;

    if (!replanSignal) {
      // 无 replan 信号，跳过
      return {
        plan,
        pendingTasks: plan.tasks,
        nextAction: 'continue',
        replanSignal: null,
      };
    }

    // 构建已完成任务的摘要
    const completedSummary = buildCompletedSummary(completedTasks);

    // 提取未完成的任务 ID
    const completedIds = new Set(Object.keys(completedTasks));
    const remainingTasks = plan.tasks.filter((t) => !completedIds.has(t.id));

    // 构建原计划摘要（仅未完成任务）
    const originalPlanSummary = JSON.stringify(remainingTasks, null, 2);

    // 调用 LLM 生成修正计划
    const response = await model.invoke([
      new SystemMessage(REPLANNER_SYSTEM_PROMPT),
      new HumanMessage(
        `## Original Plan (remaining tasks)\n${originalPlanSummary}\n\n` +
          `## Completed Tasks\n${completedSummary}\n\n` +
          `## Replan Signal\n` +
          `- Source Task: ${replanSignal.sourceTaskId}\n` +
          `- Reason: ${replanSignal.reason}\n` +
          `- Suggestion: ${replanSignal.suggestion}\n\n` +
          `Please provide the adjusted plan for the remaining tasks.`,
      ),
    ]);

    const responseText =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // 解析 JSON
    const jsonStr = extractJsonArray(responseText);
    let rawTasks: unknown[];
    try {
      rawTasks = JSON.parse(jsonStr);
    } catch {
      throw new Error(
        `Replanner failed to produce valid JSON. Response:\n${responseText}`,
      );
    }

    if (!Array.isArray(rawTasks)) {
      throw new Error(
        `Replanner response is not an array. Response:\n${responseText}`,
      );
    }

    // 验证并清理每个子任务
    const newTasks = rawTasks.map((item, i) => validateSubTask(item, i));

    // 构建修正后的 Plan
    const revisedPlan: Plan = {
      complexity: plan.complexity,
      tasks: newTasks,
      suggestedAgents: Object.fromEntries(newTasks.map((t) => [t.id, t.role])),
    };

    return {
      plan: revisedPlan,
      pendingTasks: newTasks,
      nextAction: 'continue',
      replanSignal: null,
    };
  };
}
