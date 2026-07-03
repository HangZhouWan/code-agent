/**
 * MessageList 组件测试
 *
 * 覆盖：
 * - 空消息列表显示引导文字
 * - user 消息右对齐渲染
 * - assistant 消息左对齐渲染
 * - 工具调用卡片渲染（ToolCallCard / ConfirmCard）
 * - onApprove 传递给 ConfirmCard
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageList } from "../MessageList.js";
import type { Message } from "../../stores/chatStore.js";

describe("MessageList", () => {
  it("空消息列表应显示引导文字", () => {
    render(<MessageList messages={[]} onApprove={vi.fn()} />);
    expect(
      screen.getByText(/Send a message to start the conversation/),
    ).toBeInTheDocument();
  });

  it("应渲染 user 消息", () => {
    const msgs: Message[] = [
      {
        id: "u1",
        role: "user",
        content: "Hello from user",
        isStreaming: false,
        toolCalls: [],
      },
    ];
    render(<MessageList messages={msgs} onApprove={vi.fn()} />);
    expect(screen.getByText("Hello from user")).toBeInTheDocument();
  });

  it("应渲染 assistant 消息（Markdown）", () => {
    const msgs: Message[] = [
      {
        id: "a1",
        role: "assistant",
        content: "Hello **world**",
        isStreaming: false,
        toolCalls: [],
      },
    ];
    render(<MessageList messages={msgs} onApprove={vi.fn()} />);
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("应渲染多条消息", () => {
    const msgs: Message[] = [
      {
        id: "u1",
        role: "user",
        content: "Q1",
        isStreaming: false,
        toolCalls: [],
      },
      {
        id: "a1",
        role: "assistant",
        content: "A1",
        isStreaming: false,
        toolCalls: [],
      },
      {
        id: "u2",
        role: "user",
        content: "Q2",
        isStreaming: false,
        toolCalls: [],
      },
    ];
    render(<MessageList messages={msgs} onApprove={vi.fn()} />);
    expect(screen.getByText("Q1")).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("Q2")).toBeInTheDocument();
  });

  it("应渲染工具调用卡片（running 状态）", () => {
    const msgs: Message[] = [
      {
        id: "a1",
        role: "assistant",
        content: "Let me check...",
        isStreaming: true,
        toolCalls: [
          { tool: "read_file", args: {}, status: "running" },
        ],
      },
    ];
    render(<MessageList messages={msgs} onApprove={vi.fn()} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("应渲染审批卡片（awaiting_approval 状态）", () => {
    const onApprove = vi.fn();
    const msgs: Message[] = [
      {
        id: "a1",
        role: "assistant",
        content: "Should I delete this?",
        isStreaming: true,
        toolCalls: [
          {
            tool: "delete_file",
            args: { path: "/x" },
            status: "awaiting_approval",
            callId: "c1",
          },
        ],
      },
    ];
    render(<MessageList messages={msgs} onApprove={onApprove} />);

    expect(screen.getByText(/Confirm Action/)).toBeInTheDocument();
    expect(screen.getByText("delete_file")).toBeInTheDocument();

    // 点击 Approve 应触发 onApprove
    fireEvent.click(screen.getByText(/Approve/));
    expect(onApprove).toHaveBeenCalledWith("c1", true);
  });
});
