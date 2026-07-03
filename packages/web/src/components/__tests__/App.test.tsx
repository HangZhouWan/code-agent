/**
 * App 根组件冒烟测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { App } from "../../App.js";

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("应渲染 Sidebar（含 New Chat 按钮）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("New Chat")).toBeInTheDocument();
    });
  });

  it("应渲染 ChatArea 引导页（无活跃会话）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    render(<App />);

    // 使用 getAllByText 因为 ChatArea 和可能的其他元素都可能包含 "My Agent"
    const headings = screen.getAllByText("My Agent");
    expect(headings.length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Select a conversation from the sidebar/),
    ).toBeInTheDocument();
  });
});
