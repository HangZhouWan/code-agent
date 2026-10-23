/**
 * 恢复、租约与副作用策略测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatModelLike } from "@code-agent/core";
import {
  asCallId,
  asRunId,
  asSessionId,
  asTaskId,
  type ApprovalRequest,
  type TaskRecord,
} from "@code-agent/protocol";
import type {
  AgentCheckpointV1,
  SessionCheckpointV1,
} from "@code-agent/core";
import { createRuntime, type Runtime } from "../factory.js";
import { SessionResumeError } from "../session/agent-session.js";
import { createInMemoryPorts } from "../ports/in-memory.js";

const sessionId = asSessionId("s1");
const runId = asRunId("r1");
const taskId = asTaskId("t1");
const now = "2026-10-19T00:00:00.000Z";

const tempDirs: string[] = [];
const runtimes: Runtime[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-recovery-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.dispose().catch(() => {});
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

class ScriptedModel implements ChatModelLike {
  invocations = 0;

  constructor(private readonly responses: BaseMessage[]) {}

  bindTools(): ChatModelLike {
    return this;
  }

  async invoke(): Promise<BaseMessage> {
    this.invocations++;
    const response = this.responses.shift();
    if (!response) throw new Error("no scripted response left");
    return response;
  }
}

function text(content: string): AIMessage {
  return new AIMessage({ content });
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: taskId,
    runId,
    role: "code",
    description: "resume task",
    status: "running",
    routing: "direct",
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function checkpoint(
  workspacePath: string,
  overrides: Partial<SessionCheckpointV1> = {},
): SessionCheckpointV1 {
  return {
    v: 1,
    sessionId,
    runId,
    status: "running",
    node: "dispatcher",
    workspacePath,
    tasks: [task()],
    completedTaskIds: [],
    pendingTaskIds: [taskId],
    inFlightTaskIds: [taskId],
    artifacts: [],
    messages: [
      {
        id: "m1",
        sessionId,
        role: "user",
        content: "resume me",
        createdAt: now,
      },
    ],
    pendingApprovals: [],
    pendingQuestions: [],
    replanCount: 0,
    nextSeq: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function agentCheckpoint(): AgentCheckpointV1 {
  return {
    v: 1,
    sessionId,
    runId,
    taskId,
    roleId: "code",
    step: 2,
    status: "awaiting_tool",
    messages: [],
    tokenCount: 0,
    toolHistory: [],
    pendingTool: {
      callId: asCallId("c1"),
      name: "file_write",
      args: { path: "a.txt", content: "x" },
      sideEffect: "mutating",
    },
    startedAt: now,
    updatedAt: now,
  };
}

function approval(): ApprovalRequest {
  return {
    callId: asCallId("c1"),
    sessionId,
    runId,
    taskId,
    toolName: "file_write",
    args: {},
    createdAt: now,
    expiresAt: now,
  };
}

describe("AgentSession.resume", () => {
  it("从 checkpoint 继续 dispatcher 并完成 run", async () => {
    const model = new ScriptedModel([text("resumed done"), text("resumed final")]);
    const ports = createInMemoryPorts();
    const workspace = tempDir();
    const runtime = createRuntime({ model }, { ports });
    runtimes.push(runtime);

    const session = await runtime.createSession({
      sessionId,
      workspacePath: workspace,
      title: "Recovery",
      orchestration: true,
      planMode: false,
    });
    await ports.checkpoints.saveSession(checkpoint(workspace));

    const handle = await session.resume();
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(result.finalResponse).toBe("resumed final");

    const snapshot = await session.snapshot();
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0].status).toBe("completed");
    expect(snapshot.tasks[0].result?.summary).toBe("resumed done");

    expect(await ports.checkpoints.loadLatestSession(sessionId)).toBeNull();
  });

  it("run.started 标记 resumed=true", async () => {
    const model = new ScriptedModel([text("done"), text("final")]);
    const ports = createInMemoryPorts();
    const workspace = tempDir();
    const runtime = createRuntime({ model }, { ports });
    runtimes.push(runtime);

    const session = await runtime.createSession({
      sessionId,
      workspacePath: workspace,
      title: "Recovery",
      planMode: false,
    });
    await ports.checkpoints.saveSession(checkpoint(workspace));

    const handle = await session.resume();
    await handle.done;

    let resumed = false;
    for await (const envelope of session.subscribe()) {
      if (envelope.event.type === "run.started") {
        resumed = envelope.event.resumed;
        break;
      }
    }
    expect(resumed).toBe(true);
  });

  it("pending approvals 时拒绝恢复", async () => {
    const model = new ScriptedModel([]);
    const ports = createInMemoryPorts();
    const workspace = tempDir();
    const runtime = createRuntime({ model }, { ports });
    runtimes.push(runtime);

    const session = await runtime.createSession({
      sessionId,
      workspacePath: workspace,
      title: "Recovery",
      planMode: false,
    });
    await ports.checkpoints.saveSession(
      checkpoint(workspace, { pendingApprovals: [approval()] }),
    );

    await expect(session.resume()).rejects.toMatchObject({
      code: "PENDING_INTERACTIONS",
    } satisfies Partial<SessionResumeError>);
  });

  it("mutating pendingTool 标记 RESUME_SIDE_EFFECT_UNCERTAIN", async () => {
    const model = new ScriptedModel([text("uncertain final")]);
    const ports = createInMemoryPorts();
    const workspace = tempDir();
    const runtime = createRuntime({ model }, { ports });
    runtimes.push(runtime);

    const session = await runtime.createSession({
      sessionId,
      workspacePath: workspace,
      title: "Recovery",
      planMode: false,
    });
    await ports.checkpoints.saveSession(checkpoint(workspace));
    await ports.checkpoints.saveAgent(agentCheckpoint());

    const handle = await session.resume();
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(result.finalResponse).toBe("uncertain final");
    const snapshot = await session.snapshot();
    expect(snapshot.tasks[0].result?.error?.code).toBe(
      "RESUME_SIDE_EFFECT_UNCERTAIN",
    );
    expect(model.invocations).toBe(1);
  });
});

describe("Runtime.recoverSessions", () => {
  it("显式恢复未完成 checkpoint", async () => {
    const model = new ScriptedModel([text("recovered task"), text("recovered final")]);
    const ports = createInMemoryPorts();
    const workspace = tempDir();
    const runtime = createRuntime({ model }, { ports });
    runtimes.push(runtime);
    await ports.checkpoints.saveSession(checkpoint(workspace));

    const report = await runtime.recoverSessions();

    expect(report.recovered).toBe(1);
    expect(report.skipped).toBe(0);
    expect(await ports.checkpoints.loadLatestSession(sessionId)).toBeNull();
  });

  it("租约被占用时跳过", async () => {
    const model = new ScriptedModel([]);
    const ports = createInMemoryPorts();
    const workspace = tempDir();
    const runtime = createRuntime({ model }, { ports });
    runtimes.push(runtime);
    await ports.checkpoints.saveSession(checkpoint(workspace));
    await ports.checkpoints.acquireLease(sessionId, "other", 60_000);

    const report = await runtime.recoverSessions();

    expect(report.recovered).toBe(0);
    expect(report.skipped).toBe(1);
    expect(model.invocations).toBe(0);
    await ports.checkpoints.releaseLease(sessionId, "other");
  });

  it("pending interactions 时跳过", async () => {
    const model = new ScriptedModel([]);
    const ports = createInMemoryPorts();
    const workspace = tempDir();
    const runtime = createRuntime({ model }, { ports });
    runtimes.push(runtime);
    await ports.checkpoints.saveSession(
      checkpoint(workspace, { pendingApprovals: [approval()] }),
    );

    const report = await runtime.recoverSessions();

    expect(report.recovered).toBe(0);
    expect(report.skipped).toBe(1);
  });
});
