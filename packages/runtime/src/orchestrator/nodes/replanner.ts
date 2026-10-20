/**
 * Replanner 节点
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
import { parsePlannerPlan, plannerPrompt } from "../schemas.js";
import type { OrchestratorStateValue } from "../state.js";

export interface ReplannerNodeDeps {
  model: ChatModelLike;
  roles: RoleRegistry;
  ids: IdGenerator;
  clock: Clock;
  state: SessionStateManager;
  persistTask: (taskId: TaskId) => Promise<void>;
  emit: (event: SessionEvent) => void;
  maxReplans: number;
  signal?: AbortSignal;
}

export function createReplannerNode(deps: ReplannerNodeDeps) {
  return async (state: OrchestratorStateValue) => {
    if (state.replanCount >= deps.maxReplans) {
      return {
        nextAction: "finalize" as const,
        replanCount: state.replanCount,
      };
    }

    const failed = state.results.filter(
      (result) => result.status !== "success",
    );
    const failureText = failed
      .map(
        (result) =>
          `- [${result.role}] ${result.status}: ${result.summary}${
            result.error ? ` (${result.error.code})` : ""
          }`,
      )
      .join("\n");

    // 没有结果的任务通常是依赖无法满足（不会被调度），也要告诉 replanner
    const completedIds = new Set(state.results.map((result) => result.taskId));
    const unfinished = state.tasks.filter(
      (task) => !completedIds.has(task.id),
    );
    const unfinishedText = unfinished
      .map(
        (task) =>
          `- [${task.role}] ${task.id} (${task.status}) dependsOn=[${task.dependsOn.join(", ")}]: ${task.description}`,
      )
      .join("\n");

    let output = null;
    try {
      const response = await deps.model.invoke(
        [
          new SystemMessage({
            content: plannerPrompt(deps.roles.list().map((role) => role.id)),
          }),
          new HumanMessage({
            content:
              `Original request: ${state.userMessage}\n\n` +
              `Failures:\n${failureText || "(none)"}\n\n` +
              `Unfinished tasks:\n${unfinishedText || "(none)"}\n\n` +
              "Create repair subtasks needed to reach the user's goal. " +
              "Do not duplicate tasks that already completed. " +
              (state.plan?.complexity === "simple"
                ? "This is a simple single-deliverable request: return exactly one code repair task. "
                : "") +
              "Return JSON only.",
          }),
        ],
        deps.signal ? { signal: deps.signal } : {},
      );
      output = parsePlannerPlan(extractText(response));
    } catch {
      output = null;
    }

    if (!output) {
      return {
        nextAction: "finalize" as const,
        replanCount: state.replanCount + 1,
      };
    }

    // 简单任务只补一个 code 修复任务，避免每轮 replan 都追加完整流水线
    if (state.plan?.complexity === "simple" && output.tasks.length > 1) {
      const primary =
        output.tasks.find((task) => task.role === "code") ?? output.tasks[0];
      output = { ...output, tasks: [{ ...primary, dependsOn: [] }] };
    }

    const used = new Set<string>(state.tasks.map((task) => task.id));
    const records: TaskRecord[] = [];
    for (const item of output.tasks) {
      let id = item.id && !used.has(item.id) ? item.id : deps.ids.next("task");
      while (used.has(id)) id = deps.ids.next("task");
      used.add(id);

      const role = deps.roles.has(item.role) ? item.role : "code";
      const task = deps.state.tasks.create({
        id: asTaskId(id),
        runId: state.runId,
        role,
        description: item.description,
        routing: item.routing,
        dependsOn: item.dependsOn
          .filter((dependency) => used.has(dependency))
          .map(asTaskId),
      });
      records.push(task);
      await deps.persistTask(task.id);
    }

    const allTasks = [...state.tasks, ...records];
    const plan: Plan = {
      complexity: "complex",
      tasks: allTasks.map((task) => ({
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
      replanCount: state.replanCount + 1,
      nextAction: "continue" as const,
    };
  };
}
