/**
 * 按 plan.routing 选择 Direct / Bus
 */

import type { TaskResult } from "@code-agent/protocol";
import type { DispatchRequest, TaskDispatcher } from "./task-dispatcher.js";

export class RoutingDispatcher implements TaskDispatcher {
  constructor(
    private readonly direct: TaskDispatcher,
    private readonly bus: TaskDispatcher,
  ) {}

  async dispatch(request: DispatchRequest): Promise<TaskResult> {
    return request.route === "bus"
      ? this.bus.dispatch(request)
      : this.direct.dispatch(request);
  }
}
