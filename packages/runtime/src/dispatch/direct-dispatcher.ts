/**
 * DirectDispatcher —— 直接调用角色 Agent
 */

import type { TaskResult } from "@code-agent/protocol";
import type { AgentPool } from "../agents/agent-pool.js";
import type { DispatchRequest, TaskDispatcher } from "./task-dispatcher.js";

export class DirectDispatcher implements TaskDispatcher {
  constructor(private readonly pool: AgentPool) {}

  async dispatch(request: DispatchRequest): Promise<TaskResult> {
    return this.pool.invoke(
      request.task.role,
      {
        taskId: request.task.id,
        description: request.task.description,
        context: request.dependencyContext,
        ...(request.memory ? { memory: request.memory } : {}),
      },
      { ...request.scope, taskId: request.task.id },
    );
  }
}
