/**
 * UserQuestionService 单元测试
 *
 * 覆盖：提问事件、回答、超时与 run 取消时的 resolved 事件
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  asQuestionId,
  asRunId,
  asSessionId,
  asTaskId,
  type SessionEvent,
} from "@code-agent/protocol";
import { UserQuestionService } from "../user-question-service.js";

/** 创建服务并收集发出的会话事件 */
function setup(timeoutMs = 1_000) {
  const events: SessionEvent[] = [];
  let counter = 0;
  const service = new UserQuestionService({
    sessionId: asSessionId("s1"),
    clock: {
      now: () => "2026-10-20T00:00:00.000Z",
      nowMs: () => 1_000,
    },
    ids: { next: (prefix) => `${prefix}_${++counter}` },
    emit: (event) => events.push(event),
    timeoutMs,
  });
  return { service, events };
}

/** 从事件列表取出提问 ID */
function questionIdOf(events: SessionEvent[]): string {
  const required = events.find(
    (event) => event.type === "user.question.required",
  );
  if (!required || required.type !== "user.question.required") {
    throw new Error("no question.required event");
  }
  return required.question.questionId;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("UserQuestionService", () => {
  it("提问后发出 required 事件，回答后发出 resolved 事件", async () => {
    const { service, events } = setup();

    const answer = service.request({
      runId: asRunId("r1"),
      taskId: asTaskId("t1"),
      question: "继续吗？",
      options: ["是", "否"],
    });
    const questionId = questionIdOf(events);

    expect(events[0]).toMatchObject({
      type: "user.question.required",
      question: {
        questionId,
        question: "继续吗？",
        options: ["是", "否"],
      },
    });

    expect(service.answer(asQuestionId(questionId), "是")).toBe(true);
    await expect(answer).resolves.toBe("是");
    expect(events[1]).toMatchObject({
      type: "user.question.resolved",
      questionId,
      answer: "是",
    });
  });

  it("回答未知 questionId 返回 false", () => {
    const { service } = setup();
    expect(service.answer(asQuestionId("q_missing"), "x")).toBe(false);
  });

  it("超时后发出 resolved 事件并 reject", async () => {
    vi.useFakeTimers();
    const { service, events } = setup(500);
    const answer = service.request({
      runId: asRunId("r1"),
      taskId: asTaskId("t1"),
      question: "继续吗？",
    });
    const questionId = questionIdOf(events);

    const assertion = expect(answer).rejects.toThrow("timed out");
    vi.advanceTimersByTime(501);
    await assertion;

    expect(events.at(-1)).toMatchObject({
      type: "user.question.resolved",
      questionId,
      answer: "",
    });
  });

  it("cancelRun 会通知前端并 reject 待回答问题", async () => {
    const { service, events } = setup();
    const answer = service.request({
      runId: asRunId("r1"),
      taskId: asTaskId("t1"),
      question: "继续吗？",
    });
    const questionId = questionIdOf(events);

    expect(service.cancelRun(asRunId("r1"), "run finished")).toBe(1);
    await expect(answer).rejects.toThrow("run finished");

    expect(events.at(-1)).toMatchObject({
      type: "user.question.resolved",
      questionId,
      answer: "",
    });
  });

  it("cancelRun 不影响其他 run 的问题", async () => {
    const { service } = setup();
    const pending = service.request({
      runId: asRunId("r1"),
      taskId: asTaskId("t1"),
      question: "继续吗？",
    });

    expect(service.cancelRun(asRunId("r2"))).toBe(0);
    expect(service.listPending()).toHaveLength(1);

    const assertion = expect(pending).rejects.toThrow("Session disposed");
    service.dispose();
    await assertion;
  });
});
