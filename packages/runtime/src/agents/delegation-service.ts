/**
 * DelegationService —— 受限的 Agent 间委派
 */

import {
  asRunId,
  asSessionId,
  asTaskId,
  serializeError,
  type AgentRoleId,
  type TaskResult,
} from "@code-agent/protocol";
import type { RunScope, SessionStateManager, ToolContext } from "@code-agent/core";
import type { Clock, IdGenerator } from "../ports/types.js";
import type { AgentPool } from "./agent-pool.js";
import type { RoleRegistry } from "./role-registry.js";

export interface DelegationServiceOptions {
  roles: RoleRegistry;
  pool: AgentPool;
  state: SessionStateManager;
  ids: IdGenerator;
  clock: Clock;
  maxDepth?: number;
  maxDelegations?: number;
}

export interface DelegationInput {
  role: string;
  description: string;
  context?: string;
  files?: string[];
  dependsOn?: string[];
}

export class DelegationService {
  private readonly maxDepth: number;
  private readonly maxDelegations: number;
  private delegations = 0;

  constructor(private readonly options: DelegationServiceOptions) {
    this.maxDepth = options.maxDepth ?? 2;
    this.maxDelegations = options.maxDelegations ?? 5;
  }

  reset(): void {
    this.delegations = 0;
  }

  async delegate(
    input: DelegationInput,
    ctx?: ToolContext,
  ): Promise<TaskResult> {
    if (!ctx?.runId || !ctx.sessionId) {
      throw new Error("delegate_task requires an active run scope");
    }

    const parentRole = (ctx.roleId ?? "code") as AgentRoleId;
    const childRole = input.role as AgentRoleId;

    if (!this.options.roles.has(childRole)) {
      throw new Error(`Unknown role: ${input.role}`);
    }
    if (!this.options.roles.canDelegate(parentRole, childRole)) {
      throw new Error(
        `Role "${parentRole}" cannot delegate to "${childRole}"`,
      );
    }

    const depth = (ctx.delegation?.depth ?? 0) + 1;
    const maxDepth = ctx.delegation?.maxDepth ?? this.maxDepth;
    if (depth > maxDepth) {
      throw new Error(`Delegation depth exceeded (max ${maxDepth})`);
    }
    if (++this.delegations > this.maxDelegations) {
      throw new Error(
        `Delegation budget exceeded (max ${this.maxDelegations} per run)`,
      );
    }

    const runId = asRunId(ctx.runId);
    const sessionId = asSessionId(ctx.sessionId);
    const parentTaskId = ctx.taskId ? asTaskId(ctx.taskId) : undefined;
    const taskId = asTaskId(this.options.ids.next("task"));
    const contextParts = [
      input.context,
      input.files?.length ? `Files: ${input.files.join(", ")}` : undefined,
    ].filter((part): part is string => Boolean(part));

    const task = this.options.state.tasks.create({
      id: taskId,
      runId,
      role: childRole,
      description: input.description,
      dependsOn: (input.dependsOn ?? []).map(asTaskId),
    });
    this.options.state.tasks.transition(taskId, "assigned");
    this.options.state.tasks.transition(taskId, "running");
    ctx.emit?.({
      type: "task.status",
      taskId,
      roleId: childRole,
      status: "running",
    });

    const childScope: RunScope = {
      sessionId,
      runId,
      taskId,
      signal: ctx.signal ?? new AbortController().signal,
      ...(ctx.emit ? { emit: ctx.emit } : {}),
      ...(ctx.requestApproval
        ? { requestApproval: ctx.requestApproval }
        : {}),
      ...(ctx.withWriteLock ? { withWriteLock: ctx.withWriteLock } : {}),
      delegation: {
        depth,
        maxDepth,
        ...(parentTaskId ? { parentTaskId } : {}),
        allowedRoles: this.options.roles.require(childRole).delegatableRoles,
      },
    };

    try {
      const result = await this.options.pool.invoke(
        childRole,
        {
          taskId,
          description: input.description,
          ...(contextParts.length ? { context: contextParts.join("\n") } : {}),
        },
        childScope,
      );

      this.options.state.tasks.setResult(taskId, result);
      if (result.status === "success") {
        this.options.state.tasks.transition(taskId, "completed");
      } else if (result.status === "replan_needed") {
        this.options.state.tasks.transition(taskId, "replan_needed");
      } else {
        this.options.state.tasks.transition(taskId, "failed");
      }
      ctx.emit?.({
        type: "task.status",
        taskId,
        roleId: childRole,
        status: this.options.state.tasks.get(taskId)?.status ?? "failed",
      });
      return result;
    } catch (error) {
      try {
        this.options.state.tasks.transition(taskId, "failed");
      } catch {
        // 状态可能已流转
      }
      const serialized = serializeError(error, "TOOL_FAILED");
      ctx.emit?.({
        type: "task.status",
        taskId,
        roleId: childRole,
        status: "failed",
      });
      return {
        taskId,
        role: childRole,
        status: "failed",
        summary: serialized.message,
        error: serialized,
      };
    } finally {
      void task;
    }
  }
}
