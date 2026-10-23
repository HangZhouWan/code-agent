/**
 * SessionOrchestrator —— 运行 LangGraph 编排并返回最终结果
 */

import type {
  ChatModelLike,
  RunScope,
  SessionNode,
  SessionStateManager,
} from "@code-agent/core";
import type {
  Plan,
  RunId,
  SerializedMessage,
  SessionEvent,
  SessionId,
  TaskId,
  TaskRecord,
  TaskResult,
} from "@code-agent/protocol";
import type { RoleRegistry } from "../agents/role-registry.js";
import type { TaskDispatcher } from "../dispatch/task-dispatcher.js";
import type { Clock, IdGenerator } from "../ports/types.js";
import { createOrchestratorGraph } from "./graph.js";

export interface SessionOrchestratorDeps {
  model: ChatModelLike;
  roles: RoleRegistry;
  ids: IdGenerator;
  clock: Clock;
  state: SessionStateManager;
  dispatcher: TaskDispatcher;
  persistTask: (taskId: TaskId) => Promise<void>;
  emit: (event: SessionEvent) => void;
  maxReplans?: number;
}

export interface OrchestratorRunInput {
  runId: RunId;
  sessionId: SessionId;
  userMessage: string;
  history?: SerializedMessage[];
  memory?: string;
  scope: RunScope;
  resumeNode?: SessionNode;
  /** 恢复时注入已完成/失败任务 */
  tasks?: TaskRecord[];
  results?: TaskResult[];
}

export interface OrchestratorRunResult {
  finalResponse: string;
  results: TaskResult[];
  plan?: Plan;
}

export class SessionOrchestrator {
  constructor(private readonly deps: SessionOrchestratorDeps) {}

  async run(input: OrchestratorRunInput): Promise<OrchestratorRunResult> {
    const graph = createOrchestratorGraph({
      ...this.deps,
      baseScope: input.scope,
      ...(input.memory ? { memory: input.memory } : {}),
    });

    const initial = {
      runId: input.runId,
      sessionId: input.sessionId,
      userMessage: input.userMessage,
      history: input.history ?? [],
      ...(input.memory ? { memory: input.memory } : {}),
      tasks: input.tasks ?? [],
      results: input.results ?? [],
      replanCount: 0,
      ...(input.resumeNode ? { resumeNode: input.resumeNode } : {}),
    };

    const result = await graph.invoke(initial, {
      recursionLimit: 50,
      configurable: { thread_id: input.runId },
      runName: "code-agent-session",
      tags: ["code-agent", `session:${input.sessionId}`],
      metadata: {
        sessionId: String(input.sessionId),
        runId: String(input.runId),
      },
      signal: input.scope.signal,
    });

    const results = result.results ?? [];
    const fallback = results
      .map((item) => `- [${item.role}] ${item.summary}`)
      .join("\n");

    return {
      finalResponse: result.finalResponse ?? fallback,
      results,
      ...(result.plan ? { plan: result.plan } : {}),
    };
  }
}
