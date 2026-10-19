/**
 * MemoryPanel 测试
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  asMemoryId,
  asRunId,
  asSessionId,
  asWorkspaceId,
  type MemoryRecord,
} from "@code-agent/protocol";
import { MemoryPanel } from "../MemoryPanel.js";

const now = "2026-10-19T00:00:00.000Z";

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: asMemoryId("mem-1"),
    workspaceId: asWorkspaceId("ws-1"),
    scope: "workspace",
    kind: "convention",
    content: "项目使用 pnpm",
    tags: ["pnpm"],
    keywords: ["pnpm"],
    confidence: 0.6,
    status: "pending_review",
    source: {
      sessionId: asSessionId("s1"),
      runId: asRunId("r1"),
      messageIds: [],
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
    useCount: 0,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MemoryPanel", () => {
  it("加载待审核记忆并通过审核", async () => {
    const pending = record();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        if (init?.method === "PATCH") {
          return {
            ok: true,
            json: async () => ({ ...pending, status: "active" }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ memories: [pending] }),
        } as Response;
      });

    render(<MemoryPanel onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("项目使用 pnpm")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("通过"));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).includes("/api/memory/mem-1") &&
            (init as RequestInit | undefined)?.method === "PATCH",
        ),
      ).toBe(true);
    });
  });
});
