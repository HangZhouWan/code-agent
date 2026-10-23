/**
 * Task 状态机
 */

import type { TaskStatus } from "@code-agent/protocol";

export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["assigned", "cancelled"],
  assigned: ["running", "failed", "cancelled"],
  running: [
    "awaiting_approval",
    "awaiting_input",
    "completed",
    "failed",
    "timeout",
    "replan_needed",
    "cancelled",
  ],
  awaiting_approval: ["running", "failed", "cancelled"],
  awaiting_input: ["running", "failed", "cancelled"],
  completed: [],
  failed: ["replan_needed", "cancelled"],
  timeout: ["replan_needed", "failed", "cancelled"],
  replan_needed: ["pending", "assigned", "cancelled"],
  cancelled: [],
};

export class InvalidTaskTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid task transition: ${from} -> ${to}`);
    this.name = "InvalidTaskTransitionError";
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTaskTransitionError(from, to);
  }
}
