/**
 * Planner 节点
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  extractText,
  type ChatModelLike,
  type SessionStateManager,
} from "@code-agent/core";
import {
  asTaskId,
  type Plan,
  type SessionEvent,
  type TaskId,
  type TaskRecord,
} from "@code-agent/protocol";
import type { RoleRegistry } from "../../agents/role-registry.js";
import type { Clock, IdGenerator } from "../../ports/types.js";
import { parsePlannerPlan, plannerPrompt, type PlannerPlan } from "../schemas.js";
import type { OrchestratorStateValue } from "../state.js";

export interface PlannerNodeDeps {
  model: ChatModelLike;
  roles: RoleRegistry;
  ids: IdGenerator;
  clock: Clock;
  state: SessionStateManager;
  persistTask: (taskId: TaskId) => Promise<void>;
  emit: (event: SessionEvent) => void;
  signal?: AbortSignal;
}

export function createPlannerNode(deps: PlannerNodeDeps) {
  return async (state: OrchestratorStateValue) => {
    let output: PlannerPlan | null = null;

    const historyText = (state.history ?? [])
      .map((message) => `[${message.role}] ${message.content}`)
      .join("\n")
      .slice(0, 6_000);

    try {
      const response = await deps.model.invoke(
        [
          new SystemMessage({
            content: plannerPrompt(deps.roles.list().map((role) => role.id)),
          }),
          new HumanMessage({
            content: [
              historyText
                ? `Conversation history:\n${historyText}`
                : "",
              `Current request: ${state.userMessage}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          }),
        ],
        deps.signal ? { signal: deps.signal } : {},
      );
      output = parsePlannerPlan(extractText(response));
    } catch {
      output = null;
    }

    if (!output) {
      output = {
        complexity: "simple",
        tasks: [
          {
            role: "code",
            description: state.userMessage,
            dependsOn: [],
            routing: "direct",
          },
        ],
      };
    }

    const used = new Set<string>();
    const records: TaskRecord[] = [];
    for (const item of output.tasks) {
      let id =
        item.id && !used.has(item.id) ? item.id : deps.ids.next("task");
      while (used.has(id)) id = deps.ids.next("task");
      used.add(id);

      const role = deps.roles.has(item.role) ? item.role : "code";
      const task = deps.state.tasks.create({
        id: asTaskId(id),
        runId: state.runId,
        role,
        description: item.description,
        routing: item.routing,
        dependsOn: item.dependsOn.map(asTaskId),
      });
      records.push(task);
      await deps.persistTask(task.id);
    }

    const plan: Plan = {
      complexity: output.complexity,
      tasks: records.map((task) => ({
        id: task.id,
        role: task.role,
        description: task.description,
        dependsOn: task.dependsOn,
        routing: task.routing,
      })),
    };

    deps.emit({ type: "plan.updated", plan });
    void deps.clock;

    return {
      plan,
      tasks: records,
      nextAction: "continue" as const,
    };
  };
}
