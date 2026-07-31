/**
 * Agent 状态查询 HTTP 路由
 *
 * 提供多 Agent 运行时状态查询接口：
 *
 * | 方法 | 路径                 | 说明                       |
 * |------|----------------------|----------------------------|
 * | GET  | /api/agents          | 获取所有 Agent 的实时状态  |
 * | GET  | /api/agents/roles    | 获取已注册的角色列表       |
 *
 * 通过 Fastify decorate("agentRegistry") 和 decorate("stateManager") 获取实例。
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { AgentRegistry, InMemoryStateManager } from "@code-agent/core";

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 从 Fastify 实例获取 AgentRegistry */
function getAgentRegistry(app: FastifyInstance): AgentRegistry {
  return (app as any).agentRegistry;
}

/** 从 Fastify 实例获取 StateManager */
function getStateManager(app: FastifyInstance): InMemoryStateManager {
  return (app as any).stateManager;
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------

/**
 * Agent 状态查询路由插件
 *
 * @param app - Fastify 实例（作用域，prefix 已在注册时指定为 /api）
 */
const agentRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  /**
   * GET /api/agents —— 获取所有 Agent 状态
   *
   * Response 200:
   * {
   *   agents: Array<{ role: string; id: string; status: string; currentTask?: string }>,
   *   roles: Array<{ id: string; name: string; description: string }>,
   *   timestamp: string
   * }
   */
  app.get("/agents", async (_request, reply) => {
    const registry = getAgentRegistry(app);
    const stateManager = getStateManager(app);

    const agents = registry.getAllAgents().map((agent) => {
      const state = stateManager.agents.get(agent.id);
      return {
        id: agent.id,
        role: agent.role.id,
        name: agent.role.name,
        status: state?.status ?? "offline",
        currentTask: state?.currentTask,
        toolCallCount: state?.toolCallCount ?? 0,
        lastHeartbeat: state?.lastHeartbeat?.toISOString() ?? null,
      };
    });

    const roles = registry.listRoles().map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
    }));

    reply.status(200).send({
      agents,
      roles,
      total: agents.length,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/agents/roles —— 获取已注册角色列表
   *
   * Response 200: 角色数组
   */
  app.get("/agents/roles", async (_request, reply) => {
    const registry = getAgentRegistry(app);

    const roles = registry.listRoles().map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      commandSubscriptions: role.commandSubscriptions,
      eventSubscriptions: role.eventSubscriptions,
      canDelegate: role.canDelegate,
      delegatableRoles: role.delegatableRoles,
    }));

    reply.status(200).send(roles);
  });
};

export default agentRoutes;
