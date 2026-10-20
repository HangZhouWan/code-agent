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

    // 简单任务只保留一个主任务（优先 code），避免为单文件交付额外派发
    // test/review 子任务，把简单需求放大成多 Agent 流水线。
    if (output.complexity === "simple" && output.tasks.length > 1) {
      const primary =
        output.tasks.find((task) => task.role === "code") ?? output.tasks[0];
      output = {
        complexity: "simple",
        tasks: [{ ...primary, dependsOn: [] }],
      };
    }

    // 先为所有任务分配最终 ID，才能解析 dependsOn 引用
    const used = new Set<string>();
    const planned = output.tasks.map((item) => {
      let id = item.id && !used.has(item.id) ? item.id : deps.ids.next("task");
      while (used.has(id)) id = deps.ids.next("task");
      used.add(id);
      return { item, id };
    });

    // Planner 常把 dependsOn 写成角色名（如 "code"）或不存在的 ID。
    // 解析顺序：planner 提供的任务 ID → 同角色的首个任务 → 丢弃无法满足的依赖。
    const idByPlannerId = new Map<string, string>();
    const idByRole = new Map<string, string>();
    for (const { item, id } of planned) {
      if (item.id) idByPlannerId.set(item.id, id);
      if (!idByRole.has(item.role)) idByRole.set(item.role, id);
    }

    const records: TaskRecord[] = [];
    for (const { item, id } of planned) {
      const role = deps.roles.has(item.role) ? item.role : "code";
      const dependsOn = [...new Set(item.dependsOn)]
        .map(
          (dependency) =>
            idByPlannerId.get(dependency) ??
            idByRole.get(dependency) ??
            dependency,
        )
        .filter(
          (dependency) => dependency !== id && used.has(dependency),
        )
        .map(asTaskId);

      const task = deps.state.tasks.create({
        id: asTaskId(id),
        runId: state.runId,
        role,
        description: item.description,
        routing: item.routing,
        dependsOn,
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
