/**
 * 新状态管理测试
 */

import { describe, expect, it } from "vitest";
import {
  asRunId,
  asSessionId,
  asTaskId,
  type Artifact,
  type TaskResult,
} from "@code-agent/protocol";
import {
  assertTransition,
  canTransition,
  InvalidTaskTransitionError,
} from "../task-machine.js";
import { TaskStateStore } from "../task-state.js";
import { ArtifactStateStore } from "../artifact-state.js";
import { SessionStateManager } from "../session-state.js";

const runId = asRunId("r1");
const sessionId = asSessionId("s1");
const taskId = asTaskId("t1");
const now = "2026-10-19T00:00:00.000Z";

describe("task machine", () => {
  it("允许合法流转", () => {
    expect(canTransition("pending", "assigned")).toBe(true);
    expect(canTransition("assigned", "running")).toBe(true);
    expect(canTransition("running", "completed")).toBe(true);
    expect(canTransition("failed", "replan_needed")).toBe(true);
  });

  it("拒绝非法流转", () => {
    expect(canTransition("pending", "completed")).toBe(false);
    expect(() => assertTransition("completed", "running")).toThrow(
      InvalidTaskTransitionError,
    );
  });
});

describe("TaskStateStore", () => {
  it("create / transition / setResult", () => {
    const store = new TaskStateStore(() => now);
    const task = store.create({
      id: taskId,
      runId,
      role: "code",
      description: "implement",
    });

    expect(task.status).toBe("pending");
    expect(task.dependsOn).toEqual([]);

    const assigned = store.transition(taskId, "assigned");
    expect(assigned.status).toBe("assigned");

    store.transition(taskId, "running");
    const result: TaskResult = {
      taskId,
      role: "code",
      status: "success",
      summary: "done",
    };
    const completed = store.setResult(taskId, result);
    expect(completed.result?.summary).toBe("done");

    expect(store.transition(taskId, "completed").status).toBe("completed");
  });

  it("重复创建与非法流转抛错", () => {
    const store = new TaskStateStore(() => now);
    store.create({ id: taskId, runId, role: "code", description: "x" });
    expect(() =>
      store.create({ id: taskId, runId, role: "code", description: "x" }),
    ).toThrow(/already exists/);
    expect(() => store.transition(taskId, "completed")).toThrow(
      InvalidTaskTransitionError,
    );
  });

  it("hydrate 恢复任务", () => {
    const store = new TaskStateStore(() => now);
    store.create({ id: taskId, runId, role: "code", description: "x" });
    const snapshot = store.snapshot();

    const restored = new TaskStateStore(() => now);
    restored.hydrate(snapshot);
    expect(restored.get(taskId)?.description).toBe("x");
  });
});

describe("ArtifactStateStore", () => {
  it("按 run / task 查询与 hydrate", () => {
    const store = new ArtifactStateStore();
    const artifact: Artifact = {
      id: "a1",
      runId,
      taskId,
      type: "file_change",
      payload: { path: "a.ts" },
      createdAt: now,
    };
    store.add(artifact);

    expect(store.listByRun(runId)).toHaveLength(1);
    expect(store.listByTask(taskId)).toHaveLength(1);

    const restored = new ArtifactStateStore();
    restored.hydrate(store.snapshot());
    expect(restored.get("a1")?.type).toBe("file_change");
  });
});

describe("SessionStateManager", () => {
  it("由 TaskState 派生角色活动状态", () => {
    const state = new SessionStateManager(sessionId, () => now);
    state.tasks.create({
      id: taskId,
      runId,
      role: "code",
      description: "implement",
    });
    state.tasks.create({
      id: asTaskId("t2"),
      runId,
      role: "test",
      description: "test",
    });
    state.tasks.transition(taskId, "assigned");
    state.tasks.transition(taskId, "running");
    state.tasks.transition(asTaskId("t2"), "assigned");

    const activity = state.getAgentActivity();
    expect(activity).toEqual(
      expect.arrayContaining([
        { roleId: "code", activeTaskIds: [taskId] },
        { roleId: "test", activeTaskIds: [asTaskId("t2")] },
      ]),
    );
  });

  it("snapshot / hydrate / clear", () => {
    const state = new SessionStateManager(sessionId, () => now);
    state.tasks.create({ id: taskId, runId, role: "code", description: "x" });
    const snapshot = state.snapshot();

    const restored = new SessionStateManager(sessionId, () => now);
    restored.hydrate(snapshot.tasks, snapshot.artifacts);
    expect(restored.tasks.get(taskId)).toBeDefined();

    restored.clear();
    expect(restored.tasks.size).toBe(0);
    expect(restored.artifacts.size).toBe(0);
  });
});
