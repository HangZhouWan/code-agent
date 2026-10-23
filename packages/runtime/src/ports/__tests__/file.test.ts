/**
 * 文件持久化端口测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asRunId,
  asSessionId,
  asTaskId,
  type Artifact,
  type ChatMessage,
  type EventEnvelope,
  type SessionEvent,
  type TaskRecord,
} from "@code-agent/protocol";
import { createInMemoryPorts } from "../in-memory.js";
import {
  FileEventLog,
  FileRunStore,
  FileSessionStore,
  createFilePorts,
} from "../file.js";

const sessionId = asSessionId("s1");
const runId = asRunId("r1");
const taskId = asTaskId("t1");
const now = "2026-10-19T00:00:00.000Z";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-fileports-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("FileSessionStore", () => {
  it("会话与消息跨实例持久化", async () => {
    const dir = tempDir();
    const store = new FileSessionStore(dir);
    await store.create({ id: sessionId, title: "Test", createdAt: now });

    const message: ChatMessage = {
      id: "m1",
      sessionId,
      role: "user",
      content: "hello",
      createdAt: now,
    };
    await store.appendMessage(message);

    const reloaded = new FileSessionStore(dir);
    expect((await reloaded.get(sessionId))?.title).toBe("Test");
    expect((await reloaded.listMessages(sessionId))[0].content).toBe(
      "hello",
    );
  });
});

describe("FileRunStore", () => {
  it("run / task / artifact 跨实例持久化", async () => {
    const dir = tempDir();
    const store = new FileRunStore(dir);
    await store.createRun({
      id: runId,
      sessionId,
      status: "running",
      startedAt: now,
    });

    const task: TaskRecord = {
      id: taskId,
      runId,
      role: "code",
      description: "implement",
      status: "running",
      routing: "direct",
      dependsOn: [],
      createdAt: now,
      updatedAt: now,
    };
    await store.upsertTask(task);

    const artifact: Artifact = {
      id: "a1",
      runId,
      taskId,
      type: "file_change",
      payload: { path: "a.ts" },
      createdAt: now,
    };
    await store.appendArtifact(artifact);

    const reloaded = new FileRunStore(dir);
    expect((await reloaded.getRun(runId))?.status).toBe("running");
    expect((await reloaded.listTasks(runId))[0].description).toBe(
      "implement",
    );
    expect((await reloaded.listArtifacts(runId))[0].type).toBe(
      "file_change",
    );
  });
});

describe("FileEventLog", () => {
  it("事件追加、回放与 lastSeq", async () => {
    const dir = tempDir();
    const log = new FileEventLog(dir);
    const event = (seq: number): EventEnvelope<SessionEvent> => ({
      v: 1,
      id: `e${seq}`,
      sessionId,
      runId,
      seq,
      ts: now,
      event: { type: "run.aborted", reason: "test" },
    });

    await log.append(event(1));
    await log.append(event(2));

    const reloaded = new FileEventLog(dir);
    expect(await reloaded.lastSeq(sessionId)).toBe(2);
    expect(await reloaded.since(sessionId, 0)).toHaveLength(2);
    expect(await reloaded.since(sessionId, 1)).toHaveLength(1);
  });
});

describe("createFilePorts", () => {
  it("组合文件端口", async () => {
    const dir = tempDir();
    const base = createInMemoryPorts();
    const ports = createFilePorts(dir, base.checkpoints);

    await ports.sessions.create({
      id: sessionId,
      title: "Test",
      createdAt: now,
    });
    expect(await ports.sessions.list()).toHaveLength(1);
  });
});
