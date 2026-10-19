/**
 * 类型化 Event Bus 测试
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  asRunId,
  asSessionId,
  asTaskId,
  type TaskResult,
} from "@code-agent/protocol";
import { SessionEventBus } from "../in-memory-bus.js";
import { BusError } from "../types.js";

const sessionId = asSessionId("s1");
const runId = asRunId("r1");
const taskId = asTaskId("t1");
const now = "2026-10-19T00:00:00.000Z";

function taskResult(summary: string): TaskResult {
  return { taskId, role: "code", status: "success", summary };
}

function commandPayload() {
  return {
    task: { id: taskId, role: "code", description: "implement" },
    context: "context",
    runId,
    taskId,
  };
}

const buses: SessionEventBus[] = [];

function makeBus(timeoutMs = 100): SessionEventBus {
  let id = 0;
  const bus = new SessionEventBus({
    sessionId,
    clock: () => now,
    idGenerator: (prefix) => `${prefix}_${++id}`,
    defaultTimeoutMs: timeoutMs,
    onError: () => {},
  });
  buses.push(bus);
  return bus;
}

afterEach(() => {
  for (const bus of buses.splice(0)) bus.dispose();
});

describe("event publish / subscribe", () => {
  it("精确订阅收到事件", async () => {
    const bus = makeBus();
    const received: string[] = [];
    bus.subscribe("agent.event.task.started", (envelope) => {
      received.push(envelope.payload.taskId);
    });

    await bus.publish("agent.event.task.started", {
      runId,
      taskId,
      role: "code",
      startedAt: now,
    });
    await Promise.resolve();

    expect(received).toEqual([taskId]);
  });

  it("pattern 订阅收到匹配事件", async () => {
    const bus = makeBus();
    const topics: string[] = [];
    bus.subscribePattern("agent.event.task.*", (envelope) => {
      topics.push(envelope.topic);
    });

    await bus.publish("agent.event.task.started", {
      runId,
      taskId,
      role: "code",
      startedAt: now,
    });
    await bus.publish("agent.event.checkpoint.saved", {
      checkpointId: "c1",
      scope: "agent",
    });
    await Promise.resolve();

    expect(topics).toEqual(["agent.event.task.started"]);
  });

  it("发布不等待慢 handler", async () => {
    const bus = makeBus();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let finished = false;
    bus.subscribe("agent.event.task.started", async () => {
      await gate;
      finished = true;
    });

    await bus.publish("agent.event.task.started", {
      runId,
      taskId,
      role: "code",
      startedAt: now,
    });

    expect(finished).toBe(false);
    release();
    await gate;
    await Promise.resolve();
    expect(finished).toBe(true);
  });

  it("unsubscribe 后不再收到事件", async () => {
    const bus = makeBus();
    let count = 0;
    const unsubscribe = bus.subscribe("agent.event.task.started", () => {
      count++;
    });
    unsubscribe();

    await bus.publish("agent.event.task.started", {
      runId,
      taskId,
      role: "code",
      startedAt: now,
    });
    await Promise.resolve();

    expect(count).toBe(0);
  });
});

describe("command request / exclusive delivery", () => {
  it("同一 group 内的 handler 轮询独占投递", async () => {
    const bus = makeBus();
    bus.subscribeExclusive("agent.command.code", "code", async () =>
      taskResult("A"),
    );
    bus.subscribeExclusive("agent.command.code", "code", async () =>
      taskResult("B"),
    );

    const first = await bus.request("agent.command.code", commandPayload());
    const second = await bus.request("agent.command.code", commandPayload());
    const third = await bus.request("agent.command.code", commandPayload());

    expect([first.summary, second.summary, third.summary]).toEqual([
      "A",
      "B",
      "A",
    ]);
  });

  it("handler 异常时 request reject 为 TOOL_FAILED", async () => {
    const bus = makeBus();
    bus.subscribeExclusive("agent.command.code", "code", async () => {
      throw new Error("boom");
    });

    await expect(
      bus.request("agent.command.code", commandPayload()),
    ).rejects.toMatchObject({
      serialized: { code: "TOOL_FAILED", message: "boom" },
    });
  });

  it("没有订阅者时返回 BUS_NO_SUBSCRIBER", async () => {
    const bus = makeBus();
    await expect(
      bus.request("agent.command.code", commandPayload()),
    ).rejects.toMatchObject({
      serialized: { code: "BUS_NO_SUBSCRIBER" },
    });
  });

  it("超时返回 BUS_TIMEOUT", async () => {
    const bus = makeBus(10);
    bus.subscribeExclusive(
      "agent.command.code",
      "code",
      () => new Promise<TaskResult>(() => {}),
    );

    await expect(
      bus.request("agent.command.code", commandPayload()),
    ).rejects.toMatchObject({
      serialized: { code: "BUS_TIMEOUT" },
    });
  });

  it("abort 返回 ABORTED", async () => {
    const bus = makeBus();
    bus.subscribeExclusive(
      "agent.command.code",
      "code",
      () => new Promise<TaskResult>(() => {}),
    );

    const controller = new AbortController();
    const pending = bus.request("agent.command.code", commandPayload(), {
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      serialized: { code: "ABORTED" },
    });
  });

  it("metadata 注入到 envelope", async () => {
    const bus = makeBus();
    let meta: unknown;
    bus.subscribeExclusive("agent.command.code", "code", (envelope) => {
      meta = envelope.meta;
      return taskResult("ok");
    });

    await bus.request("agent.command.code", commandPayload(), {
      metadata: { taskId, runId },
    });

    expect(meta).toMatchObject({
      sessionId,
      runId,
      taskId,
      schemaVersion: 1,
      timestamp: now,
    });
  });

  it("dispose 拒绝所有 pending request", async () => {
    const bus = makeBus();
    bus.subscribeExclusive(
      "agent.command.code",
      "code",
      () => new Promise<TaskResult>(() => {}),
    );

    const pending = bus.request("agent.command.code", commandPayload());
    bus.dispose();

    await expect(pending).rejects.toBeInstanceOf(BusError);
  });
});
