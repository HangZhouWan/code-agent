/**
 * ConfirmCard 组件测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConfirmCard } from "../ConfirmCard.js";
import type { ToolCallState } from "../../stores/chatStore.js";

const BASE_TC: ToolCallState = {
  tool: "delete_file",
  args: { path: "/tmp/important.txt", reason: "cleanup" },
  status: "awaiting_approval",
  callId: "call-123",
};

describe("ConfirmCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("应显示 Confirm Action 标题和工具名称", () => {
    render(<ConfirmCard toolCall={BASE_TC} onApprove={vi.fn()} />);
    expect(screen.getByText(/Confirm Action/)).toBeInTheDocument();
    // 在标题 span 内找到工具名称
    expect(screen.getByText("delete_file")).toBeInTheDocument();
  });

  it("应显示格式化的参数", () => {
    render(<ConfirmCard toolCall={BASE_TC} onApprove={vi.fn()} />);
    // 参数在 <pre> 中展示
    expect(screen.getByText(/"path"/)).toBeInTheDocument();
    expect(screen.getByText(/"cleanup"/)).toBeInTheDocument();
  });

  it("点击 Approve 应调用 onApprove(callId, true)", () => {
    const onApprove = vi.fn();
    render(<ConfirmCard toolCall={BASE_TC} onApprove={onApprove} />);

    fireEvent.click(screen.getByText("✅ Approve"));
    expect(onApprove).toHaveBeenCalledWith("call-123", true);
  });

  it("点击 Deny 应调用 onApprove(callId, false)", () => {
    const onApprove = vi.fn();
    render(<ConfirmCard toolCall={BASE_TC} onApprove={onApprove} />);

    fireEvent.click(screen.getByText("❌ Deny"));
    expect(onApprove).toHaveBeenCalledWith("call-123", false);
  });

  it("存在 approvalId 时应优先提交 approvalId（而非 LLM callId）", () => {
    const onApprove = vi.fn();
    const tc: ToolCallState = {
      ...BASE_TC,
      callId: "llm-call-abc",
      approvalId: "call-approval-1",
    };
    render(<ConfirmCard toolCall={tc} onApprove={onApprove} />);

    fireEvent.click(screen.getByText("✅ Approve"));
    expect(onApprove).toHaveBeenCalledWith("call-approval-1", true);

    fireEvent.click(screen.getByText("❌ Deny"));
    expect(onApprove).toHaveBeenLastCalledWith("call-approval-1", false);
  });

  it("disabled 时按钮应不可用", () => {
    const onApprove = vi.fn();
    render(
      <ConfirmCard toolCall={BASE_TC} onApprove={onApprove} disabled />,
    );

    const approveBtn = screen.getByText("✅ Approve");
    const denyBtn = screen.getByText("❌ Deny");

    expect(approveBtn).toBeDisabled();
    expect(denyBtn).toBeDisabled();
  });

  it("无 callId / approvalId 时点击不应崩溃", () => {
    const onApprove = vi.fn();
    const tc: ToolCallState = {
      ...BASE_TC,
      callId: undefined,
      approvalId: undefined,
    };
    render(<ConfirmCard toolCall={tc} onApprove={onApprove} />);

    // 不应抛出错误
    fireEvent.click(screen.getByText("✅ Approve"));
    expect(onApprove).not.toHaveBeenCalled();
  });
});
