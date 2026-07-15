/**
 * AgentRegistry —— Agent 注册管理中心
 *
 * 统一管理所有 Agent 实例的生命周期：
 * - 注册自定义角色
 * - 创建/查询/移除 Agent 实例
 * - 按角色查找空闲 Agent
 * - 优雅关闭所有 Agent
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ToolRegistry } from '../tools/registry.js';
import { ExecutionEngine } from '../harness/execution/engine.js';
import { ContextManager } from '../harness/context/manager.js';
import { HooksEngine } from '../harness/hooks/engine.js';
import type { PermissionRegistry } from '../harness/sandbox/registry.js';
import type { IEventBus } from '../event-bus/types.js';
import type { IStateManager } from '../state/types.js';
import type { AgentRole } from './role.js';
import { BUILTIN_ROLES } from './role.js';
import { Agent } from './agent.js';
import type { AgentConfig, AgentOutput } from './types.js';

/**
 * Agent 注册管理中心
 *
 * 线程不安全 —— 应在应用启动时创建并配置。
 *
 * @example
 * ```ts
 * const registry = new AgentRegistry(eventBus, stateManager);
 * registry.registerRole(customRole);
 * const agent = await registry.createAgent('code', model, toolRegistry);
 * const idleAgent = registry.getAgent('code'); // 优先返回空闲的
 * await registry.shutdown();
 * ```
 */
export class AgentRegistry {
  /** agentId → Agent 实例 */
  private agents = new Map<string, Agent>();

  /** roleId → AgentRole 定义 */
  private roles = new Map<string, AgentRole>();

  /** 共享的执行引擎 */
  private engine: ExecutionEngine;

  /** 共享的上下文管理器 */
  private contextManager: ContextManager;

  constructor(
    private eventBus: IEventBus,
    private stateManager: IStateManager,
  ) {
    // 注册内置角色
    for (const role of BUILTIN_ROLES) {
      this.roles.set(role.id, role);
    }

    // 共享组件
    this.engine = new ExecutionEngine();
    this.contextManager = new ContextManager();
  }

  // ─── 角色管理 ─────────────────────────────

  /**
   * 注册自定义角色
   *
   * 同名角色会被覆盖，最后注册的生效。
   * 不会影响已创建的 Agent 实例。
   *
   * @param role - 角色定义
   */
  registerRole(role: AgentRole): void {
    this.roles.set(role.id, role);
  }

  /**
   * 获取角色定义
   *
   * @param roleId - 角色 ID
   * @returns 角色定义，不存在返回 undefined
   */
  getRole(roleId: string): AgentRole | undefined {
    return this.roles.get(roleId);
  }

  /**
   * 列出所有可用角色
   *
   * @returns 角色定义数组
   */
  listRoles(): AgentRole[] {
    return [...this.roles.values()];
  }

  // ─── Agent 生命周期 ───────────────────────

  /**
   * 创建并启动 Agent 实例
   *
   * 根据角色 ID 创建 Agent，自动注入共享依赖。
   * 创建后立即调用 agent.start() 完成注册和订阅。
   *
   * @param roleId - 角色 ID（必须已注册）
   * @param model - LLM 模型
   * @param toolRegistry - 工具注册表
   * @param overrides - 可选覆盖配置（hooks、permissionRegistry、workspacePath 等）
   * @returns 已启动的 Agent 实例
   * @throws 如果角色 ID 未注册
   */
  async createAgent(
    roleId: string,
    model: BaseChatModel,
    toolRegistry: ToolRegistry,
    overrides?: {
      hooks?: HooksEngine;
      permissionRegistry?: PermissionRegistry;
      workspacePath?: string;
    },
  ): Promise<Agent> {
    const role = this.roles.get(roleId);
    if (!role) {
      throw new Error(
        `Unknown role "${roleId}". Available roles: ${[...this.roles.keys()].join(', ')}`,
      );
    }

    const config: AgentConfig = {
      role,
      model,
      engine: this.engine,
      eventBus: this.eventBus,
      stateManager: this.stateManager,
      toolRegistry,
      contextManager: this.contextManager,
      hooks: overrides?.hooks,
      permissionRegistry: overrides?.permissionRegistry,
      workspacePath: overrides?.workspacePath,
      capability: {
        tools: role.defaultTools,
        paths: [overrides?.workspacePath ?? process.cwd()],
      },
    };

    const agent = new Agent(config);
    await agent.start();
    this.agents.set(agent.id, agent);

    return agent;
  }

  // ─── Agent 查询 ───────────────────────────

  /**
   * 获取指定角色的 Agent（优先返回空闲的）
   *
   * 先查找 idle 的 Agent，没有则返回第一个匹配角色的 Agent（可能 busy）。
   * 如果没有匹配角色的 Agent，返回 undefined。
   *
   * @param roleId - 角色 ID
   * @returns Agent 实例或 undefined
   */
  getAgent(roleId: string): Agent | undefined {
    const candidates = this.getAgents(roleId);
    if (candidates.length === 0) return undefined;

    // 优先返回空闲的
    const idle = candidates.find(
      (a) => this.stateManager.agents.get(a.id)?.status === 'idle',
    );
    return idle ?? candidates[0];
  }

  /**
   * 获取指定角色的所有 Agent（包括 busy 和 idle）
   *
   * @param roleId - 角色 ID
   * @returns Agent 实例数组
   */
  getAgents(roleId: string): Agent[] {
    const result: Agent[] = [];
    for (const agent of this.agents.values()) {
      if (agent.role.id === roleId) {
        result.push(agent);
      }
    }
    return result;
  }

  /**
   * 根据 agentId 获取 Agent 实例
   *
   * @param agentId - Agent 唯一标识
   * @returns Agent 实例或 undefined
   */
  getAgentById(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 获取所有 Agent 实例
   *
   * @returns Agent 实例数组
   */
  getAllAgents(): Agent[] {
    return [...this.agents.values()];
  }

  /**
   * 获取当前活跃的 Agent 数量
   */
  get agentCount(): number {
    return this.agents.size;
  }

  // ─── Agent 移除 ───────────────────────────

  /**
   * 停止并移除 Agent
   *
   * 先调用 agent.stop() 取消订阅和心跳，
   * 然后从内部 Map 中移除。
   *
   * @param agentId - Agent 唯一标识
   */
  async removeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.stop();
      this.agents.delete(agentId);
    }
  }

  /**
   * 停止所有 Agent 并清空注册表
   *
   * 优雅关闭：并行停止所有 Agent，然后清空内部状态。
   * 不会清空角色注册（保留角色定义）。
   */
  async shutdown(): Promise<void> {
    const stopPromises = [...this.agents.values()].map((agent) => agent.stop());
    await Promise.all(stopPromises);
    this.agents.clear();
  }

  /**
   * 完全重置（包括角色）
   *
   * 停止所有 Agent，清空 Agent 和角色注册表。
   * 主要用于测试。
   */
  async reset(): Promise<void> {
    await this.shutdown();
    this.roles.clear();
    // 重新注册内置角色
    for (const role of BUILTIN_ROLES) {
      this.roles.set(role.id, role);
    }
  }
}
