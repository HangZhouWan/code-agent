/**
 * WorkerAgent —— 子 Agent 执行器（兼容层）
 *
 * 保留 WorkerAgent 公开 API，内部委托给 Agent 基类。
 * 保证现有 Dispatcher 调用不受影响。
 *
 * 两种执行路径：
 * 1. Agent 委托（推荐）：当提供 eventBus + stateManager 时，委托给 Agent 基类
 * 2. LangChain 原生（兼容）：当仅提供 model + toolRegistry 时，使用 LangChain createAgent
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

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { createAgent } from 'langchain';
import type { StructuredTool } from '@langchain/core/tools';
import { ToolRegistry } from '../tools/registry.js';
import { HooksEngine } from '../harness/hooks/engine.js';
import type { PermissionRegistry } from '../harness/sandbox/registry.js';
import type { IEventBus } from '../event-bus/types.js';
import type { IStateManager } from '../state/types.js';
import { InMemoryEventBus } from '../event-bus/bus.js';
import { InMemoryStateManager } from '../state/manager.js';
import { ExecutionEngine } from '../harness/execution/engine.js';
import type { ICheckpointManager } from '../harness/execution/checkpoint.js';
import type { IMemoryManager } from '../harness/memory/types.js';
import { ContextManager } from '../harness/context/manager.js';
import { Agent } from './agent.js';
import type { AgentRole } from './role.js';
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
// Worker Agent 角色定义
// ---------------------------------------------------------------------------

/**
 * Worker Agent 的默认角色
 *
 * 通用 worker，不订阅任何 Bus topic，只能通过 direct 路径调用。
 */
const WORKER_ROLE: AgentRole = {
  id: 'worker',
  name: 'Worker Agent',
  description: 'General-purpose worker agent for executing isolated sub-tasks.',
  systemPrompt: '', // 动态构建
  commandSubscriptions: [],
  eventSubscriptions: [],
  defaultTools: [],
  canDelegate: false,
  delegatableRoles: [],
};

// ---------------------------------------------------------------------------
// WorkerAgent（兼容层）
// ---------------------------------------------------------------------------

/**
 * 子 Agent 执行器（兼容层）
 *
 * 公开 API 不变，内部委托给 Agent 基类。
 * 当依赖不足时自动回退到 LangChain 原生路径。
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
  private engine: ExecutionEngine | null = null;

  // Agent 委托所需依赖
  private eventBus: IEventBus;
  private stateManager: IStateManager;
  private contextManager: ContextManager;

  // 懒初始化的 Agent 实例
  private _agent: Agent | null = null;

  constructor(
    private model: BaseChatModel,
    private toolRegistry: ToolRegistry,
    hooks?: HooksEngine,
    permissionRegistry?: PermissionRegistry,
    eventBus?: IEventBus,
    stateManager?: IStateManager,
    checkpoint?: ICheckpointManager,
    memory?: IMemoryManager,
  ) {
    this.hooks = hooks ?? new HooksEngine();
    this.permissionRegistry = permissionRegistry;

    // 初始化 EventBus（提供或创建内置实例）
    this.eventBus = eventBus ?? new InMemoryEventBus();
    // 初始化 StateManager（提供或创建内置实例）
    this.stateManager = stateManager ?? new InMemoryStateManager();
    // 初始化 ContextManager
    this.contextManager = new ContextManager();

    // 可选：启用 ExecutionEngine（当 checkpoint 或 memory 提供时）
    if (checkpoint || memory || eventBus) {
      this.engine = new ExecutionEngine(checkpoint, memory, this.eventBus);
    }
  }

  /**
   * 执行单个子任务
   *
   * 优先使用 Agent 委托路径，当 engine 不可用时回退到 LangChain 原生路径。
   *
   * @param input - Worker 输入
   * @returns Worker 输出的结构化结果
   */
  async run(input: WorkerInput): Promise<WorkerOutput> {
    // 路径 1：Agent 委托（推荐）
    if (this.engine) {
      return this.runWithAgent(input);
    }

    // 路径 2：LangChain 原生（兼容模式）
    return this.runWithLangChain(input);
  }

  // -----------------------------------------------------------------------
  // 路径 1：Agent 委托
  // -----------------------------------------------------------------------

  /**
   * 委托给 Agent 基类执行
   *
   * 懒初始化 Agent 实例，然后调用 agent.executeTask()。
   */
  private async runWithAgent(input: WorkerInput): Promise<WorkerOutput> {
    if (!this.engine) {
      throw new Error('ExecutionEngine not initialized');
    }

    // 懒初始化 Agent
    if (!this._agent) {
      const toolDescriptions = this.toolRegistry
        .listAll()
        .map((t) => `- **${t.name}**: ${t.description}`)
        .join('\n');

      this._agent = new Agent({
        role: {
          ...WORKER_ROLE,
          systemPrompt: buildSystemPrompt(input, toolDescriptions),
          defaultTools: input.tools,
        },
        model: this.model,
        engine: this.engine,
        eventBus: this.eventBus,
        stateManager: this.stateManager,
        toolRegistry: this.toolRegistry,
        contextManager: this.contextManager,
        hooks: this.hooks,
        permissionRegistry: this.permissionRegistry,
        workspacePath: input.workspacePath,
        capability: {
          tools: input.tools,
          paths: [input.workspacePath],
          maxTokens: input.maxIterations ?? 15,
          timeoutMs: input.timeoutMs ?? 60000,
        },
      });
    }

    // 委托给 Agent.executeTask()
    const result = await this._agent.executeTask({
      taskId: input.taskId,
      description: input.description,
      context: input.context,
      maxIterations: input.maxIterations,
      timeoutMs: input.timeoutMs,
      onConfirmRequired: input.onConfirmRequired,
    });

    // 映射 AgentOutput → WorkerOutput
    const status: WorkerOutput['status'] =
      result.status === 'replan_needed' ? 'failed' : result.status;

    return {
      taskId: result.taskId,
      status,
      result: result.result,
      error: result.error,
      toolCalls: result.toolCalls?.length ? result.toolCalls : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // 路径 2：LangChain 原生（兼容模式）
  // -----------------------------------------------------------------------

  /**
   * 使用 LangChain createAgent 执行（兼容模式）
   *
   * 保留原有执行逻辑，确保未提供新依赖的调用方不受影响。
   */
  private async runWithLangChain(input: WorkerInput): Promise<WorkerOutput> {
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

    // 2. 构建工具描述
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
   */
  private extractToolCalls(
    messages: Array<HumanMessage | AIMessage | ToolMessage>,
  ): Array<{ tool: string; args: Record<string, unknown>; result: string }> {
    const toolCalls: Array<{
      tool: string;
      args: Record<string, unknown>;
      result: string;
    }> = [];

    const toolResults = new Map<string, string>();
    for (const msg of messages) {
      if (msg instanceof ToolMessage) {
        const content =
          typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        toolResults.set(msg.tool_call_id, content);
      }
    }

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
   */
  private extractFinalOutput(
    messages: Array<HumanMessage | AIMessage | ToolMessage>,
  ): string {
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
