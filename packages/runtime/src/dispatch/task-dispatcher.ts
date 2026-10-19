/**
 * TaskDispatcher 契约
 */

import type { RunScope } from "@code-agent/core";
import type {
  RunId,
  SessionId,
  SubTask,
  TaskResult,
} from "@code-agent/protocol";

export interface DispatchRequest {
  sessionId: SessionId;
  runId: RunId;
  task: SubTask;
  dependencyContext: string;
  route: "direct" | "bus";
  scope: RunScope;
  memory?: string;
}

export interface TaskDispatcher {
  dispatch(request: DispatchRequest): Promise<TaskResult>;
}
