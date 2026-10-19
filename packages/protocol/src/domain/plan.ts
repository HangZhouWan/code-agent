/**
 * 计划与任务状态
 */

import type { TaskId } from "../ids.js";
import type { AgentRoleId } from "./role.js";

export const TASK_STATUSES = [
  "pending",
  "assigned",
  "running",
  "awaiting_approval",
  "awaiting_input",
  "completed",
  "failed",
  "timeout",
  "replan_needed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskRouting = "direct" | "bus";

export interface SubTask {
  id: TaskId;
  role: AgentRoleId;
  description: string;
  tools?: string[];
  dependsOn?: TaskId[];
  routing?: TaskRouting;
}

export interface Plan {
  complexity: "simple" | "complex";
  tasks: SubTask[];
  suggestedAgents?: Record<string, AgentRoleId>;
}
