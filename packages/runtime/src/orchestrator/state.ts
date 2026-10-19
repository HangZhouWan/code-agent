/**
 * LangGraph 编排状态
 */

import { Annotation } from "@langchain/langgraph";
import type {
  Plan,
  RunId,
  SerializedMessage,
  SessionId,
  TaskRecord,
  TaskResult,
} from "@code-agent/protocol";
import type { SessionNode } from "@code-agent/core";

export type NextAction = "continue" | "replan" | "finalize";

function mergeTasks(
  current: TaskRecord[],
  update: TaskRecord[],
): TaskRecord[] {
  const map = new Map(current.map((task) => [task.id, task]));
  for (const task of update) {
    map.set(task.id, task);
  }
  return [...map.values()];
}

export const OrchestratorState = Annotation.Root({
  runId: Annotation<RunId>(),
  sessionId: Annotation<SessionId>(),
  userMessage: Annotation<string>(),
  history: Annotation<SerializedMessage[]>({
    reducer: (
      _current: SerializedMessage[],
      update: SerializedMessage[],
    ) => update,
    default: () => [],
  }),
  memory: Annotation<string | undefined>(),
  plan: Annotation<Plan | undefined>(),
  tasks: Annotation<TaskRecord[]>({
    reducer: mergeTasks,
    default: () => [],
  }),
  results: Annotation<TaskResult[]>({
    reducer: (current: TaskResult[], update: TaskResult[]) => [
      ...current,
      ...update,
    ],
    default: () => [],
  }),
  nextAction: Annotation<NextAction | undefined>(),
  replanCount: Annotation<number>({
    reducer: (current: number, update: number) => Math.max(current, update),
    default: () => 0,
  }),
  finalResponse: Annotation<string | undefined>(),
  resumeNode: Annotation<SessionNode | undefined>(),
});

export interface OrchestratorStateValue {
  runId: RunId;
  sessionId: SessionId;
  userMessage: string;
  history: SerializedMessage[];
  memory?: string;
  plan?: Plan;
  tasks: TaskRecord[];
  results: TaskResult[];
  nextAction?: NextAction;
  replanCount: number;
  finalResponse?: string;
  resumeNode?: SessionNode;
}
