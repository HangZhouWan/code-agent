/**
 * Orchestrator —— Finalizer 节点
 *
 * 职责：汇总所有 Worker 的执行结果和产物，生成最终的用户回复。
 *
 * 相比旧 Summarizer：
 * - 增加了产物展示（文件变更、commit、测试结果）
 * - 不再负责上下文压缩（由 Agent Runtime 的 ContextManager 处理）
 *
 * 执行逻辑：
 * 1. 遍历 completedTasks，生成每个子任务的状态摘要
 * 2. 收集 artifacts（文件变更、commit、测试结果）
 * 3. 拼接原始用户请求 + Worker 输出 + 产物
 * 4. 调用 LLM 生成 Markdown 格式的最终回复
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { WorkerOutput, IOrchestratorCheckpointManager } from '@code-agent/core';
import type { Artifacts } from '../types.js';

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const FINALIZER_SYSTEM_PROMPT = `You are a Result Finalizer. Your job is to compile the results of completed subtasks and produced artifacts into a clear, comprehensive final response.

## Instructions
1. Review all subtask results below.
2. Highlight successes and clearly note any failures.
3. Include the artifacts produced (files changed, commits, test results).
4. Synthesize the findings into a coherent response that addresses the user's original request.
5. Use clear Markdown formatting: headings, bullet points, and code blocks as appropriate.
6. Be concise but complete — the user should understand what was done and what was found.
7. If any subtasks failed, explain what went wrong and suggest next steps.
8. Do NOT mention the internal task IDs or the orchestration process. Focus on the outcomes.
9. Write in the user's language.`;

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

/**
 * 构建产物摘要
 */
function buildArtifactsSummary(artifacts: Artifacts): string {
  const parts: string[] = [];

  // 文件变更
  if (artifacts.files.length > 0) {
    const fileList = artifacts.files
      .map((f) => `- ${f.action} \`${f.path}\` (by ${f.agentRole})`)
      .join('\n');
    parts.push(`### Files Changed (${artifacts.files.length})\n${fileList}`);
  }

  // Commits
  if (artifacts.commits.length > 0) {
    const commitList = artifacts.commits
      .map((c) => `- \`${c.hash.slice(0, 7)}\` ${c.message}`)
      .join('\n');
    parts.push(`### Commits (${artifacts.commits.length})\n${commitList}`);
  }

  // 测试结果
  if (artifacts.tests.length > 0) {
    const testSummaries = artifacts.tests.map((t) => {
      const passRate = t.total > 0 ? Math.round((t.passed / t.total) * 100) : 0;
      return `- **${t.taskId}**: ${t.passed}/${t.total} passed (${passRate}%)` +
        (t.failed > 0 ? ` — ${t.failed} failed` : '');
    });
    parts.push(`### Test Results\n${testSummaries.join('\n')}`);
  }

  if (parts.length === 0) {
    return 'No artifacts were produced.';
  }

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Node 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 Finalizer 节点
 *
 * @param model - LLM 实例，用于生成最终回复
 * @param checkpointManager - Orchestrator 检查点管理器（可选），用于在成功输出后清除检查点
 * @param sessionId - 会话 ID（可选），用于清除检查点
 * @returns LangGraph 节点函数
 */
export function createFinalizerNode(
  model: BaseChatModel,
  checkpointManager?: IOrchestratorCheckpointManager,
  sessionId?: string,
) {
  return async function finalizerNode(state: {
    messages: Array<HumanMessage | SystemMessage>;
    completedTasks: Record<string, WorkerOutput>;
    artifacts?: Artifacts;
  }): Promise<{ finalResponse: string }> {
    const { messages, completedTasks, artifacts } = state;

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

    // 构建产物摘要
    const artifactsSummary = artifacts
      ? buildArtifactsSummary(artifacts)
      : 'No artifacts recorded.';

    // 调用 LLM 生成最终回复
    const response = await model.invoke([
      new SystemMessage(FINALIZER_SYSTEM_PROMPT),
      new HumanMessage(
        `## User's Original Request\n${userRequest}\n\n` +
          `## Subtask Results\n${resultsSummary}\n\n` +
          `## Artifacts Produced\n${artifactsSummary}\n\n` +
          `Please provide a comprehensive final response synthesizing these results.`,
      ),
    ]);

    const finalResponse =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // ── Purge orchestrator checkpoint on success ──
    if (checkpointManager && sessionId) {
      checkpointManager.purge(sessionId).catch((err) => {
        console.error(
          `[orchestrator-checkpoint] Failed to purge checkpoint for session "${sessionId}":`,
          err instanceof Error ? err.message : String(err),
        );
      });
    }

    return { finalResponse };
  };
}
