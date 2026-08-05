/**
 * ExecutionEngine —— Agent 执行引擎
 *
 * 驱动 ReAct 循环（Observe → Think → Act → Reflect），
 * 是 Agent 执行的引擎。与 Checkpoint、Memory、EventBus 协作，
 * 提供完整的中断恢复和记忆管理能力。
 *
 * 核心职责：
 * - 管理 ReAct 执行循环
 * - 每 Step 前自动保存 checkpoint
 * - 支持从 checkpoint 恢复中断的执行
 * - 自动触发上下文压缩（token 超阈值）
 * - 委托 WorkerAgent 进行实际 LLM 调用（兼容模式）
 */

import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredTool } from '@langchain/core/tools';
import type { IEventBus } from '../../event-bus/types.js';
import type {
  ICheckpointManager,
  Thought,
  ToolCallRecord,
  RuntimeContext,
} from './checkpoint.js';
import type { IMemoryManager } from '../memory/types.js';

// ─────────────────────────────────────────────
// 核心类型
// ─────────────────────────────────────────────

/**
 * Agent 最小接口（Step 3 正式引入，此处先用最小接口）
 *
 * ExecutionEngine 只需要知道 Agent 的 ID 和执行方法。
 * run 方法的签名故意宽松，兼容 WorkerAgent 和未来的角色 Agent。
 */
export interface AgentLike {
  readonly agentId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run?(input: any): Promise<any>;
}

/**
 * 执行上下文 —— 传递给 ExecutionEngine 的完整配置
 */
export interface ExecutionContext {
  /** Agent 唯一标识 */
  agentId: string;
  /** 任务 ID */
  taskId: string;
  /** Agent 实例（最小接口） */
  agent: AgentLike;
  /** LLM 模型 */
  model: BaseChatModel;
  /** 可用工具列表 */
  tools: StructuredTool[];
  /** System Prompt */
  systemPrompt: string;
  /** 运行时上下文（消息历史 + token 信息） */
  context: RuntimeContext;
  /** 执行能力限制 */
  capability: {
    /** 最大迭代次数，默认 15 */
    maxIterations: number;
    /** 超时时间（毫秒），默认 60000 */
    timeoutMs: number;
  };
}

/**
 * 观察 —— Think 阶段的输入
 */
interface Observation {
  /** 运行时上下文 */
  context: RuntimeContext;
  /** 最近事件 */
  events: Array<{ topic: string; payload: unknown }>;
  /** 上一个工具的执行结果 */
  lastToolResult?: string;
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  /** 任务 ID */
  taskId: string;
  /** 执行状态 */
  status: 'success' | 'failed' | 'timeout' | 'replan_needed';
  /** 成功时的最终输出 */
  result?: string;
  /** 失败/超时时的错误信息 */
  error?: string;
  /** 工具调用记录 */
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string }>;
  /** 推理记录 */
  reasoningTrail: Thought[];
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 简单的工具执行包装器
 *
 * 提供 execute() 方法，根据 toolCall 查找工具并执行。
 */
class ToolExecutor {
  constructor(private tools: StructuredTool[]) {}

  /**
   * 执行工具调用
   *
   * @param call - 工具名称和参数
   * @returns 工具执行结果字符串
   */
  async execute(call: { name: string; args: Record<string, unknown> }): Promise<string> {
    const tool = this.tools.find((t) => t.name === call.name);
    if (!tool) {
      return `Error: Tool "${call.name}" not found. Available tools: ${this.tools.map((t) => t.name).join(', ')}`;
    }

    try {
      const result = await tool.invoke(call.args);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error) {
      return `Error executing ${call.name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

/**
 * 解析 LLM 返回的 JSON 响应为 Thought
 *
 * 尝试从 LLM 响应中提取 JSON 并解析。
 * 容错：如果是纯文本或 JSON 解析失败，默认返回 done。
 */
function parseThought(response: string | AIMessage): Thought {
  let text: string;

  if (typeof response === 'string') {
    text = response;
  } else {
    text =
      typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);
  }

  // 尝试从文本中提取 JSON 块
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return normalizeThought(parsed);
    } catch {
      // JSON 解析失败，fall through
    }
  }

  // 纯文本响应：视为 done，内容作为总结
  return {
    reasoning: text.slice(0, 200),
    decision: 'done',
    summary: text,
  };
}

/**
 * 规范化 Thought 对象，补充默认字段
 */
function normalizeThought(parsed: Record<string, unknown>): Thought {
  const decision = validateDecision(parsed.decision);

  return {
    reasoning: String(parsed.reasoning ?? ''),
    decision,
    toolCall: parsed.toolCall as Thought['toolCall'],
    event: parsed.event as Thought['event'],
    targetAgent: parsed.targetAgent as string | undefined,
    payload: parsed.payload,
    summary: parsed.summary as string | undefined,
  };
}

/** 校验 decision 字段 */
function validateDecision(
  value: unknown,
): Thought['decision'] {
  const valid = ['use_tool', 'publish_event', 'request_agent', 'done', 'replan'];
  if (typeof value === 'string' && valid.includes(value)) {
    return value as Thought['decision'];
  }
  return 'done';
}

/**
 * 估算 token 数（字符数 / 4）
 */
function estimateTokens(messages: BaseMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    const content = msg.content;
    if (typeof content === 'string') {
      totalChars += content.length;
    } else if (Array.isArray(content)) {
      for (const block of content as Array<string | Record<string, unknown>>) {
        if (typeof block === 'string') {
          totalChars += block.length;
        } else if (typeof block === 'object' && block !== null && 'text' in block) {
          totalChars += String(block.text).length;
        }
      }
    }
  }
  return Math.ceil(totalChars / 4);
}

// ─────────────────────────────────────────────
// Noop 实现（默认兜底）
// ─────────────────────────────────────────────

class NoopCheckpointManager implements ICheckpointManager {
  async save(): Promise<void> {}
  async load(): Promise<null> { return null; }
  async list(): Promise<[]> { return []; }
  async purge(): Promise<void> {}
  async cleanup(): Promise<void> {}
  async listTasks(): Promise<[]> { return []; }
}

class NoopMemoryManager implements IMemoryManager {
  shortTerm = { add: () => {}, recent: () => [], all: () => [], clear: () => {} } as any;
  longTerm = { store: async () => {}, search: async () => [], deleteBySession: async () => {}, count: async () => 0 } as any;
  working = { write: () => {}, read: () => null, snapshot: () => ({}), clear: () => {} } as any;
}

// ─────────────────────────────────────────────
// ExecutionEngine
// ─────────────────────────────────────────────

/**
 * Agent 执行引擎
 *
 * 驱动 ReAct 循环，管理执行生命周期。
 * 与 Checkpoint、Memory、EventBus 协作提供完整 Agent Runtime。
 *
 * @example
 * ```ts
 * const engine = new ExecutionEngine(checkpointManager, memoryManager, eventBus);
 * const result = await engine.run({
 *   agentId: 'agent-1',
 *   taskId: 'task-1',
 *   agent: myAgent,
 *   model: chatModel,
 *   tools: [tool1, tool2],
 *   systemPrompt: 'You are a helpful assistant...',
 *   context: { messages: [new HumanMessage('Do X')], tokenCount: 50 },
 *   capability: { maxIterations: 15, timeoutMs: 60000 },
 * });
 * ```
 */
export class ExecutionEngine {

  constructor(
    private checkpoint: ICheckpointManager = new NoopCheckpointManager(),
    private memory: IMemoryManager = new NoopMemoryManager(),
    private eventBus: IEventBus | null = null,
    private contextManager?: ContextManagerLike,
  ) {}

  // ─── 默认值 ─────────────────────────────

  /** 默认最大迭代次数 */
  private static readonly DEFAULT_MAX_ITERATIONS = 15;
  /** 默认超时时间（毫秒），6 分钟 */
  private static readonly DEFAULT_TIMEOUT_MS = 360_000;
  /** 上下文窗口大小（token 数），用于触发压缩 */
  private static readonly CONTEXT_WINDOW_TOKENS = 128_000;

  // ─── 执行入口 ─────────────────────────────

  /**
   * 启动执行循环
   *
   * 委托给 runLoop()，从头开始执行。
   */
  async run(ctx: ExecutionContext): Promise<ExecutionResult> {
    return this.runLoop(
      ctx,
      {
        step: 0,
        context: ctx.context,
        toolHistory: [],
        reasoningTrail: [],
      },
      Date.now(),
    );
  }

  // ─── 恢复执行 ─────────────────────────────

  /**
   * 从 checkpoint 恢复执行
   *
   * 加载之前的 checkpoint，从断点继续执行 ReAct 循环。
   */
  async resume(
    taskId: string,
    model: BaseChatModel,
    tools: StructuredTool[],
    systemPrompt: string,
    capability?: { maxIterations?: number; timeoutMs?: number },
  ): Promise<ExecutionResult> {
    const snapshot = await this.checkpoint.load(taskId);
    if (!snapshot) {
      return {
        taskId,
        status: 'failed',
        error: `No checkpoint found for task "${taskId}"`,
        reasoningTrail: [],
      };
    }

    // 从 snapshot 重建 ExecutionContext
    const ctx: ExecutionContext = {
      agentId: snapshot.agentId,
      taskId: snapshot.taskId,
      agent: {},
      model,
      tools,
      systemPrompt,
      context: snapshot.context,
      capability: {
        maxIterations: capability?.maxIterations ?? ExecutionEngine.DEFAULT_MAX_ITERATIONS,
        timeoutMs: capability?.timeoutMs ?? ExecutionEngine.DEFAULT_TIMEOUT_MS,
      },
    };

    return this.runLoop(
      ctx,
      {
        step: snapshot.step,
        context: snapshot.context,
        toolHistory: [...snapshot.toolHistory],
        reasoningTrail: [...snapshot.reasoningTrail],
      },
      Date.now(),
    );
  }

  // ─── Checkpoint 管理 ───────────────────────

  /**
   * 删除指定任务的 checkpoint
   */
  async purgeCheckpoint(taskId: string): Promise<void> {
    await this.checkpoint.purge(taskId);
  }

  /**
   * 列出所有有 checkpoint 的任务 ID
   */
  async listCheckpointTasks(): Promise<string[]> {
    return this.checkpoint.listTasks();
  }

  // ─── 核心循环 ─────────────────────────────

  /**
   * 驱动 ReAct 循环的核心方法
   *
   * run() 和 resume() 共享此方法。区别仅在于初始状态：
   * - run()：step=0，空 toolHistory 和 reasoningTrail
   * - resume()：从 CheckpointSnapshot 恢复的 step、toolHistory、reasoningTrail
   *
   * 每轮循环：Save Checkpoint → Observe → Think (LLM) → Act → Compress
   */
  private async runLoop(
    ctx: ExecutionContext,
    state: {
      step: number;
      context: RuntimeContext;
      toolHistory: ToolCallRecord[];
      reasoningTrail: Thought[];
    },
    startTime: number,
  ): Promise<ExecutionResult> {
    let { step, context, toolHistory, reasoningTrail } = state;

    const toolExec = new ToolExecutor(ctx.tools);
    const maxIterations = ctx.capability.maxIterations ?? ExecutionEngine.DEFAULT_MAX_ITERATIONS;
    const timeoutMs = ctx.capability.timeoutMs ?? ExecutionEngine.DEFAULT_TIMEOUT_MS;

    while (step < maxIterations) {
      // ── 超时检查 ──
      if (Date.now() - startTime > timeoutMs) {
        await this.checkpoint.save(ctx.taskId, {
          taskId: ctx.taskId,
          agentId: ctx.agentId,
          step,
          context,
          toolHistory,
          reasoningTrail,
        });

        return {
          taskId: ctx.taskId,
          status: 'timeout',
          error: `Task timed out after ${timeoutMs}ms`,
          reasoningTrail,
        };
      }

      // ── Save checkpoint before each step ──
      await this.checkpoint.save(ctx.taskId, {
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        step,
        context,
        toolHistory,
        reasoningTrail,
      });

      // ── Observe ──
      const events = this.collectEvents();
      const observation: Observation = {
        context,
        events,
        lastToolResult: toolHistory.at(-1)?.result,
      };

      // ── Think (LLM call) ──
      let thought: Thought;
      try {
        thought = await this.think(ctx.model, ctx.systemPrompt, observation);
      } catch (error) {
        // Save checkpoint before returning failed — preserves progress
        // for potential retry (transient errors like network/rate-limit).
        await this.checkpoint.save(ctx.taskId, {
          taskId: ctx.taskId,
          agentId: ctx.agentId,
          step,
          context,
          toolHistory,
          reasoningTrail,
        });

        return {
          taskId: ctx.taskId,
          status: 'failed',
          error: `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
          reasoningTrail,
        };
      }
      reasoningTrail.push(thought);

      // ── Act ──
      try {
        switch (thought.decision) {
          case 'use_tool': {
            if (!thought.toolCall) {
              throw new Error('use_tool decision missing toolCall');
            }
            const result = await toolExec.execute(thought.toolCall);
            toolHistory.push({ call: thought.toolCall, result });

            context = await this.appendToContext(context, {
              role: 'tool',
              content: `Tool: ${thought.toolCall.name}\nArgs: ${JSON.stringify(thought.toolCall.args)}\nResult: ${result}`,
            });

            this.memory.shortTerm.add({
              role: 'tool',
              content: `${thought.toolCall.name}: ${result.slice(0, 500)}`,
            });
            break;
          }

          case 'publish_event': {
            if (thought.event && this.eventBus) {
              await this.eventBus.publish(
                thought.event.topic as any,
                thought.event.payload,
                { senderId: ctx.agentId, taskId: ctx.taskId },
              );
            }
            break;
          }

          case 'request_agent': {
            if (thought.targetAgent && this.eventBus) {
              const reply = await this.eventBus.request(
                `agent.command.${thought.targetAgent}` as any,
                thought.payload ?? {},
              );
              context = await this.appendToContext(context, {
                role: 'assistant',
                content: `[Reply from ${thought.targetAgent}]: ${JSON.stringify(reply.payload)}`,
              });
            }
            break;
          }

          case 'done':
            return {
              taskId: ctx.taskId,
              status: 'success',
              result: thought.summary,
              toolCalls: toolHistory.map((tc) => ({
                tool: tc.call.name,
                args: tc.call.args,
                result: tc.result,
              })),
              reasoningTrail,
            };

          case 'replan':
            return {
              taskId: ctx.taskId,
              status: 'replan_needed',
              result: thought.summary,
              reasoningTrail,
            };
        }
      } catch (error) {
        // Act 阶段出错不直接返回 failed，而是让模型在下一轮处理
        context = await this.appendToContext(context, {
          role: 'system',
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      // ── Context compress check ──
      if (context.tokenCount > 0) {
        const currentTokens = estimateTokens(context.messages);
        context.tokenCount = currentTokens;

        if (currentTokens > ExecutionEngine.CONTEXT_WINDOW_TOKENS * 0.8) {
          context = await this.compressContext(context, ExecutionEngine.CONTEXT_WINDOW_TOKENS);
        }
      }

      step++;
    }

    return {
      taskId: ctx.taskId,
      status: 'timeout',
      error: `Max iterations (${maxIterations}) reached`,
      reasoningTrail,
    };
  }

  // ─── Think 方法 ───────────────────────────

  /**
   * 调用 LLM 进行推理决策
   *
   * 构建结构化 prompt，要求 LLM 返回 JSON 格式的决策。
   * 包含当前上下文、最近事件和上一个工具结果。
   */
  private async think(
    model: BaseChatModel,
    systemPrompt: string,
    obs: Observation,
  ): Promise<Thought> {
    const contextSummary = obs.context.summary
      ? `Summary of earlier context:\n${obs.context.summary}\n\nRecent messages:\n`
      : '';

    const recentMessages = obs.context.messages
      .slice(-10)
      .map((m) => {
        const role = m.getType?.() ?? 'unknown';
        const content =
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[${role}] ${content.slice(0, 300)}`;
      })
      .join('\n');

    const eventsText =
      obs.events.length > 0
        ? obs.events.map((e) => `[${e.topic}] ${JSON.stringify(e.payload)}`).join('\n')
        : 'None';

    const prompt = `${systemPrompt}

## Current State
${contextSummary}${recentMessages}

## Recent Events
${eventsText}

## Last Tool Result
${obs.lastToolResult ?? 'None'}

## Instructions
Based on the above, decide your next action. You MUST respond with ONLY a JSON object (no markdown code fences, no other text):

{
  "reasoning": "Your step-by-step reasoning about what to do next",
  "decision": "use_tool | publish_event | request_agent | done | replan",
  "toolCall": { "name": "tool_name", "args": {} },
  "event": { "topic": "agent.event.xxx", "payload": {} },
  "targetAgent": "agent_role",
  "payload": {},
  "summary": "Final summary if done or replan"
}

Rules:
- If you need to use a tool, set decision to "use_tool" and provide toolCall
- If you want to notify other agents, set decision to "publish_event"
- If you need help from another agent, set decision to "request_agent"
- If the task is complete, set decision to "done" and provide a summary
- If the plan needs revision, set decision to "replan" and explain why in summary
- Only include fields relevant to your decision`;

    const response = await model.invoke([new HumanMessage(prompt)]);
    return parseThought(response);
  }

  // ─── 上下文辅助方法 ──────────────────────

  /**
   * 追加内容到 RuntimeContext
   *
   * 向消息列表追加一条 HumanMessage，更新 token 估算。
   */
  private async appendToContext(
    ctx: RuntimeContext,
    entry: { role: string; content: string },
  ): Promise<RuntimeContext> {
    const newMessage = new HumanMessage(
      `[${entry.role}] ${entry.content}`,
    );

    const messages = [...ctx.messages, newMessage];
    const tokenCount = estimateTokens(messages);

    return {
      messages,
      tokenCount,
      summary: ctx.summary,
    };
  }

  /**
   * 压缩 RuntimeContext
   *
   * 当 token 使用超过阈值时，对历史消息生成摘要。
   * 保留最近 20 条消息完整内容，更早的消息生成摘要。
   */
  private async compressContext(
    ctx: RuntimeContext,
    maxTokens: number,
  ): Promise<RuntimeContext> {
    const keepRecent = 20;

    if (ctx.messages.length <= keepRecent) {
      return ctx;
    }

    // 生成摘要
    const toCompress = ctx.messages.slice(0, ctx.messages.length - keepRecent);
    const toKeep = ctx.messages.slice(-keepRecent);

    const excerpts = toCompress.slice(0, 5).map((msg, i) => {
      const content =
        typeof msg.content === 'string'
          ? msg.content.slice(0, 200)
          : JSON.stringify(msg.content).slice(0, 200);
      return `[${i + 1}] ${content}`;
    });

    const newSummary = ctx.summary
      ? `${ctx.summary}\n[Additional context: ${toCompress.length} earlier messages]\n${excerpts.join('\n')}`
      : `[Summary of ${toCompress.length} earlier messages]\n${excerpts.join('\n')}`;

    const tokenCount = estimateTokens(toKeep);

    return {
      messages: toKeep,
      tokenCount,
      summary: newSummary,
    };
  }

  // ─── 事件收集 ─────────────────────────────

  /**
   * 从 EventBus 收集最近事件（hook 预留）
   *
   * 当前实现返回空数组。
   * 后续可通过 EventBus 的 drain 方法获取 Agent 订阅的 topics 事件。
   */
  private collectEvents(): Array<{ topic: string; payload: unknown }> {
    // 预留：从 EventBus 收集 Agent 订阅的 topics 事件
    // 当前返回空数组
    return [];
  }
}

// ─────────────────────────────────────────────
// ContextManagerLike 最小接口
// ─────────────────────────────────────────────

/**
 * ContextManager 的最小接口
 *
 * 避免 ExecutionEngine 对 ContextManager 完整实现的循环依赖。
 */
interface ContextManagerLike {
  build?(messages: BaseMessage[], window?: Record<string, unknown>): RuntimeContext;
  append?(ctx: RuntimeContext, content: string): Promise<RuntimeContext>;
  compress?(ctx: RuntimeContext, maxTokens: number): Promise<RuntimeContext>;
}
