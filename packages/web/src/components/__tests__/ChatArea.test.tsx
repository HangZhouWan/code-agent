/**
 * ChatArea 组件测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
// 测试
// ---------------------------------------------------------------------------

describe("ChatArea", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
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

  it("有 sessionId 时应渲染 MessageList 和 InputBar", () => {
    render(<ChatArea sessionId="s1" />);

    expect(
      screen.getByText(/Send a message to start the conversation/),
    ).toBeInTheDocument();
    // WebSocket 未连接时 InputBar 处于 disabled 状态，显示 Connecting 文字
    expect(
      screen.getByPlaceholderText(/Connecting/),
    ).toBeInTheDocument();
  });

  it("WebSocket 未连接时 InputBar 应 disabled", () => {
    render(<ChatArea sessionId="s1" />);

    const textarea = screen.getByPlaceholderText(/Connecting/);
    expect(textarea).toBeDisabled();
  });
});
