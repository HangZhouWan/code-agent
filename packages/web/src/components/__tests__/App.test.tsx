/**
 * App 根组件冒烟测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { App } from "../../App.js";

/**
 * 按 URL 返回不同响应：配置状态接口必须返回已配置，
 * 否则 App 会渲染 SetupPage，聊天界面不会挂载。
 */
function mockApi(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("/api/config/status")) {
      return {
        ok: true,
        json: async () => ({ setupRequired: false }),
      } as Response;
    }

    return {
      ok: true,
      json: async () => [],
    } as Response;
  });
}

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("应渲染 Sidebar（含 New Chat 按钮）", async () => {
    mockApi();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("New Chat")).toBeInTheDocument();
    });
  });

  it("应渲染 ChatArea 引导页（无活跃会话）", async () => {
    mockApi();

    render(<App />);

    await waitFor(() => {
      // 使用 getAllByText 因为 ChatArea 和可能的其他元素都可能包含 "My Agent"
      const headings = screen.getAllByText("My Agent");
      expect(headings.length).toBeGreaterThan(0);
      expect(
        screen.getByText(/Select a conversation from the sidebar/),
      ).toBeInTheDocument();
    });
  });
});
