/**
 * SQLite Runtime 端口测试
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asCallId,
  asRunId,
  asSessionId,
  asTaskId,
  type Artifact,
  type ChatMessage,
  type EventEnvelope,
  type SessionEvent,
  type TaskRecord,
} from "@code-agent/protocol";
import { createServerDatabase, type ServerDb } from "../../db/server-db.js";
import {
  SqliteEventLog,
  SqliteRunStore,
  SqliteSessionStore,
} from "../index.js";

const sessionId = asSessionId("s1");
const runId = asRunId("r1");
const taskId = asTaskId("t1");
const now = "2026-10-19T00:00:00.000Z";

let db: ServerDb;
let sessions: SqliteSessionStore;
let runs: SqliteRunStore;
let events: SqliteEventLog;

beforeEach(async () => {
  db = createServerDatabase(":memory:");
  sessions = new SqliteSessionStore(db);
  runs = new SqliteRunStore(db);
  events = new SqliteEventLog(db);
  await sessions.create({ id: sessionId, title: "Test", createdAt: now });
});

afterEach(() => {
  db.close();
});

describe("SqliteSessionStore", () => {
  it("create / get / list / updateTitle / delete", async () => {
    const session = await sessions.get(sessionId);
    expect(session?.title).toBe("Test");
    expect(await sessions.list()).toHaveLength(1);

    await sessions.updateTitle(sessionId, "Renamed", now);
    expect((await sessions.get(sessionId))?.title).toBe("Renamed");

    await sessions.delete(sessionId);
    expect(await sessions.get(sessionId)).toBeNull();
  });

  it("appendMessage / listMessages 保留 toolCalls 与 toolCallId", async () => {
    const message: ChatMessage = {
      id: "m1",
      sessionId,
      role: "assistant",
      content: "tool call",
      toolCalls: [
        {
          id: asCallId("c1"),
          name: "file_read",
          args: { path: "a.ts" },
          status: "success",
        },
      ],
      createdAt: now,
    };
    await sessions.appendMessage(message);

    const messages = await sessions.listMessages(sessionId);
    expect(messages).toHaveLength(1);
    expect(messages[0].toolCalls?.[0].name).toBe("file_read");
    expect(messages[0].content).toBe("tool call");
  });
});

describe("SqliteRunStore", () => {
  it("run 生命周期与 active run", async () => {
    await runs.createRun({
      id: runId,
      sessionId,
      status: "running",
      startedAt: now,
    });
    expect((await runs.getActiveRun(sessionId))?.id).toBe(runId);

    await runs.updateRun(runId, {
      status: "completed",
      finishedAt: now,
    });
    expect(await runs.getActiveRun(sessionId)).toBeNull();
    expect((await runs.getRun(runId))?.status).toBe("completed");
    expect(await runs.listRuns(sessionId)).toHaveLength(1);
  });

  it("task upsert / list 与 artifact", async () => {
    await runs.createRun({
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
    await runs.upsertTask(task);
    await runs.upsertTask({ ...task, status: "completed" });

    const tasks = await runs.listTasks(runId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("completed");

    const artifact: Artifact = {
      id: "a1",
      runId,
      taskId,
      type: "file_change",
      payload: { path: "a.ts" },
      createdAt: now,
    };
    await runs.appendArtifact(artifact);
    expect(await runs.listArtifacts(runId)).toHaveLength(1);
  });
});

describe("SqliteEventLog", () => {
  it("append / since / lastSeq", async () => {
    const envelope: EventEnvelope<SessionEvent> = {
      v: 1,
      id: "e1",
      sessionId,
      runId,
      seq: 1,
      ts: now,
      event: { type: "run.aborted", reason: "test" },
    };
    await events.append(envelope);

    expect(await events.lastSeq(sessionId)).toBe(1);
    expect(await events.since(sessionId, 0)).toHaveLength(1);
    expect(await events.since(sessionId, 1)).toHaveLength(0);
  });
});
