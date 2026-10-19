/**
 * 全局 ID 类型
 *
 * 使用 branded string 防止不同实体的 ID 互相赋值。
 * ID 的生成由 runtime 的 IdGenerator 负责，protocol 只定义类型与安全转换。
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SessionId = Brand<string, "SessionId">;
export type RunId = Brand<string, "RunId">;
export type TaskId = Brand<string, "TaskId">;
export type CallId = Brand<string, "CallId">;
export type AgentId = Brand<string, "AgentId">;
export type AgentRunId = Brand<string, "AgentRunId">;
export type QuestionId = Brand<string, "QuestionId">;
export type MemoryId = Brand<string, "MemoryId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;

export function asSessionId(value: string): SessionId {
  return value as SessionId;
}

export function asRunId(value: string): RunId {
  return value as RunId;
}

export function asTaskId(value: string): TaskId {
  return value as TaskId;
}

export function asCallId(value: string): CallId {
  return value as CallId;
}

export function asAgentId(value: string): AgentId {
  return value as AgentId;
}

export function asAgentRunId(value: string): AgentRunId {
  return value as AgentRunId;
}

export function asQuestionId(value: string): QuestionId {
  return value as QuestionId;
}

export function asMemoryId(value: string): MemoryId {
  return value as MemoryId;
}

export function asWorkspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}
