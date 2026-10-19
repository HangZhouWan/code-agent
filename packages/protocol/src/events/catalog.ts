/**
 * Event Bus 的类型化 Topic 目录
 *
 * - Command：请求/响应，按 role group 独占投递
 * - Event：广播通知
 */

import type { MemoryId, RunId, TaskId } from "../ids.js";
import type { IsoTimestamp } from "../json.js";
import type { SerializedError } from "../errors.js";
import type { AgentRoleId } from "../domain/role.js";
import type { SubTask } from "../domain/plan.js";
import type { TaskResult } from "../domain/task.js";

export type AgentCommandTopic = `agent.command.${AgentRoleId}`;

export interface AgentCommandPayload {
  task: SubTask;
  context: string;
  runId: RunId;
  taskId: TaskId;
}

export type CommandTopicMap = {
  [K in AgentCommandTopic]: AgentCommandPayload;
};

export type CommandTopic = keyof CommandTopicMap;
export type CommandPayload<K extends CommandTopic> = CommandTopicMap[K];

export interface TaskStartedEvent {
  runId: RunId;
  taskId: TaskId;
  role: AgentRoleId;
  startedAt: IsoTimestamp;
}

export interface TaskCompletedEvent {
  runId: RunId;
  taskId: TaskId;
  role: AgentRoleId;
  result: TaskResult;
  completedAt: IsoTimestamp;
}

export interface TaskFailedEvent {
  runId: RunId;
  taskId: TaskId;
  role: AgentRoleId;
  error: SerializedError;
  failedAt: IsoTimestamp;
}

export interface TaskBlockedEvent {
  runId: RunId;
  taskId: TaskId;
  role: AgentRoleId;
  blockedBy: TaskId[];
}

export interface CheckpointSavedEvent {
  checkpointId: string;
  scope: "agent" | "session";
  node?: string;
}

export interface MemoryUpdatedEvent {
  memoryId: MemoryId;
  op: "created" | "updated" | "merged" | "deleted" | "pending_review";
}

export type EventTopicMap = {
  "agent.event.task.started": TaskStartedEvent;
  "agent.event.task.completed": TaskCompletedEvent;
  "agent.event.task.failed": TaskFailedEvent;
  "agent.event.task.blocked": TaskBlockedEvent;
  "agent.event.checkpoint.saved": CheckpointSavedEvent;
  "agent.event.memory.updated": MemoryUpdatedEvent;
};

export type EventTopic = keyof EventTopicMap;
export type EventPayload<K extends EventTopic> = EventTopicMap[K];

/** 构造角色 command topic */
export function agentCommandTopic(role: AgentRoleId): AgentCommandTopic {
  return `agent.command.${role}` as AgentCommandTopic;
}
