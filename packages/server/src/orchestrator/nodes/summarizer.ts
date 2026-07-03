/**
 * Orchestrator —— Summarizer 节点
 *
 * 职责：汇总所有 Worker 的执行结果，生成最终的用户回复。
 *
 * 执行逻辑：
 * 1. 遍历 completedTasks，生成每个子任务的状态摘要
 * 2. 拼接原始用户请求 + Worker 输出
 * 3. 调用 LLM 生成 Markdown 格式的最终回复
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { WorkerOutput } from '@my-agent/core';

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const SUMMARIZER_SYSTEM_PROMPT = `You are a Result Summarizer. Your job is to compile the results of completed subtasks into a clear, comprehensive final response.

## Instructions
1. Review all subtask results below.
2. Highlight successes and clearly note any failures.
3. Synthesize the findings into a coherent response that addresses the user's original request.
4. Use clear Markdown formatting: headings, bullet points, and code blocks as appropriate.
5. Be concise but complete — the user should understand what was done and what was found.
6. If any subtasks failed, explain what went wrong and suggest next steps.
7. Do NOT mention the internal task IDs or the orchestration process. Focus on the outcomes.
8. Write in the user's language.`;

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 构建 Worker 结果的状态摘要
 *
 * 按成功/失败分类，生成 Markdown 格式的摘要列表。
 */
function buildResultsSummary(completedTasks: Record<string, WorkerOutput>): string {
  const entries = Object.entries(completedTasks);

  if (entries.length === 0) {
    return 'No subtasks were completed.';
  }

  const successEntries: string[] = [];
  const failureEntries: string[] = [];

  for (const [taskId, output] of entries) {
    const summary = output.result ?? output.error ?? 'No output';
    const truncated =
      summary.length > 500 ? summary.slice(0, 500) + '...' : summary;

    if (output.status === 'success') {
      successEntries.push(
        `### ✅ Task Completed\n` +
          `**Result:** ${truncated}`,
      );
    } else {
      failureEntries.push(
        `### ❌ Task Failed (${output.status})\n` +
          `**Error:** ${truncated}`,
      );
    }
  }

  const parts: string[] = [];
  if (successEntries.length > 0) {
    parts.push(
      `**Successful tasks (${successEntries.length}/${entries.length}):**\n`,
      ...successEntries,
    );
  }
  if (failureEntries.length > 0) {
    parts.push(
      `\n**Failed tasks (${failureEntries.length}/${entries.length}):**\n`,
      ...failureEntries,
    );
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Node 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Summarizer 节点
 *
 * @param model - LLM 实例，用于生成最终回复
 * @returns LangGraph 节点函数
 */
export function createSummarizerNode(model: BaseChatModel) {
  return async function summarizerNode(state: {
    messages: Array<HumanMessage | SystemMessage>;
    completedTasks: Record<string, WorkerOutput>;
  }): Promise<{ finalResponse: string }> {
    const { messages, completedTasks } = state;

    // 提取用户原始请求
    const lastUserMessage = messages
      .filter((m) => m instanceof HumanMessage)
      .at(-1);
    const userRequest =
      lastUserMessage && typeof lastUserMessage.content === 'string'
        ? lastUserMessage.content
        : 'User request not available';

    // 构建结果摘要
    const resultsSummary = buildResultsSummary(completedTasks);

    // 调用 LLM 生成最终回复
    const response = await model.invoke([
      new SystemMessage(SUMMARIZER_SYSTEM_PROMPT),
      new HumanMessage(
        `## User's Original Request\n${userRequest}\n\n` +
          `## Subtask Results\n${resultsSummary}\n\n` +
          `Please provide a comprehensive final response synthesizing these results.`,
      ),
    ]);

    const finalResponse =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    return { finalResponse };
  };
}
