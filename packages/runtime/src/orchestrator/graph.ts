/**
 * LangGraph 编排图
 *
 * START → Planner → Dispatcher ⇄ Replanner → Finalizer → END
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import type { RunScope, SessionStateManager, ChatModelLike } from "@code-agent/core";
import type { SessionEvent, TaskId } from "@code-agent/protocol";
import type { RoleRegistry } from "../agents/role-registry.js";
import type { TaskDispatcher } from "../dispatch/task-dispatcher.js";
import type { Clock, IdGenerator } from "../ports/types.js";
import { createDispatcherNode } from "./nodes/dispatcher.js";
import { createFinalizerNode } from "./nodes/finalizer.js";
import { createPlannerNode } from "./nodes/planner.js";
import { createReplannerNode } from "./nodes/replanner.js";
import { OrchestratorState } from "./state.js";

export interface OrchestratorGraphDeps {
  model: ChatModelLike;
  roles: RoleRegistry;
  ids: IdGenerator;
  clock: Clock;
  state: SessionStateManager;
  dispatcher: TaskDispatcher;
  persistTask: (taskId: TaskId) => Promise<void>;
  emit: (event: SessionEvent) => void;
  baseScope: RunScope;
  memory?: string;
  maxReplans?: number;
}

export function createOrchestratorGraph(deps: OrchestratorGraphDeps) {
  const maxReplans = deps.maxReplans ?? 2;
  const signal = deps.baseScope.signal;

  const planner = createPlannerNode({
    model: deps.model,
    roles: deps.roles,
    ids: deps.ids,
    clock: deps.clock,
    state: deps.state,
    persistTask: deps.persistTask,
    emit: deps.emit,
    signal,
  });
  const dispatcher = createDispatcherNode({
    dispatcher: deps.dispatcher,
    state: deps.state,
    roles: deps.roles,
    persistTask: deps.persistTask,
    emit: deps.emit,
    baseScope: deps.baseScope,
    ...(deps.memory ? { memory: deps.memory } : {}),
    maxReplans,
  });
  const replanner = createReplannerNode({
    model: deps.model,
    roles: deps.roles,
    ids: deps.ids,
    clock: deps.clock,
    state: deps.state,
    persistTask: deps.persistTask,
    emit: deps.emit,
    maxReplans,
    signal,
  });
  const finalizer = createFinalizerNode({ model: deps.model, signal });

  return new StateGraph(OrchestratorState)
    .addNode("planner", planner)
    .addNode("dispatcher", dispatcher)
    .addNode("replanner", replanner)
    .addNode("finalizer", finalizer)
    .addConditionalEdges(
      START,
      (state) => state.resumeNode ?? "planner",
      {
        planner: "planner",
        dispatcher: "dispatcher",
        replanner: "replanner",
        finalizer: "finalizer",
      },
    )
    .addEdge("planner", "dispatcher")
    .addConditionalEdges(
      "dispatcher",
      (state) => state.nextAction ?? "finalize",
      {
        continue: "dispatcher",
        replan: "replanner",
        finalize: "finalizer",
      },
    )
    .addEdge("replanner", "dispatcher")
    .addEdge("finalizer", END)
    .compile();
}
