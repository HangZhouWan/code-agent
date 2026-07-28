/**
 * Agent 基类 —— 角色分工型多 Agent 的核心抽象
 *
 * 每个 Agent 实例：
 * - 绑定一个角色（AgentRole），决定其身份和能力边界
 * - 通过 EventBus 订阅 Command（领取任务）和 Event（观察环境）
 * - 委托 ExecutionEngine 驱动 ReAct 推理循环
 * - 向 StateManager 上报自身状态（idle/busy/error）
 *
 * 四层结构：Role → Reasoning → Runtime → Capability
 */

import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredTool } from '@langchain/core/tools';
import { ToolRegistry, type AgentCapability } from '../tools/registry.js';
import { HooksEngine } from '../harness/hooks/engine.js';
import type { PermissionRegistry } from '../harness/sandbox/registry.js';
import type { ContextManager } from '../harness/context/manager.js';
import type { RuntimeContext } from '../harness/context/types.js';
import { ExecutionEngine, type ExecutionResult } from '../harness/execution/engine.js';
import type { IEventBus, BusMessage, Unsubscribe } from '../event-bus/types.js';
import type { IStateManager } from '../state/types.js';
import type { AgentRole } from './role.js';
import { DefaultReasoningLoop, type IReasoningLoop } from './reasoning.js';
import type { AgentConfig, AgentInput, AgentOutput, AgentStatus } from './types.js';

// ─────────────────────────────────────────────
// Agent 基类
// ─────────────────────────────────────────────

/**
 * Agent 基类
 *
 * 封装了角色绑定、Bus 订阅、状态上报和执行委托。
 * 子类可覆盖 handleEvent() 实现自定义事件响应逻辑。
 *
 * @example
 * ```ts
 * const agent = new Agent({
 *   role: BUILTIN_ROLES[0], // Code Agent
 *   model: chatModel,
 *   engine: executionEngine,
 *   eventBus,
 *   stateManager,
 *   toolRegistry,
 *   contextManager,
 * });
 * await agent.start();
 * const result = await agent.executeTask({
 *   taskId: 'task-1',
 *   description: 'Read package.json and report the version',
 * });
 * await agent.stop();
 * ```
 */
export class Agent {
  /** Agent 唯一标识（UUID v4） */
  readonly id: string;

  /** AgentLike 兼容：暴露 id 为 agentId */
  get agentId(): string {
    return this.id;
  }

  /** Agent 角色定义 */
  readonly role: AgentRole;

  /** 推理循环（Observe → Think → Act → Reflect） */
  readonly reasoning: IReasoningLoop;

  /** Agent 能力声明 */
  readonly capability: AgentCapability;

  // 注入依赖
  private engine: ExecutionEngine;
  private eventBus: IEventBus;
  private stateManager: IStateManager;
  private model: BaseChatModel;
  private toolRegistry: ToolRegistry;
  private contextManager: ContextManager;
  private hooks: HooksEngine;
  private permissionRegistry?: PermissionRegistry;
  private workspacePath: string;

  /** 当前状态 */
  private status: AgentStatus = 'idle';

  /** 当前正在执行的任务 ID（busy 时有效） */
  private currentTaskId?: string;

  /** 活跃的订阅取消函数 */
  private unsubscribers: Unsubscribe[] = [];

  /** 心跳定时器 */
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(config: AgentConfig) {
    this.id = crypto.randomUUID();
    this.role = config.role;
    this.model = config.model;
    this.engine = config.engine;
    this.eventBus = config.eventBus;
    this.stateManager = config.stateManager;
    this.toolRegistry = config.toolRegistry;
    this.contextManager = config.contextManager;
    this.hooks = config.hooks ?? new HooksEngine();
    this.permissionRegistry = config.permissionRegistry;
    this.workspacePath = config.workspacePath ?? process.cwd();

    // 组装四层结构
    this.reasoning = new DefaultReasoningLoop(this.engine);

    // 合并角色默认工具和配置中的能力声明
    this.capability = config.capability ?? {
      tools: this.role.defaultTools,
      paths: [this.workspacePath],
    };
  }

  // ─── 生命周期 ─────────────────────────────

  /**
   * 启动 Agent
   *
   * 1. 向 StateManager 注册自身
   * 2. 订阅角色声明的 Command 主题（领取任务）
   * 3. 订阅角色声明的 Event 主题（观察环境）
   * 4. 启动心跳定时器
   */
  async start(): Promise<void> {
    // 1. 注册到 StateManager
    this.stateManager.agents.register(this.id, this.role.id);

    // 2. 订阅 Command 主题
    for (const topic of this.role.commandSubscriptions) {
      const unsub = this.eventBus.subscribe(topic, async (msg: BusMessage) => {
        if (this.status === 'busy') {
          // 忙时不领取新任务，消息留在 Bus 里由其他空闲 Agent 领取
          return;
        }
        await this.handleCommand(msg);
      });
      this.unsubscribers.push(unsub);
    }

    // 3. 订阅 Event 主题（只观察，不响应）
    for (const topic of this.role.eventSubscriptions) {
      const unsub = this.eventBus.subscribe(topic, async (msg: BusMessage) => {
        await this.handleEvent(msg);
      });
      this.unsubscribers.push(unsub);
    }

    // 4. 启动心跳（每 5 秒上报一次）
    this.heartbeatTimer = setInterval(() => {
      this.stateManager.agents.heartbeat(this.id);
    }, 5000);
  }

  /**
   * 停止 Agent
   *
   * 取消所有订阅、清除心跳定时器、从 StateManager 移除自身。
   * 幂等操作：多次调用不会出错。
   */
  async stop(): Promise<void> {
    // 取消所有 Bus 订阅
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    // 清除心跳
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    // 更新状态为 offline（如果之前已注册）
    try {
      this.stateManager.agents.update(this.id, {
        status: 'offline',
        currentTask: undefined,
      });
    } catch {
      // Agent 可能未注册或已被移除，忽略
    }
  }

  // ─── 消息处理 ─────────────────────────────

  /**
   * 响应 Command（被 EventBus 驱动）
   *
   * 当 Agent 订阅的 Command 主题有消息到达时调用。
   * 执行流程：
   * 1. 标记为 busy，更新 StateManager
   * 2. 发布 task_started 事件
   * 3. 构建 RuntimeContext
   * 4. 获取受限工具集
   * 5. 委托给 ExecutionEngine 执行 ReAct 循环
   * 6. 发布 task_completed / task_failed / replan_needed 事件
   * 7. 恢复为 idle
   *
   * 异常安全：即使执行出错，也会恢复 idle 状态。
   */
  private async handleCommand(msg: BusMessage): Promise<void> {
    const taskId = (msg.metadata?.taskId as string) ?? `${this.role.id}-${Date.now()}`;

    this.status = 'busy';
    this.currentTaskId = taskId;
    this.stateManager.agents.update(this.id, {
      status: 'busy',
      currentTask: taskId,
    });

    // 发布 task_started
    await this.eventBus.publish('agent.event.task_started' as any, {
      agentId: this.id,
      taskId,
      role: this.role.id,
    });

    try {
      // 构建 RuntimeContext
      const payloadText =
        typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload);
      const context = this.contextManager.build([
        new HumanMessage(`Task: ${payloadText}`),
      ]);

      // 获取工具
      const tools = this.getTools();

      // 委托给 ExecutionEngine
      const result = await this.engine.run({
        agentId: this.id,
        taskId,
        agent: this,
        model: this.model,
        tools,
        systemPrompt: this.role.systemPrompt,
        context,
        capability: {
          maxIterations: this.capability.maxTokens ?? 15,
          timeoutMs: this.capability.timeoutMs ?? 360000,
        },
      });

      // 发布结果事件
      await this.publishResult(taskId, result);
    } catch (error) {
      // 执行异常：发布 task_failed
      await this.eventBus.publish('agent.event.task_failed' as any, {
        taskId,
        agentId: this.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // 无论如何恢复 idle
      this.status = 'idle';
      this.currentTaskId = undefined;
      this.stateManager.agents.update(this.id, {
        status: 'idle',
        currentTask: undefined,
      });
    }
  }

  /**
   * 处理 Event（观察，可能触发行为）
   *
   * 默认不做响应。子类可覆盖此方法实现自动响应逻辑。
   * 例如：Test Agent 收到 code_changed → 自动跑测试。
   *
   * @param msg - 事件消息
   */
  protected async handleEvent(_msg: BusMessage): Promise<void> {
    // 默认不做响应，子类可覆盖
  }

  // ─── AgentLike 兼容 ───────────────────────

  /**
   * AgentLike 兼容方法
   *
   * 允许 Agent 实例直接作为 ExecutionContext.agent 使用。
   * 委托给 executeTask()，适配 WorkerAgent 的 run() 签名。
   */
  async run(input: { taskId: string; description: string; [key: string]: unknown }): Promise<AgentOutput> {
    return this.executeTask({
      taskId: input.taskId,
      description: input.description,
      context: input.context as string | undefined,
      maxIterations: input.maxIterations as number | undefined,
      timeoutMs: input.timeoutMs as number | undefined,
    });
  }

  // ─── 直接执行 ─────────────────────────────

  /**
   * 直接执行任务（Dispatcher direct 路径）
   *
   * 不走 EventBus，直接调用 ExecutionEngine。
   * 适用于简单任务或需要同步等待结果的场景。
   *
   * @param input - 任务描述和参数
   * @returns 执行结果
   */
  async executeTask(input: AgentInput): Promise<AgentOutput> {
    const taskId = input.taskId;
    const maxIterations = input.maxIterations ?? this.capability.maxTokens ?? 15;
    const timeoutMs = input.timeoutMs ?? this.capability.timeoutMs ?? 360000;

    this.status = 'busy';
    this.currentTaskId = taskId;
    this.stateManager.agents.update(this.id, {
      status: 'busy',
      currentTask: taskId,
    });

    try {
      // 构建初始上下文
      const contextText = input.context ?? '';
      const description = input.description;
      const messageText = contextText
        ? `Context:\n${contextText}\n\nTask:\n${description}`
        : description;

      const context = this.contextManager.build([new HumanMessage(messageText)]);

      // 获取工具
      const tools = this.getTools(input.onConfirmRequired);

      // 委托给 ExecutionEngine
      const result = await this.engine.run({
        agentId: this.id,
        taskId,
        agent: this,
        model: this.model,
        tools,
        systemPrompt: this.role.systemPrompt,
        context,
        capability: { maxIterations, timeoutMs },
      });

      return this.mapResult(taskId, result);
    } catch (error) {
      return {
        taskId,
        agentId: this.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.status = 'idle';
      this.currentTaskId = undefined;
      this.stateManager.agents.update(this.id, {
        status: 'idle',
        currentTask: undefined,
      });
    }
  }

  // ─── 辅助方法 ─────────────────────────────

  /**
   * 获取此 Agent 的受限工具集
   *
   * 根据角色默认工具和配置中的能力声明，从 ToolRegistry 获取
   * 对应的 LangChain StructuredTool 实例。
   *
   * @param onConfirmRequired - 可选的确认回调（覆盖默认行为）
   * @returns LangChain 工具数组
   */
  private getTools(
    onConfirmRequired?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>,
  ): StructuredTool[] {
    const sessionId = `agent-${this.id}`;

    return this.toolRegistry.getToolsForAgent(
      this.capability,
      {
        workspacePath: this.workspacePath,
        sessionId,
        onConfirmRequired,
      },
      this.permissionRegistry,
    );
  }

  /**
   * 发布任务执行结果事件
   *
   * 根据 ExecutionResult.status 发布对应的 EventBus 事件。
   */
  private async publishResult(taskId: string, result: ExecutionResult): Promise<void> {
    if (result.status === 'success') {
      await this.eventBus.publish('agent.event.task_completed' as any, {
        taskId,
        agentId: this.id,
        result: result.result,
      });
    } else if (result.status === 'replan_needed') {
      await this.eventBus.publish('agent.event.replan_needed' as any, {
        taskId,
        agentId: this.id,
        reason: result.result,
      });
    } else {
      await this.eventBus.publish('agent.event.task_failed' as any, {
        taskId,
        agentId: this.id,
        error: result.error ?? `Task ended with status: ${result.status}`,
      });
    }
  }

  /**
   * 将 ExecutionResult 映射为 AgentOutput
   */
  private mapResult(taskId: string, result: ExecutionResult): AgentOutput {
    return {
      taskId,
      agentId: this.id,
      status: result.status,
      result: result.result,
      error: result.error,
      toolCalls: result.toolCalls?.length ? result.toolCalls : undefined,
    };
  }
}
