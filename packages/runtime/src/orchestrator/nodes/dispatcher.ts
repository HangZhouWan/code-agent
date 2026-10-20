/**
 * Dispatcher 节点 —— 找到依赖满足的任务，批量派发并汇总结果
 */

import type {
  RunScope,
  SessionStateManager,
} from "@code-agent/core";
import type {
  SessionEvent,
  SubTask,
  TaskId,
  TaskRecord,
  TaskResult,
} from "@code-agent/protocol";
import type { RoleRegistry } from "../../agents/role-registry.js";
import type { TaskDispatcher } from "../../dispatch/task-dispatcher.js";
import type { OrchestratorStateValue } from "../state.js";

export interface DispatcherNodeDeps {
  dispatcher: TaskDispatcher;
  state: SessionStateManager;
  roles: RoleRegistry;
  persistTask: (taskId: TaskId) => Promise<void>;
  emit: (event: SessionEvent) => void;
  baseScope: RunScope;
  memory?: string;
  maxReplans: number;
  maxConcurrency?: number;
}

function toTaskStatus(result: TaskResult): TaskRecord["status"] {
  switch (result.status) {
    case "success":
      return "completed";
    case "replan_needed":
      return "replan_needed";
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    default:
      return "failed";
  }
}

export function createDispatcherNode(deps: DispatcherNodeDeps) {
  const maxConcurrency = deps.maxConcurrency ?? 4;

  return async (state: OrchestratorStateValue) => {
    const resultIds = new Set(state.results.map((result) => result.taskId));
    const unfinished = state.tasks.filter((task) => !resultIds.has(task.id));
    const ready = unfinished.filter((task) =>
      task.dependsOn.every((dependency) => resultIds.has(dependency)),
    );

    if (ready.length === 0) {
      if (unfinished.length === 0) {
        return { nextAction: "finalize" as const };
      }
      return {
        nextAction:
          state.replanCount >= deps.maxReplans
            ? ("finalize" as const)
            : ("replan" as const),
      };
    }

    const batch = ready.slice(0, maxConcurrency);
    const newResults: TaskResult[] = [];
    // 因依赖失败而跳过的任务不算失败，避免触发无意义的 replan
    const skippedIds = new Set<string>();

    await Promise.all(
      batch.map(async (task) => {
        // 依赖未成功（失败/超时/取消）时跳过，避免 review/test 在产物
        // 不存在的情况下继续执行、浪费迭代次数。
        const failedDependency = task.dependsOn.find((dependency) => {
          const result = state.results.find(
            (item) => item.taskId === dependency,
          );
          return result !== undefined && result.status !== "success";
        });

        if (failedDependency) {
          const skipped: TaskResult = {
            taskId: task.id,
            role: task.role,
            status: "cancelled",
            summary: `依赖任务未成功，已跳过（${failedDependency}）`,
          };
          deps.state.tasks.setResult(task.id, skipped);
          try {
            deps.state.tasks.transition(task.id, "cancelled");
          } catch {
            // 状态可能已推进
          }
          await deps.persistTask(task.id);
          deps.emit({
            type: "task.status",
            taskId: task.id,
            roleId: task.role,
            status: "cancelled",
          });
          skippedIds.add(task.id);
          newResults.push(skipped);
          return;
        }

        const taskScope: RunScope = {
          ...deps.baseScope,
          taskId: task.id,
          delegation: {
            depth: 1,
            maxDepth: 2,
            allowedRoles: deps.roles.require(task.role).delegatableRoles,
          },
        };

        try {
          deps.state.tasks.transition(task.id, "assigned");
          deps.state.tasks.transition(task.id, "running");
        } catch {
          // 状态可能已推进
        }
        await deps.persistTask(task.id);
        deps.emit({
          type: "task.status",
          taskId: task.id,
          roleId: task.role,
          status: "running",
        });

        const dependencyContext = task.dependsOn
          .map((dependency) => {
            const result = state.results.find(
              (item) => item.taskId === dependency,
            );
            return result
              ? `- ${dependency}: ${result.status} — ${result.summary}`
              : undefined;
          })
          .filter((line): line is string => Boolean(line))
          .join("\n");

        const subTask: SubTask = {
          id: task.id,
          role: task.role,
          description: task.description,
          dependsOn: task.dependsOn,
          routing: task.routing,
        };

        let result: TaskResult;
        try {
          result = await deps.dispatcher.dispatch({
            sessionId: state.sessionId,
            runId: state.runId,
            task: subTask,
            dependencyContext,
            route: task.routing,
            scope: taskScope,
            ...(deps.memory ? { memory: deps.memory } : {}),
          });
        } catch (error) {
          result = {
            taskId: task.id,
            role: task.role,
            status: "failed",
            summary: error instanceof Error ? error.message : String(error),
          };
        }

        deps.state.tasks.setResult(task.id, result);
        try {
          deps.state.tasks.transition(task.id, toTaskStatus(result));
        } catch {
          // ignore
        }
        await deps.persistTask(task.id);
        deps.emit({
          type: "task.status",
          taskId: task.id,
          roleId: task.role,
          status: deps.state.tasks.get(task.id)?.status ?? toTaskStatus(result),
        });
        newResults.push(result);
      }),
    );

    const updatedTasks = state.tasks.map(
      (task) => deps.state.tasks.get(task.id) ?? task,
    );
    const allResults = [...state.results, ...newResults];
    const allDone = updatedTasks.every((task) =>
      allResults.some((result) => result.taskId === task.id),
    );
    const needsReplan = newResults.some(
      (result) =>
        result.status !== "success" && !skippedIds.has(result.taskId),
    );

    const nextAction = needsReplan
      ? state.replanCount >= deps.maxReplans
        ? ("finalize" as const)
        : ("replan" as const)
      : allDone
        ? ("finalize" as const)
        : ("continue" as const);

    return {
      results: newResults,
      tasks: updatedTasks,
      nextAction,
    };
  };
}
