/**
 * Orchestrator —— Planner 节点
 *
 * 职责：将用户的自然语言请求分解为可并行/串行执行的子任务列表（SubTask[]）。
 *
 * 执行逻辑：
 * 1. 提取最后一条用户消息
 * 2. 构建计划 System Prompt（包含可用工具列表）
 * 3. 调用 LLM 生成 JSON 数组
 * 4. 解析并返回 { plan, pendingTasks }
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { ToolRegistry, type ToolDefinition } from '@my-agent/core';
import type { SubTask } from '../types.js';

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

/**
 * 计划器 System Prompt 模板
 *
 * 注入可用工具列表，让 LLM 能为每个子任务分配合适的工具。
 */
function buildPlannerPrompt(availableTools: ToolDefinition[]): string {
  const toolList = availableTools
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join('\n');

  return `You are a Task Planner. Your job is to break down a user's request into a sequence of subtasks.

## Available Tools
${toolList}

## Instructions
1. Analyze the user's request and identify distinct subtasks.
2. Each subtask should be as independent as possible to enable parallel execution.
3. Only declare \`dependsOn\` when a subtask genuinely requires the output of another subtask.
4. Assign appropriate tools to each subtask from the available tools list above.
5. Use concise, actionable descriptions for each subtask.
6. The plan MUST be a valid JSON array of objects with the following structure:

\`\`\`json
[
  {
    "id": "unique-task-id",
    "description": "Clear description of what to do",
    "tools": ["tool_name", "another_tool"],
    "dependsOn": []  // or ["other-task-id"] if this task depends on another
  }
]
\`\`\`

## Rules
- Each task ID must be unique (e.g., "task-1", "task-2", ...).
- The tools array must only contain tools from the available tools list.
- The dependsOn array must only reference other task IDs from the same plan.
- Return ONLY the JSON array, nothing else — no markdown code fences, no explanation.`;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 从 LLM 响应中提取 JSON 数组
 *
 * 处理 LLM 可能添加的 markdown 代码块包裹和多余文本。
 * 导出以供单元测试。
 */
export function extractJsonArray(content: string): string {
  // 尝试提取 ```json ... ``` 代码块
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 尝试找到第一个 [ 和最后一个 ]
  const firstBracket = content.indexOf('[');
  const lastBracket = content.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return content.slice(firstBracket, lastBracket + 1).trim();
  }

  return content.trim();
}

/**
 * 验证并清理单个子任务
 *
 * 确保必填字段存在且有合理默认值。
 */
export function validateSubTask(item: unknown, index: number): SubTask {
  const obj = item as Record<string, unknown>;

  if (!obj.id || typeof obj.id !== 'string') {
    throw new Error(`SubTask at index ${index} is missing required "id" field`);
  }
  if (!obj.description || typeof obj.description !== 'string') {
    throw new Error(
      `SubTask "${obj.id}" is missing required "description" field`,
    );
  }

  return {
    id: obj.id,
    description: obj.description,
    tools: Array.isArray(obj.tools)
      ? obj.tools.map((t: unknown) => String(t))
      : [],
    dependsOn: Array.isArray(obj.dependsOn)
      ? obj.dependsOn.map((d: unknown) => String(d))
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Node 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Planner 节点
 *
 * @param model - LLM 实例，用于生成计划
 * @param toolRegistry - 工具注册表，用于列出可用工具
 * @returns LangGraph 节点函数
 */
export function createPlannerNode(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
) {
  const availableTools = toolRegistry.listAll();
  const systemPrompt = buildPlannerPrompt(availableTools);

  return async function plannerNode(state: {
    messages: Array<HumanMessage | SystemMessage>;
  }): Promise<{ plan: SubTask[]; pendingTasks: SubTask[] }> {
    if (state.messages.length === 0) {
      throw new Error('Planner requires at least one user message');
    }

    // 提取最后一条用户消息
    const lastMessage = state.messages[state.messages.length - 1];
    const userRequest =
      typeof lastMessage.content === 'string'
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

    // 调用 LLM 生成计划
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userRequest),
    ]);

    const responseText =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // 解析 JSON
    const jsonStr = extractJsonArray(responseText);
    let rawPlan: unknown[];
    try {
      rawPlan = JSON.parse(jsonStr);
    } catch {
      throw new Error(
        `Planner failed to produce valid JSON. Response:\n${responseText}`,
      );
    }

    if (!Array.isArray(rawPlan)) {
      throw new Error(
        `Planner response is not an array. Response:\n${responseText}`,
      );
    }

    // 验证并清理每个子任务
    const plan = rawPlan.map((item, i) => validateSubTask(item, i));

    return { plan, pendingTasks: plan };
  };
}
