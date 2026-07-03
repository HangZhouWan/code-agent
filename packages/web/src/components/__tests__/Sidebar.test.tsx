/**
 * Sidebar 组件测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Sidebar } from "../Sidebar.js";

const MOCK_SESSIONS = [
  { id: "s1", title: "Chat One", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
  { id: "s2", title: "Chat Two", createdAt: "2026-01-03T00:00:00Z", updatedAt: "2026-01-04T00:00:00Z" },
];

describe("Sidebar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("应渲染 New Chat 按钮", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    render(<Sidebar activeSessionId={null} onSelectSession={vi.fn()} />);
    expect(screen.getByText("New Chat")).toBeInTheDocument();
  });

  it("加载中应显示 loading 文字", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );

    render(<Sidebar activeSessionId={null} onSelectSession={vi.fn()} />);
    expect(screen.getByText(/Loading sessions/)).toBeInTheDocument();
  });

  it("空列表应显示引导文字", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    render(<Sidebar activeSessionId={null} onSelectSession={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/No conversations yet/)).toBeInTheDocument();
    });
  });

  it("应渲染会话列表", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_SESSIONS,
    } as Response);

    render(<Sidebar activeSessionId={null} onSelectSession={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Chat One")).toBeInTheDocument();
    });
    expect(screen.getByText("Chat Two")).toBeInTheDocument();
  });

  it("点击会话应触发 onSelectSession", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_SESSIONS,
    } as Response);

    const onSelect = vi.fn();
    render(<Sidebar activeSessionId={null} onSelectSession={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText("Chat One")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Chat One"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("活跃会话应高亮显示", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_SESSIONS,
    } as Response);

    render(<Sidebar activeSessionId="s1" onSelectSession={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Chat One")).toBeInTheDocument();
    });

    const activeBtn = screen.getByText("Chat One").closest("button");
    expect(activeBtn?.className).toContain("bg-gray-700");
  });

  it("点击 New Chat 应调用 API 创建会话", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "new-1",
          title: "New Chat",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        }),
      } as Response);

    const onSelect = vi.fn();
    render(<Sidebar activeSessionId={null} onSelectSession={onSelect} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/)).toBeNull();
    });

    fireEvent.click(screen.getByText("New Chat"));

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("new-1");
    });
  });
});
