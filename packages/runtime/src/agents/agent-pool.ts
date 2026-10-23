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
  /** 单任务超时；计划模式需要覆盖默认的 5 分钟 */
  timeoutMs?: number;
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
      // 把计划模式状态作为背景注入，让模型知道当前能不能改动工作区
      const planDirective = scope.plan
        ? scope.plan.required
          ? scope.plan.isApproved()
            ? `PLAN MODE IS ON. The user approved proposal(s): ${
                scope.plan.selectedProposalIds().join(", ") || "(none)"
              }. Implement only the approved proposals.`
            : "PLAN MODE IS ON. All mutating tools are blocked until the user approves proposals. " +
              "Investigate with read-only tools, then call submit_proposals with 1-4 concrete proposals."
          : "PLAN MODE IS OFF. Do not call submit_proposals; implement the request directly."
        : undefined;
      const context = [task.context, planDirective]
        .filter((part): part is string => Boolean(part))
        .join("\n\n");

      return await this.options.engine.invoke(
        {
          taskId: task.taskId,
          role: role.id,
          description: task.description,
          systemPrompt: role.systemPrompt,
          tools: this.toolsForRole(role.id),
          workspacePath: this.options.workspacePath,
          ...(context ? { context } : {}),
          ...(task.memory ? { memory: task.memory } : {}),
          ...(task.messages ? { messages: task.messages } : {}),
          ...(task.maxIterations ? { maxIterations: task.maxIterations } : {}),
          ...(task.timeoutMs ? { timeoutMs: task.timeoutMs } : {}),
        },
        scope,
      );
    } finally {
      releaseRole();
      releaseGlobal();
    }
  }
}
