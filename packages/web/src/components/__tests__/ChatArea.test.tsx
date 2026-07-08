/**
 * ChatArea 组件测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { ChatArea } from "../ChatArea.js";

// ---------------------------------------------------------------------------
// WebSocket Mock
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }
  send(_data: string) {}
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 创建返回空历史数组的 mock fetch */
function mockFetchEmptyHistory() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }),
  );
}

/** 创建返回指定历史数据的 mock fetch */
function mockFetchHistory(messages: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(messages),
    }),
  );
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("ChatArea", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    mockFetchEmptyHistory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("无 sessionId 时应显示引导页", () => {
    render(<ChatArea sessionId={null} />);
    expect(screen.getByText("My Agent")).toBeInTheDocument();
    expect(
      screen.getByText(/Select a conversation from the sidebar/),
    ).toBeInTheDocument();
  });

  it("有 sessionId 时加载完成后应渲染 MessageList 和 InputBar", async () => {
    render(<ChatArea sessionId="s1" />);

    // 加载完成后显示消息列表
    await waitFor(() => {
      expect(
        screen.getByText(/Send a message to start the conversation/),
      ).toBeInTheDocument();
    });
  });

  it("应该在 sessionId 变化时加载历史消息并显示", async () => {
    mockFetchHistory([
      {
        id: 1,
        sessionId: "s1",
        role: "human",
        content: "Previous question",
        toolName: null,
        toolArgs: null,
        toolResult: null,
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      {
        id: 2,
        sessionId: "s1",
        role: "assistant",
        content: "Previous answer",
        toolName: null,
        toolArgs: null,
        toolResult: null,
        createdAt: "2024-01-01T00:00:01.000Z",
      },
    ]);

    render(<ChatArea sessionId="s1" />);

    // 等待历史消息渲染
    expect(await screen.findByText("Previous question")).toBeInTheDocument();
    expect(await screen.findByText("Previous answer")).toBeInTheDocument();
  });

  it("历史加载失败时不应崩溃", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    render(<ChatArea sessionId="s1" />);

    // 加载完成后应正常显示空消息列表（不崩溃）
    await waitFor(() => {
      expect(
        screen.getByText(/Send a message to start the conversation/),
      ).toBeInTheDocument();
    });
  });
});
