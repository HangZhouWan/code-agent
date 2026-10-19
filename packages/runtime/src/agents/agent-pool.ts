/**
 * AgentPool —— 按角色裁剪工具、限制并发，并复用无状态执行引擎
 */

import type {
  AgentInvoker,
  RunScope,
  ToolDefinition,
} from "@code-agent/core";
import type { AgentRoleId, TaskId, TaskResult } from "@code-agent/protocol";
import { Semaphore } from "./semaphore.js";
import type { RoleRegistry } from "./role-registry.js";

export interface AgentPoolOptions {
  engine: AgentInvoker;
  roles: RoleRegistry;
  tools: ToolDefinition[];
  workspacePath: string;
  globalConcurrency?: number;
}

export interface PoolTaskInput {
  taskId: TaskId;
  description: string;
  context?: string;
  memory?: string;
  messages?: import("@code-agent/protocol").SerializedMessage[];
  maxIterations?: number;
}

export class AgentPool {
  private readonly toolsByName = new Map<string, ToolDefinition>();
  private readonly roleSemaphores = new Map<string, Semaphore>();
  private readonly global: Semaphore;

  constructor(private readonly options: AgentPoolOptions) {
    for (const tool of options.tools) {
      this.toolsByName.set(tool.name, tool);
    }
    this.global = new Semaphore(options.globalConcurrency ?? 4);
  }

  registerTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.toolsByName.set(tool.name, tool);
    }
  }

  toolsForRole(roleId: AgentRoleId): ToolDefinition[] {
    const role = this.options.roles.require(roleId);
    return role.defaultTools
      .map((name) => this.toolsByName.get(name))
      .filter((tool): tool is ToolDefinition => tool !== undefined);
  }

  async invoke(
    roleId: AgentRoleId,
    task: PoolTaskInput,
    scope: RunScope,
  ): Promise<TaskResult> {
    const role = this.options.roles.require(roleId);
    let roleSemaphore = this.roleSemaphores.get(role.id);
    if (!roleSemaphore) {
      roleSemaphore = new Semaphore(role.maxConcurrency);
      this.roleSemaphores.set(role.id, roleSemaphore);
    }

    const releaseGlobal = await this.global.acquire();
    const releaseRole = await roleSemaphore.acquire();
    try {
      return await this.options.engine.invoke(
        {
          taskId: task.taskId,
          role: role.id,
          description: task.description,
          systemPrompt: role.systemPrompt,
          tools: this.toolsForRole(role.id),
          workspacePath: this.options.workspacePath,
          ...(task.context ? { context: task.context } : {}),
          ...(task.memory ? { memory: task.memory } : {}),
          ...(task.messages ? { messages: task.messages } : {}),
          ...(task.maxIterations ? { maxIterations: task.maxIterations } : {}),
        },
        scope,
      );
    } finally {
      releaseRole();
      releaseGlobal();
    }
  }
}
