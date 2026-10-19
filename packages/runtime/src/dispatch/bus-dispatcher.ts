/**
 * BusDispatcher —— 通过类型化 Event Bus 派发命令
 */

import {
  BusError,
  type TypedEventBus,
} from "@code-agent/core";
import {
  agentCommandTopic,
  serializeError,
  type TaskResult,
} from "@code-agent/protocol";
import type { DispatchRequest, TaskDispatcher } from "./task-dispatcher.js";

export class BusDispatcher implements TaskDispatcher {
  constructor(private readonly bus: TypedEventBus) {}

  async dispatch(request: DispatchRequest): Promise<TaskResult> {
    try {
      return await this.bus.request(
        agentCommandTopic(request.task.role),
        {
          task: request.task,
          context: request.dependencyContext,
          runId: request.runId,
          taskId: request.task.id,
        },
        {
          timeoutMs: 120_000,
          signal: request.scope.signal,
          metadata: {
            sessionId: request.sessionId,
            runId: request.runId,
            taskId: request.task.id,
          },
        },
      );
    } catch (error) {
      const serialized =
        error instanceof BusError
          ? error.serialized
          : serializeError(error, "BUS_TIMEOUT");
      return {
        taskId: request.task.id,
        role: request.task.role,
        status: "failed",
        summary: serialized.message,
        error: serialized,
      };
    }
  }
}
