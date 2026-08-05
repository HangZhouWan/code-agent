/**
 * Orchestrator —— Planner 节点
 *
 * 职责：将用户的自然语言请求分解为结构化 Plan，
 * 包含复杂度判定（simple/complex）、子任务路由（direct/bus）和角色分配。
 *
 * 执行逻辑：
 * 1. 提取最后一条用户消息
 * 2. 构建计划 System Prompt（包含可用 Agent 列表 + 工具列表）
 * 3. 调用 LLM 生成 JSON Plan
 * 4. 解析并返回 { plan, pendingTasks }
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { ToolRegistry, ToolNames, type ToolDefinition } from '@code-agent/core';
import type { AgentRegistry } from '@code-agent/core';
import type { IOrchestratorCheckpointManager, SerializedMessage } from '@code-agent/core';
import type { SubTask, Plan } from '../types.js';

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

/**
 * 计划器 System Prompt 模板
 *
 * 注入可用 Agent 列表和工具列表，让 LLM 能为每个子任务分配
 * 合适的角色、路由方式和工具。
 */
function buildPlannerPrompt(
  availableAgents: Array<{ role: string; description: string; tools: string[] }>,
  availableTools: ToolDefinition[],
): string {
  const agentList = availableAgents
    .map((a) => `- **${a.role}**: ${a.description} (tools: ${a.tools.join(', ')})`)
    .join('\n');

  const toolList = availableTools
    .map((t) => `- **${t.name}**: ${t.description}`)
    .join('\n');

  return `You are a Task Planner. Your job is to break down a user's request into a structured execution plan.

## Available Agents
${agentList}

## Available Tools
${toolList}

## Instructions
1. Analyze the user's request and identify distinct subtasks.
2. Each subtask should be as independent as possible to enable parallel execution.
3. Only declare \`dependsOn\` when a subtask genuinely requires the output of another subtask.
4. Determine the overall complexity:
   - **simple**: All tasks can be handled by a single Agent role → routing: "direct"
   - **complex**: Multiple roles are needed, or tasks require inter-Agent discussion → routing: "bus"
5. Assign each subtask to a responsible Agent role (role field) from the Available Agents list.
6. Assign routing for each subtask:
   - **direct**: Simple, independent task — Planner calls Agent directly
   - **bus**: Complex task requiring collaboration — published to EventBus
7. Assign appropriate tools to each subtask from the available tools list above.
8. Use concise, actionable descriptions for each subtask.
9. The plan MUST be a valid JSON object with the following structure:

\`\`\`json
{
  "complexity": "simple",
  "tasks": [
    {
      "id": "unique-task-id",
      "description": "Clear description of what to do",
      "tools": ["tool_name", "another_tool"],
      "dependsOn": [],
      "routing": "direct",
      "role": "code"
    }
  ],
  "suggestedAgents": {
    "unique-task-id": "code"
  }
}
\`\`\`

## Complexity Rules
| Condition | complexity | routing |
|-----------|-----------|---------|
| All tasks same role | simple | direct |
| Only one task | simple | direct |
| Multiple roles involved | complex | per-task direct/bus |
| Tasks need mutual discussion | complex | bus |

## Rules
- Each task ID must be unique (e.g., "task-1", "task-2", ...).
- The tools array must only contain tools from the available tools list.
- The dependsOn array must only reference other task IDs from the same plan.
- Every task must have a valid "routing" and "role" field.
- suggestedAgents must map every task ID to its assigned role.
- Return ONLY the JSON object, nothing else — no markdown code fences, no explanation.`;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 从 LLM 响应中提取 JSON 对象
 *
 * 处理 LLM 可能添加的 markdown 代码块包裹和多余文本。
 * 导出以供单元测试。
 */
export function extractJsonObject(content: string): string {
  // 尝试提取 ```json ... ``` 代码块
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // 尝试找到第一个 { 和最后一个 }
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return content.slice(firstBrace, lastBrace + 1).trim();
  }

  return content.trim();
}

/**
 * 从 LLM 响应中提取 JSON 数组（保留兼容旧格式）
 *
 * 处理 LLM 可能添加的 markdown 代码块包裹和多余文本。
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
 * 导出以供单元测试。
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

  // routing 默认值：bus（安全默认，需要显式指定 direct 才走直接通道）
  const routing = (obj.routing === 'direct' || obj.routing === 'bus')
    ? obj.routing as 'direct' | 'bus'
    : 'bus';

  // role 默认值：code（最常见的角色）
  const role = typeof obj.role === 'string' && obj.role.length > 0
    ? obj.role
    : 'code';

  return {
    id: obj.id,
    description: obj.description,
    tools: Array.isArray(obj.tools)
      ? obj.tools.map((t: unknown) => String(t))
      : [],
    dependsOn: Array.isArray(obj.dependsOn)
      ? obj.dependsOn.map((d: unknown) => String(d))
      : undefined,
    routing,
    role,
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
 * @param agentRegistry - Agent 注册表，用于列出可用 Agent 角色
 * @param checkpointManager - Orchestrator 检查点管理器（可选），用于在计划生成后保存检查点
 * @param sessionId - 会话 ID（可选），用于保存检查点
 * @returns LangGraph 节点函数
 */
export function createPlannerNode(
  model: BaseChatModel,
  toolRegistry: ToolRegistry,
  agentRegistry?: AgentRegistry,
  checkpointManager?: IOrchestratorCheckpointManager,
  sessionId?: string,
) {
  const availableTools = toolRegistry.listAll();

  // 构建可用 Agent 列表
  const availableAgents = agentRegistry
    ? agentRegistry.listRoles().map((r) => ({
        role: r.id,
        description: r.description,
        tools: r.defaultTools,
      }))
    : [
        {
          role: 'code',
          description: 'Responsible for reading, writing, and modifying code files.',
          tools: [
            ToolNames.FILE_READ, ToolNames.FILE_WRITE, ToolNames.FILE_LIST,
            ToolNames.CODE_SEARCH, ToolNames.SHELL_EXEC,
            ToolNames.GIT_STATUS, ToolNames.GIT_DIFF, ToolNames.GIT_LOG,
            ToolNames.GIT_COMMIT, ToolNames.GIT_BRANCH,
            ToolNames.WEB_FETCH,
          ],
        },
        {
          role: 'test',
          description: 'Responsible for running tests and analyzing failures.',
          tools: [
            ToolNames.SHELL_EXEC,
            ToolNames.FILE_READ, ToolNames.FILE_WRITE, ToolNames.FILE_LIST,
            ToolNames.CODE_SEARCH,
            ToolNames.WEB_FETCH,
          ],
        },
        {
          role: 'doc',
          description: 'Responsible for generating documentation and README files.',
          tools: [
            ToolNames.FILE_READ, ToolNames.FILE_WRITE, ToolNames.FILE_LIST,
            ToolNames.CODE_SEARCH,
            ToolNames.WEB_FETCH,
          ],
        },
      ];

  const systemPrompt = buildPlannerPrompt(availableAgents, availableTools);

  return async function plannerNode(state: {
    messages: Array<HumanMessage | SystemMessage>;
  }): Promise<{ plan: Plan; pendingTasks: SubTask[] }> {
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

    // 解析 JSON —— 先尝试提取 JSON 内容
    // 检测响应是数组格式还是对象格式
    const trimmed = responseText.trim();
    const isArrayFormat = trimmed.startsWith('[') || trimmed.includes('"tasks"') === false;

    let jsonStr: string;
    if (isArrayFormat) {
      // 可能是旧格式数组
      jsonStr = extractJsonArray(responseText);
    } else {
      // 新格式 Plan 对象
      jsonStr = extractJsonObject(responseText);
    }

    let rawPlan: unknown;
    try {
      rawPlan = JSON.parse(jsonStr);
    } catch {
      // 如果第一次解析失败且不是数组格式，尝试用数组格式解析
      if (!isArrayFormat) {
        try {
          jsonStr = extractJsonArray(responseText);
          rawPlan = JSON.parse(jsonStr);
        } catch {
          throw new Error(
            `Planner failed to produce valid JSON. Response:\n${responseText}`,
          );
        }
      } else {
        throw new Error(
          `Planner failed to produce valid JSON. Response:\n${responseText}`,
        );
      }
    }

    // 兼容旧格式：如果 LLM 返回的是数组，包装为 Plan
    let plan: Plan;
    if (Array.isArray(rawPlan)) {
      const tasks = rawPlan.map((item: unknown, i: number) => validateSubTask(item, i));
      const uniqueRoles = new Set(tasks.map((t) => t.role));
      plan = {
        complexity: uniqueRoles.size <= 1 ? 'simple' : 'complex',
        tasks,
        suggestedAgents: Object.fromEntries(tasks.map((t) => [t.id, t.role])),
      };
    } else if (typeof rawPlan === 'object' && rawPlan !== null) {
      // 新格式：完整的 Plan 对象
      const obj = rawPlan as Record<string, unknown>;
      const complexity = obj.complexity === 'simple' || obj.complexity === 'complex'
        ? obj.complexity as 'simple' | 'complex'
        : 'simple';

      const rawTasks = obj.tasks;
      if (!Array.isArray(rawTasks)) {
        throw new Error(
          `Planner response has no valid "tasks" array. Response:\n${responseText}`,
        );
      }

      const tasks = rawTasks.map((item: unknown, i: number) => validateSubTask(item, i));

      const suggestedAgents: Record<string, string> = {};
      if (obj.suggestedAgents && typeof obj.suggestedAgents === 'object') {
        for (const [key, value] of Object.entries(obj.suggestedAgents)) {
          if (typeof value === 'string') {
            suggestedAgents[key] = value;
          }
        }
      }
      // 补齐 missing task mappings
      for (const task of tasks) {
        if (!suggestedAgents[task.id]) {
          suggestedAgents[task.id] = task.role;
        }
      }

      plan = { complexity, tasks, suggestedAgents };
    } else {
      throw new Error(
        `Planner response is neither an array nor a valid Plan object. Response:\n${responseText}`,
      );
    }

    // ── Save orchestrator checkpoint after plan generation ──
    if (checkpointManager && sessionId) {
      const serializedMessages = state.messages.map((m) => ({
        role: (m.getType?.() ?? 'unknown') as SerializedMessage['role'],
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }));

      checkpointManager.save(sessionId, {
        sessionId,
        messages: serializedMessages,
        plan,
        progress: {
          currentNode: 'planner',
          completedTaskIds: [],
        },
      }).catch((err) => {
        console.error(
          `[orchestrator-checkpoint] Failed to save after planner:`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }

    return { plan, pendingTasks: plan.tasks };
  };
}
