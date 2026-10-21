/**
 * PlanApprovalService 单元测试
 *
 * 覆盖：禁用、批准/拒绝、选择归一化、重复提交、修订重提、run 结束守卫。
 */

import { describe, expect, it } from "vitest";
import {
  asCallId,
  asRunId,
  asSessionId,
  asTaskId,
  type CodeProposal,
  type SessionEvent,
} from "@code-agent/protocol";
import { ApprovalService } from "../../approval/approval-service.js";
import { PlanApprovalService } from "../plan-approval-service.js";

const RUN_ID = asRunId("r1");
const TASK_ID = asTaskId("t1");

/** 构造一个最小方案 */
function proposal(
  id: string,
  overrides: Partial<CodeProposal> = {},
): CodeProposal {
  return {
    id,
    title: `方案 ${id}`,
    summary: `${id} 的说明`,
    files: [{ path: "src/api.ts", changes: ["调整错误处理"] }],
    ...overrides,
  };
}

/** 两个方案，p1 为推荐项 */
function proposals(): CodeProposal[] {
  return [
    proposal("p1", { recommended: true }),
    proposal("p2", { effort: "large" }),
  ];
}

function setup(enabled = true, maxSubmissions = 5) {
  const events: SessionEvent[] = [];
  let counter = 0;
  const approvalService = new ApprovalService({
    sessionId: asSessionId("s1"),
    clock: {
      now: () => "2026-10-20T00:00:00.000Z",
      nowMs: () => 1_000,
    },
    ids: { next: (prefix) => `${prefix}_${++counter}` },
    emit: (event) => events.push(event),
  });
  const service = new PlanApprovalService({
    approvalService,
    enabled,
    timeoutMs: 1_000,
    maxSubmissions,
  });
  service.beginRun(RUN_ID);
  return { service, approvalService, events };
}

/** 取出最近一次计划审批的 callId */
function lastCallId(events: SessionEvent[]): string {
  const required = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "approval.required" && event.request.kind === "plan",
    );
  if (!required || required.type !== "approval.required") {
    throw new Error("no plan approval.required event");
  }
  return required.request.callId;
}

describe("PlanApprovalService", () => {
  it("计划模式关闭时直接返回 rejected，不弹审批", async () => {
    const { service, events } = setup(false);
    const outcome = await service.submit(
      { summary: "关闭", proposals: proposals() },
      { runId: RUN_ID, taskId: TASK_ID },
    );
    expect(outcome).toMatchObject({ status: "rejected", planMode: false });
    expect(events).toHaveLength(0);
    expect(service.isApproved()).toBe(false);
  });

  it("批准选中的方案后打开闸门", async () => {
    const { service, approvalService, events } = setup();
    const pending = service.submit(
      { summary: "方案", proposals: proposals() },
      { runId: RUN_ID, taskId: TASK_ID },
    );

    const callId = lastCallId(events);
    approvalService.resolve(asCallId(callId), {
      decision: "approved",
      selectedProposalIds: ["p2"],
    });

    const outcome = await pending;
    expect(outcome.status).toBe("approved");
    expect(outcome.selectedProposalIds).toEqual(["p2"]);
    expect(outcome.selectedProposals).toEqual([proposals()[1]]);
    expect(service.isApproved()).toBe(true);
    expect(service.context().isApproved()).toBe(true);
    expect(service.selectedProposalIds()).toEqual(["p2"]);

    const resolved = events.find(
      (event) => event.type === "approval.resolved",
    );
    expect(resolved).toMatchObject({
      kind: "plan",
      decision: "approved",
      selectedProposalIds: ["p2"],
    });
  });

  it("未提供选择时回退到推荐方案", async () => {
    const { service, approvalService, events } = setup();
    const pending = service.submit(
      { summary: "方案", proposals: proposals() },
      { runId: RUN_ID, taskId: TASK_ID },
    );
    approvalService.resolve(asCallId(lastCallId(events)), {
      decision: "approved",
    });

    const outcome = await pending;
    expect(outcome.selectedProposalIds).toEqual(["p1"]);
  });

  it("非法选择 ID 被过滤并回退到推荐方案", async () => {
    const { service, approvalService, events } = setup();
    const pending = service.submit(
      { summary: "方案", proposals: proposals() },
      { runId: RUN_ID, taskId: TASK_ID },
    );
    approvalService.resolve(asCallId(lastCallId(events)), {
      decision: "approved",
      selectedProposalIds: ["missing"],
    });

    const outcome = await pending;
    expect(outcome.selectedProposalIds).toEqual(["p1"]);
  });

  it("拒绝后保持只读，重复提交同一方案不会再次弹窗", async () => {
    const { service, approvalService, events } = setup();
    const input = { summary: "方案", proposals: proposals() };
    const pending = service.submit(input, {
      runId: RUN_ID,
      taskId: TASK_ID,
    });
    approvalService.resolve(asCallId(lastCallId(events)), {
      decision: "denied",
      feedback: "风险太高",
    });

    const outcome = await pending;
    expect(outcome).toMatchObject({
      status: "rejected",
      feedback: "风险太高",
    });
    expect(service.isApproved()).toBe(false);
    expect(service.context().isApproved()).toBe(false);

    const repeated = await service.submit(input, {
      runId: RUN_ID,
      taskId: TASK_ID,
    });
    expect(repeated).toMatchObject({
      status: "rejected",
      feedback: "风险太高",
    });
    expect(
      events.filter((event) => event.type === "approval.required"),
    ).toHaveLength(1);
  });

  it("修订后的方案会重新请求审批", async () => {
    const { service, approvalService, events } = setup();
    const first = service.submit(
      { summary: "方案", proposals: proposals() },
      { runId: RUN_ID, taskId: TASK_ID },
    );
    approvalService.resolve(asCallId(lastCallId(events)), {
      decision: "denied",
      feedback: "换一个方案",
    });
    await first;

    const second = service.submit(
      {
        summary: "修订方案",
        proposals: [proposal("p3", { recommended: true })],
      },
      { runId: RUN_ID, taskId: TASK_ID },
    );
    expect(
      events.filter((event) => event.type === "approval.required"),
    ).toHaveLength(2);

    approvalService.resolve(asCallId(lastCallId(events)), {
      decision: "approved",
    });
    const outcome = await second;
    expect(outcome.selectedProposalIds).toEqual(["p3"]);
  });

  it("等待期间重复提交共享同一个 promise", async () => {
    const { service, approvalService, events } = setup();
    const input = { summary: "方案", proposals: proposals() };
    const first = service.submit(input, {
      runId: RUN_ID,
      taskId: TASK_ID,
    });
    const second = service.submit(input, {
      runId: RUN_ID,
      taskId: TASK_ID,
    });
    expect(
      events.filter((event) => event.type === "approval.required"),
    ).toHaveLength(1);

    approvalService.resolve(asCallId(lastCallId(events)), {
      decision: "approved",
    });
    await expect(first).resolves.toMatchObject({ status: "approved" });
    await expect(second).resolves.toMatchObject({ status: "approved" });
  });

  it("run 结束后迟到的结果不会污染下一次运行", async () => {
    const { service, approvalService, events } = setup();
    const pending = service.submit(
      { summary: "方案", proposals: proposals() },
      { runId: RUN_ID, taskId: TASK_ID },
    );
    const callId = lastCallId(events);

    service.endRun(RUN_ID);
    approvalService.resolve(asCallId(callId), {
      decision: "approved",
    });

    const outcome = await pending;
    expect(outcome).toMatchObject({
      status: "rejected",
      feedback: "Run ended before the proposal was approved.",
    });
    expect(service.isApproved()).toBe(false);
  });

  it("超过提交次数上限后拒绝继续修订", async () => {
    const { service, approvalService, events } = setup(true, 1);
    const first = service.submit(
      { summary: "方案", proposals: proposals() },
      { runId: RUN_ID, taskId: TASK_ID },
    );
    approvalService.resolve(asCallId(lastCallId(events)), {
      decision: "denied",
    });
    await first;

    const outcome = await service.submit(
      {
        summary: "修订",
        proposals: [proposal("p3")],
      },
      { runId: RUN_ID, taskId: TASK_ID },
    );
    expect(outcome).toMatchObject({ status: "rejected" });
    expect(outcome.feedback).toContain("Too many");
  });
});
