/**
 * PlanApprovalCard 测试
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CodeProposal } from "@code-agent/protocol";
import { PlanApprovalCard } from "../PlanApprovalCard.js";

const proposals: CodeProposal[] = [
  {
    id: "p1",
    title: "集中错误映射",
    summary: "在 api.ts 中统一处理错误",
    files: [{ path: "src/api.ts", changes: ["增加错误映射函数"] }],
    rationale: "减少重复代码",
    risks: "需要同步更新调用方",
    effort: "small",
    recommended: true,
  },
  {
    id: "p2",
    title: "只改调用方",
    summary: "在每个调用点补充处理",
    files: [{ path: "src/caller.ts", changes: ["补充 try/catch"] }],
  },
];

afterEach(() => {
  cleanup();
});

describe("PlanApprovalCard", () => {
  it("默认选中推荐方案，可调整多选并批准", () => {
    const onApprove = vi.fn();
    render(
      <PlanApprovalCard
        callId="plan-1"
        summary="发现两处可改进"
        proposals={proposals}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("发现两处可改进")).toBeInTheDocument();
    expect(screen.getByText("集中错误映射")).toBeInTheDocument();
    expect(screen.getByText("src/api.ts")).toBeInTheDocument();
    expect(screen.getByText("推荐")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();

    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByText("批准并执行"));

    expect(onApprove).toHaveBeenCalledWith("plan-1", ["p1", "p2"]);
  });

  it("没有推荐方案时默认选中第一个", () => {
    const onApprove = vi.fn();
    render(
      <PlanApprovalCard
        callId="plan-2"
        summary="方案"
        proposals={proposals.map(({ recommended: _recommended, ...p }) => p)}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("批准并执行"));
    expect(onApprove).toHaveBeenCalledWith("plan-2", ["p1"]);
  });

  it("拒绝时携带反馈", () => {
    const onReject = vi.fn();
    render(
      <PlanApprovalCard
        callId="plan-3"
        summary="方案"
        proposals={proposals}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/拒绝时说明原因/), {
      target: { value: "风险太高" },
    });
    fireEvent.click(screen.getByText("拒绝并反馈"));

    expect(onReject).toHaveBeenCalledWith("plan-3", "风险太高");
  });

  it("未选择方案时禁用批准按钮", () => {
    render(
      <PlanApprovalCard
        callId="plan-4"
        summary="方案"
        proposals={proposals}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    // 取消推荐方案的勾选
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("批准并执行")).toBeDisabled();
  });

  it("disabled 时两个按钮都不可用", () => {
    render(
      <PlanApprovalCard
        callId="plan-5"
        summary="方案"
        proposals={proposals}
        disabled
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("批准并执行")).toBeDisabled();
    expect(screen.getByText("拒绝并反馈")).toBeDisabled();
  });
});
