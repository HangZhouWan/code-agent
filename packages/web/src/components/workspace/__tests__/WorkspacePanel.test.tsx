/**
 * WorkspacePanel 测试
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WorkspacePanel } from "../WorkspacePanel.js";

class FakeWebSocket {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly url: string) {}
  close(): void {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      ({
        ok: true,
        json: async () => ({
          path: ".",
          entries: [
            { name: "src", path: "src", type: "directory" },
            { name: "README.md", path: "README.md", type: "file" },
          ],
        }),
      }) as Response,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorkspacePanel", () => {
  it("支持进入全屏、Esc 退出全屏", async () => {
    render(<WorkspacePanel />);

    await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());
    expect(screen.getByRole("complementary").className).not.toContain(
      "fixed",
    );

    fireEvent.click(screen.getByRole("button", { name: "全屏" }));
    expect(
      screen.getByRole("button", { name: "退出全屏" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("complementary").className).toContain("fixed");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument();
    expect(screen.getByRole("complementary").className).not.toContain(
      "fixed",
    );
  });
});
