/**
 * CLI 事件渲染测试
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asCallId,
  asQuestionId,
  asRunId,
  asSessionId,
  asTaskId,
  type EventEnvelope,
  type RunResult,
  type SessionEvent,
} from "@code-agent/protocol";
import type { AgentSession, RunHandle } from "@code-agent/runtime";
import { consumeRun } from "../run.js";

const runId = asRunId("r1");
const sessionId = asSessionId("s1");
const taskId = asTaskId("t1");
const now = "2026-10-19T00:00:00.000Z";

function envelope(
  seq: number,
  event: SessionEvent,
): EventEnvelope<SessionEvent> {
  return {
    v: 1,
    id: `e${seq}`,
    sessionId,
    runId,
    seq,
    ts: now,
    event,
  };
}

function handle(
  events: SessionEvent[],
  result: RunResult,
): RunHandle {
  async function* stream() {
    for (let i = 0; i < events.length; i++) {
      yield envelope(i + 1, events[i]);
    }
  }
  return {
    runId,
    events: stream(),
    done: Promise.resolve(result),
    abort: () => {},
  };
}

const completed: RunResult = {
  runId,
  sessionId,
  status: "completed",
  finalResponse: "final answer",
  taskResults: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumeRun", () => {
  it("非交互模式自动拒绝审批并回答空字符串", async () => {
    const approve = vi.fn(() => true);
    const answer = vi.fn(() => true);
    const session = { approve, answer } as unknown as AgentSession;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await consumeRun(
      session,
      handle(
        [
          {
            type: "tool.started",
            callId: asCallId("c1"),
            runId,
            taskId,
            toolName: "file_write",
            args: { path: "a.txt" },
          },
          {
            type: "approval.required",
            request: {
              callId: asCallId("c1"),
              sessionId,
              runId,
              taskId,
              toolName: "file_write",
              args: { path: "a.txt" },
              createdAt: now,
              expiresAt: now,
            },
          },
          {
            type: "user.question.required",
            question: {
              questionId: asQuestionId("q1"),
              sessionId,
              runId,
              taskId,
              question: "continue?",
              allowFreeText: true,
              createdAt: now,
              expiresAt: now,
            },
          },
          {
            type: "message.completed",
            message: {
              id: "m1",
              sessionId,
              role: "assistant",
              content: "done",
              createdAt: now,
            },
          },
          { type: "run.completed", result: completed },
        ],
        completed,
      ),
      { interactive: false },
    );

    expect(approve).toHaveBeenCalledWith(asCallId("c1"), "denied");
    expect(answer).toHaveBeenCalledWith(asQuestionId("q1"), "");
  });

  it("交互模式使用用户回答", async () => {
    const approve = vi.fn(() => true);
    const answer = vi.fn(() => true);
    const session = { approve, answer } as unknown as AgentSession;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const responses = ["yes", "continue"];
    await consumeRun(
      session,
      handle(
        [
          {
            type: "approval.required",
            request: {
              callId: asCallId("c1"),
              sessionId,
              runId,
              taskId,
              toolName: "shell_exec",
              args: {},
              createdAt: now,
              expiresAt: now,
            },
          },
          {
            type: "user.question.required",
            question: {
              questionId: asQuestionId("q1"),
              sessionId,
              runId,
              taskId,
              question: "continue?",
              allowFreeText: true,
              createdAt: now,
              expiresAt: now,
            },
          },
          { type: "run.completed", result: completed },
        ],
        completed,
      ),
      {
        interactive: true,
        ask: async () => responses.shift() ?? "",
      },
    );

    expect(approve).toHaveBeenCalledWith(asCallId("c1"), "approved");
    expect(answer).toHaveBeenCalledWith(asQuestionId("q1"), "continue");
  });
});
