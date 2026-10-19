/**
 * 两层 Checkpoint 存储测试
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asRunId,
  asSessionId,
  asTaskId,
  type RunId,
  type SessionId,
  type TaskId,
} from "@code-agent/protocol";
import { InMemoryCheckpointStore } from "../memory-store.js";
import { FileCheckpointStore } from "../file-store.js";
import {
  CheckpointVersionError,
  type AgentCheckpointV1,
  type CheckpointStore,
  type SessionCheckpointV1,
} from "../types.js";

const sessionId = asSessionId("s1");
const runId = asRunId("r1");
const runId2 = asRunId("r2");
const taskId = asTaskId("t1");
const now = "2026-10-19T00:00:00.000Z";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-ckpt-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function agentCheckpoint(
  overrides: Partial<AgentCheckpointV1> = {},
): AgentCheckpointV1 {
  return {
    v: 1,
    sessionId,
    runId,
    taskId,
    roleId: "code",
    step: 1,
    status: "running",
    messages: [{ role: "human", content: "hi" }],
    tokenCount: 10,
    toolHistory: [],
    startedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sessionCheckpoint(
  overrides: Partial<SessionCheckpointV1> = {},
): SessionCheckpointV1 {
  return {
    v: 1,
    sessionId,
    runId,
    status: "running",
    node: "planner",
    tasks: [],
    completedTaskIds: [],
    pendingTaskIds: [],
    inFlightTaskIds: [],
    artifacts: [],
    messages: [],
    pendingApprovals: [],
    replanCount: 0,
    nextSeq: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function commonStoreTests(
  name: string,
  createStore: () => { store: CheckpointStore; cleanup?: () => void },
) {
  describe(name, () => {
    it("保存/加载 Agent checkpoint，并做 run 命名空间隔离", async () => {
      const { store } = createStore();
      await store.saveAgent(agentCheckpoint());
      await store.saveAgent(
        agentCheckpoint({
          runId: runId2,
          taskId: asTaskId("t1"),
          roleId: "test",
          tokenCount: 99,
        }),
      );

      expect((await store.loadAgent(sessionId, runId, taskId))?.roleId).toBe(
        "code",
      );
      expect(
        (await store.loadAgent(sessionId, runId2, taskId))?.roleId,
      ).toBe("test");
      expect(await store.loadAgent(sessionId, asRunId("missing"), taskId)).toBeNull();
    });

    it("保存/加载最新 Session checkpoint", async () => {
      const { store } = createStore();
      await store.saveSession(
        sessionCheckpoint({ updatedAt: "2026-10-19T00:00:00.000Z" }),
      );
      await store.saveSession(
        sessionCheckpoint({
          runId: runId2,
          updatedAt: "2026-10-19T01:00:00.000Z",
          node: "dispatcher",
        }),
      );

      const latest = await store.loadLatestSession(sessionId);
      expect(latest?.runId).toBe(runId2);
      expect(latest?.node).toBe("dispatcher");
    });

    it("listRecoverable 排除 completed / aborted", async () => {
      const { store } = createStore();
      await store.saveSession(sessionCheckpoint({ status: "running" }));
      await store.saveSession(
        sessionCheckpoint({
          runId: runId2,
          status: "completed",
          updatedAt: "2026-10-19T01:00:00.000Z",
        }),
      );
      await store.saveSession(
        sessionCheckpoint({
          runId: asRunId("r3"),
          status: "aborted",
          updatedAt: "2026-10-19T02:00:00.000Z",
        }),
      );

      const recoverable = await store.listRecoverable();
      expect(recoverable).toHaveLength(1);
      expect(recoverable[0].runId).toBe(runId);
    });

    it("purgeRun 同时清理 session 与 agent checkpoint", async () => {
      const { store } = createStore();
      await store.saveAgent(agentCheckpoint());
      await store.saveSession(sessionCheckpoint());

      await store.purgeRun(sessionId, runId);

      expect(await store.loadAgent(sessionId, runId, taskId)).toBeNull();
      expect(await store.loadLatestSession(sessionId)).toBeNull();
    });

    it("租约互斥、续期、释放与过期", async () => {
      let current = 1_000;
      const { store } = createStoreWithClock(() => current);

      expect(await store.acquireLease(sessionId, "a", 100)).toBe(true);
      expect(await store.acquireLease(sessionId, "b", 100)).toBe(false);
      expect(await store.renewLease(sessionId, "a", 100)).toBe(true);
      expect(await store.releaseLease(sessionId, "a")).toBeUndefined();

      current = 2_000;
      expect(await store.acquireLease(sessionId, "b", 100)).toBe(true);
    });
  });

  function createStoreWithClock(clock: () => number) {
    if (name === "InMemoryCheckpointStore") {
      return { store: new InMemoryCheckpointStore(clock) };
    }
    return {
      store: new FileCheckpointStore({ baseDir: tempDir(), now: clock }),
    };
  }
}

commonStoreTests(
  "InMemoryCheckpointStore",
  () => ({ store: new InMemoryCheckpointStore() }),
);

commonStoreTests("FileCheckpointStore", () => ({
  store: new FileCheckpointStore({ baseDir: tempDir() }),
}));

describe("checkpoint version", () => {
  it("内存存储在 save 时拒绝错误版本", async () => {
    const store = new InMemoryCheckpointStore();
    await expect(
      store.saveAgent({
        ...agentCheckpoint(),
        v: 2,
      } as unknown as AgentCheckpointV1),
    ).rejects.toBeInstanceOf(CheckpointVersionError);
  });

  it("文件存储在 load 时拒绝错误版本", async () => {
    const baseDir = tempDir();
    const store = new FileCheckpointStore({ baseDir });
    const dir = join(baseDir, "sessions", "s1", "r1", "tasks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "t1.json"),
      JSON.stringify({ v: 2, taskId: "t1" }),
      "utf-8",
    );

    await expect(
      store.loadAgent(sessionId, runId, taskId),
    ).rejects.toBeInstanceOf(CheckpointVersionError);
  });

  it("文件存储写入后文件存在", async () => {
    const baseDir = tempDir();
    const store = new FileCheckpointStore({ baseDir });
    await store.saveAgent(agentCheckpoint());
    expect(
      existsSync(join(baseDir, "sessions", "s1", "r1", "tasks", "t1.json")),
    ).toBe(true);
  });
});
