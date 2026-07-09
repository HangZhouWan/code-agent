/**
 * WorkerAgent —— 子 Agent 执行器
 *
 * 负责执行 Orchestrator 派发的单个子任务。
 * 每个 Worker：
 * - 使用受限的工具集（由 AgentCapability 声明）
 * - 拥有独立的消息上下文
 * - 不直接与用户交互，只通过工具和返回结果完成工作
 *
 * 基于 LangChain createAgent() (ReactAgent) 实现，
 * 利用其内置的 ReAct 循环、工具调用、和流式处理能力。
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createAgent } from 'langchain';
import type { StructuredTool } from '@langchain/core/tools';
import { ToolRegistry } from '../tools/registry.js';
import { HooksEngine } from '../harness/hooks/engine.js';
import type { PermissionRegistry } from '../harness/sandbox/registry.js';
import type { WorkerInput, WorkerOutput } from './types.js';

// ---------------------------------------------------------------------------
// System Prompt 模板
// ---------------------------------------------------------------------------

/**
 * 构建 Worker 的 System Prompt
 *
 * 注入上下文、工作区路径和可用工具列表。
 * 任务描述通过 invoke 时的 HumanMessage 传递。
 */
function buildSystemPrompt(input: WorkerInput, toolDescriptions: string): string {
  return `You are a specialized Worker Agent. Your only job is to complete the task described in the user message using the provided tools.

## Context
${input.context || 'No additional context provided.'}

## Workspace
All file paths are relative to: ${input.workspacePath}

## Available Tools
${toolDescriptions}

## Critical Rules
1. Do NOT chat with the user. You have NO direct user interaction.
2. ONLY use the tools listed above. Do not invent or assume tools.
3. Stay strictly within the scope of your assigned task.
4. If a tool fails, try an alternative approach or clearly report the failure.
5. When the task is complete, provide a clear and complete result.
6. Do not ask clarifying questions — work with what you have.
7. Return ONLY your final result. No meta-commentary about what you did.`;
}

// ---------------------------------------------------------------------------
// WorkerAgent
// ---------------------------------------------------------------------------

/**
 * 子 Agent 执行器
 *
 * 每次调用 run() 创建一个独立的 LangChain Agent 实例，
 * 使用受限工具集执行单一子任务并返回结构化结果。
 *
 * @example
 * ```ts
 * const worker = new WorkerAgent(model, toolRegistry);
 * const output = await worker.run({
 *   taskId: 'task-1',
 *   description: 'Read package.json and report the version',
 *   tools: ['file_read'],
 *   context: '',
 *   workspacePath: './workspace',
 * });
 * ```
 */
export class WorkerAgent {
  private hooks: HooksEngine;
  private permissionRegistry: PermissionRegistry | undefined;

  constructor(
    private model: BaseChatModel,
    private toolRegistry: ToolRegistry,
    hooks?: HooksEngine,
    permissionRegistry?: PermissionRegistry,
  ) {
    this.hooks = hooks ?? new HooksEngine();
    this.permissionRegistry = permissionRegistry;
  }

  /**
   * 执行单个子任务
   *
   * 执行流程：
   * 1. 构建 AgentCapability + 获取受限工具集
   * 2. 构建 System Prompt（注入任务描述、上下文、工具列表）
   * 3. 创建 LangChain ReactAgent
   * 4. 触发 agent:start hook
   * 5. 执行 agent.invoke()（带超时控制）
   * 6. 提取结果和工具调用记录
   * 7. 触发 agent:end / agent:error hook
   *
   * @param input - Worker 输入
   * @returns Worker 输出的结构化结果
   */
  async run(input: WorkerInput): Promise<WorkerOutput> {
    const agentId = `worker-${input.taskId}`;
    const timeoutMs = input.timeoutMs ?? 60000;
    const maxIterations = input.maxIterations ?? 15;

    // 1. 获取受限工具集
    const langchainTools: StructuredTool[] = this.toolRegistry.getToolsForAgent(
      {
        tools: input.tools,
        paths: [input.workspacePath],
        timeoutMs,
        maxTokens: maxIterations,
      },
      {
        workspacePath: input.workspacePath,
        sessionId: agentId,
        onConfirmRequired: input.onConfirmRequired,
      },
      this.permissionRegistry,
    );

    if (langchainTools.length === 0) {
      return {
        taskId: input.taskId,
        status: 'failed',
        error: `No tools available for this agent. Requested: [${input.tools.join(', ')}]`,
      };
    }

    // 2. 构建工具描述（注入 System Prompt）
    const toolDescriptions = langchainTools
      .map((t) => `- **${t.name}**: ${t.description}`)
      .join('\n');
    const systemPrompt = buildSystemPrompt(input, toolDescriptions);

    // 3. 创建 LangChain Agent
    const agent = createAgent({
      model: this.model,
      tools: langchainTools,
      systemPrompt,
    });

    // 4. 触发 agent:start hook
    await this.hooks.trigger('agent:start', {
      agentId,
      data: { taskId: input.taskId, description: input.description },
    });

    try {
      // 5. 执行（带超时控制）
      const result = await this.executeWithTimeout(
        agent,
        input.description,
        timeoutMs,
      );

      // 6. 提取工具调用记录
      const toolCalls = this.extractToolCalls(result.messages ?? []);

      // 7. 提取最终回复
      const finalOutput = this.extractFinalOutput(result.messages ?? []);

      // 8. 触发 agent:end hook
      await this.hooks.trigger('agent:end', {
        agentId,
        data: { taskId: input.taskId, result: finalOutput },
      });

      return {
        taskId: input.taskId,
        status: 'success',
        result: finalOutput,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      // 超时处理
      if (error instanceof Error && error.message.includes('timed out')) {
        return {
          taskId: input.taskId,
          status: 'timeout',
          error: `Task timed out after ${timeoutMs}ms`,
        };
      }

      // 触发 agent:error hook
      await this.hooks.trigger('agent:error', {
        agentId,
        data: {
          taskId: input.taskId,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      return {
        taskId: input.taskId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // -----------------------------------------------------------------------
  // 私有辅助方法
  // -----------------------------------------------------------------------

  /**
   * 带超时控制的 Agent 执行
   *
   * 使用 Promise.race 在超时后中断 Agent 的执行。
   * ReactAgent.invoke() 接受 state 参数并返回 MergedAgentState（包含 messages 数组）。
   *
   * 任务描述通过 HumanMessage 传递，与 System Prompt 中的规则/上下文分离。
   */
  private async executeWithTimeout(
    agent: ReturnType<typeof createAgent>,
    description: string,
    timeoutMs: number,
  ): Promise<{ messages: Array<HumanMessage | AIMessage | ToolMessage> }> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Agent execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const invokePromise = agent.invoke({
      messages: [new HumanMessage(description)],
    }) as Promise<{ messages: Array<HumanMessage | AIMessage | ToolMessage> }>;

    return Promise.race([invokePromise, timeoutPromise]);
  }

  /**
   * 从消息历史中提取工具调用记录
   *
   * 找出所有 AIMessage 中的 tool_calls 和对应的 ToolMessage 结果。
   */
  private extractToolCalls(
    messages: Array<HumanMessage | AIMessage | ToolMessage>,
  ): Array<{ tool: string; args: Record<string, unknown>; result: string }> {
    const toolCalls: Array<{
      tool: string;
      args: Record<string, unknown>;
      result: string;
    }> = [];

    // 按 tool_call_id 索引 ToolMessage 的结果
    const toolResults = new Map<string, string>();
    for (const msg of messages) {
      if (msg instanceof ToolMessage) {
        const content =
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        toolResults.set(msg.tool_call_id, content);
      }
    }

    // 遍历 AIMessage，收集工具调用及其结果
    for (const msg of messages) {
      if (msg instanceof AIMessage && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCalls.push({
            tool: tc.name,
            args: (tc.args ?? {}) as Record<string, unknown>,
            result: toolResults.get(tc.id ?? '') ?? 'No result recorded',
          });
        }
      }
    }

    return toolCalls;
  }

  /**
   * 从消息历史中提取最终输出文本
   *
   * 取最后一条 AIMessage（不含 tool_calls 或 tool_calls 为空）的 content。
   */
  private extractFinalOutput(
    messages: Array<HumanMessage | AIMessage | ToolMessage>,
  ): string {
    // 从后往前找第一条 AIMessage
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg instanceof AIMessage) {
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
        if (content && content.trim().length > 0) {
          return content;
        }
      }
    }
    return 'No output produced.';
  }
}
