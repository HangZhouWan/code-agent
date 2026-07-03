/**
 * ToolCallCard 组件测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToolCallCard } from "../ToolCallCard.js";
import type { ToolCallState } from "../../stores/chatStore.js";

describe("ToolCallCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("应显示工具名称和 running 状态", () => {
    const tc: ToolCallState = {
      tool: "read_file",
      args: { path: "/tmp/test" },
      status: "running",
    };
    render(<ToolCallCard toolCall={tc} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("应显示工具名称和 done 状态", () => {
    const tc: ToolCallState = {
      tool: "write_file",
      args: { path: "/a" },
      status: "done",
      result: "File written",
    };
    render(<ToolCallCard toolCall={tc} />);
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("应显示工具名称和 error 状态", () => {
    const tc: ToolCallState = {
      tool: "run_command",
      args: { cmd: "ls" },
      status: "error",
      result: "Permission denied",
    };
    render(<ToolCallCard toolCall={tc} />);
    expect(screen.getByText("run_command")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("应显示 awaiting_approval 状态", () => {
    const tc: ToolCallState = {
      tool: "delete_file",
      args: { path: "/important" },
      status: "awaiting_approval",
      callId: "c1",
    };
    render(<ToolCallCard toolCall={tc} />);
    expect(screen.getByText("Awaiting Approval")).toBeInTheDocument();
  });

  it("点击应展开详情（Arguments 和 Result）", () => {
    const tc: ToolCallState = {
      tool: "read_file",
      args: { path: "/tmp/test" },
      status: "done",
      result: "content here",
    };
    render(<ToolCallCard toolCall={tc} />);

    // 初始未展开
    expect(screen.queryByText("Arguments")).toBeNull();

    // 点击展开
    fireEvent.click(screen.getByText("read_file"));
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("再次点击应折叠", () => {
    const tc: ToolCallState = {
      tool: "read_file",
      args: {},
      status: "running",
    };
    render(<ToolCallCard toolCall={tc} />);

    const btn = screen.getByText("read_file");
    fireEvent.click(btn);
    expect(screen.getByText("Arguments")).toBeInTheDocument();

    fireEvent.click(btn);
    expect(screen.queryByText("Arguments")).toBeNull();
  });
});
