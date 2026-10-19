/**
 * Agent 执行契约
 */

import type {
  AgentRoleId,
  RunId,
  SessionEvent,
  SessionId,
  TaskId,
  TaskResult,
} from "@code-agent/protocol";
import type { SerializedMessage } from "@code-agent/protocol";
import type { ToolContext, ToolDefinition } from "../tools/base.js";

export interface RunScope {
  sessionId: SessionId;
  runId: RunId;
  taskId: TaskId;
  agentRunId?: string;
  signal: AbortSignal;
  emit?: (event: SessionEvent) => void;
  requestApproval?: ToolContext["requestApproval"];
  withWriteLock?: ToolContext["withWriteLock"];
}

export interface AgentTaskInput {
  taskId: TaskId;
  role: AgentRoleId;
  description: string;
  context?: string;
  systemPrompt?: string;
  tools: ToolDefinition[];
  workspacePath: string;
  maxIterations?: number;
  timeoutMs?: number;
  messages?: SerializedMessage[];
  /** 已渲染的记忆块（作为数据注入） */
  memory?: string;
}

export interface AgentInvoker {
  invoke(input: AgentTaskInput, scope: RunScope): Promise<TaskResult>;
}
