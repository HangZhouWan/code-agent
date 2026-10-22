/**
 * ToolCallTimeline 测试
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ToolCallState } from "../../stores/chatStore.js";
import { ToolCallTimeline } from "../ToolCallTimeline.js";

/** 构造一条已完成的工具调用 */
function call(
  index: number,
  overrides: Partial<ToolCallState> = {},
): ToolCallState {
  return {
    callId: `c${index}`,
    tool: "file_read",
    args: { path: `file-${index}.ts` },
    status: "done",
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("ToolCallTimeline", () => {
  it("显示调用次数、失败数和关键参数", () => {
    render(
      <ToolCallTimeline
        toolCalls={[
          call(1, {
            tool: "shell_exec",
            args: { command: "pnpm test" },
          }),
          call(2, { status: "error" }),
        ]}
      />,
    );

    expect(screen.getByText("工具调用 · 2 次")).toBeInTheDocument();
    expect(screen.getByText("1 个失败")).toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    expect(screen.getByText("file-2.ts")).toBeInTheDocument();
  });

  it("超过 5 条时默认只显示最近 5 条，可展开全部", () => {
    render(
      <ToolCallTimeline
        toolCalls={Array.from({ length: 7 }, (_, index) => call(index + 1))}
      />,
    );

    expect(screen.queryByText("file-1.ts")).toBeNull();
    expect(screen.queryByText("file-2.ts")).toBeNull();
    expect(screen.getByText("file-3.ts")).toBeInTheDocument();
    expect(screen.getByText("file-7.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByText("还有 2 条更早的调用"));

    expect(screen.getByText("file-1.ts")).toBeInTheDocument();
    expect(screen.getByText("file-2.ts")).toBeInTheDocument();
    expect(screen.getByText("只看最近 5 条")).toBeInTheDocument();
  });

  it("可以收起整组调用", () => {
    render(<ToolCallTimeline toolCalls={[call(1)]} />);

    fireEvent.click(screen.getByText("工具调用 · 1 次"));

    expect(screen.queryByText("file-1.ts")).toBeNull();
  });
});
