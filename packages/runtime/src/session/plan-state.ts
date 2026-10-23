/**
 * 会话级 Plan 状态（plan_update 工具）
 */

import type { Plan } from "@code-agent/protocol";
import type { PlanTaskInput } from "@code-agent/core";

export class PlanState {
  private plan: Plan | undefined;

  update(tasks: PlanTaskInput[]): Plan {
    const plan: Plan = {
      complexity: "complex",
      tasks: tasks.map((task) => ({
        id: task.id as Plan["tasks"][number]["id"],
        role: task.role ?? "code",
        description: task.description,
        dependsOn: (task.dependsOn ?? []) as Plan["tasks"][number]["id"][],
      })),
    };
    this.plan = plan;
    return plan;
  }

  get(): Plan | undefined {
    return this.plan;
  }

  clear(): void {
    this.plan = undefined;
  }
}
