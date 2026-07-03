/**
 * useWebSocket hook 单元测试
 *
 * 覆盖：
 * - 无 sessionId 时 status 为 disconnected
 * - sessionId 提供后 status → connecting → connected
 * - send 方法发送 JSON 消息
 * - approve 方法发送审批
 * - onMessage 回调在收到消息时触发
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWebSocket } from "../useWebSocket.js";

// ---------------------------------------------------------------------------
// WebSocket Mock（必须使用 class 以满足 vitest mock 要求）
// ---------------------------------------------------------------------------

const sentMessages: string[] = [];
let mockInstance: MockWebSocket | null = null;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    sentMessages.length = 0;
    mockInstance = this;
  }

  send(data: string) {
    sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("useWebSocket", () => {
  beforeEach(() => {
    sentMessages.length = 0;
    mockInstance = null;
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 无 sessionId ──

  it("无 sessionId 时 status 应为 disconnected", () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useWebSocket({ sessionId: null, onMessage }),
    );

    expect(result.current.status).toBe("disconnected");
  });

  // ── 连接生命周期 ──

  it("提供 sessionId 后应发起连接", async () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useWebSocket({ sessionId: "s1", onMessage }),
    );

    expect(result.current.status).toBe("connecting");

    // 模拟连接成功
    await act(async () => {
      mockInstance!.readyState = MockWebSocket.OPEN;
      mockInstance!.onopen?.();
    });

    expect(result.current.status).toBe("connected");
  });

  // ── send ──

  it("send 应发送正确格式的 JSON", async () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useWebSocket({ sessionId: "s1", onMessage }),
    );

    await act(async () => {
      mockInstance!.readyState = MockWebSocket.OPEN;
      mockInstance!.onopen?.();
    });

    act(() => {
      result.current.send("Hello, how are you?");
    });

    expect(sentMessages).toHaveLength(1);
    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed).toEqual({ type: "message", content: "Hello, how are you?" });
  });

  // ── approve ──

  it("approve 应发送审批结果", async () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useWebSocket({ sessionId: "s1", onMessage }),
    );

    await act(async () => {
      mockInstance!.readyState = MockWebSocket.OPEN;
      mockInstance!.onopen?.();
    });

    act(() => {
      result.current.approve("call-1", true);
    });

    expect(sentMessages).toHaveLength(1);
    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed).toEqual({ type: "approval", callId: "call-1", approved: true });
  });

  it("approve 拒绝时应发送 approved: false", async () => {
    const onMessage = vi.fn();
    const { result } = renderHook(() =>
      useWebSocket({ sessionId: "s1", onMessage }),
    );

    await act(async () => {
      mockInstance!.readyState = MockWebSocket.OPEN;
      mockInstance!.onopen?.();
    });

    act(() => {
      result.current.approve("call-1", false);
    });

    const parsed = JSON.parse(sentMessages[0]);
    expect(parsed.approved).toBe(false);
  });

  // ── onMessage ──

  it("收到消息时应触发 onMessage 回调", async () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket({ sessionId: "s1", onMessage }));

    await act(async () => {
      mockInstance!.readyState = MockWebSocket.OPEN;
      mockInstance!.onopen?.();
    });

    await act(async () => {
      mockInstance!.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "text", delta: "Hello" }),
        }),
      );
    });

    expect(onMessage).toHaveBeenCalledWith({ type: "text", delta: "Hello" });
  });

  it("应忽略服务端初始空 delta 消息", async () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket({ sessionId: "s1", onMessage }));

    await act(async () => {
      mockInstance!.readyState = MockWebSocket.OPEN;
      mockInstance!.onopen?.();
    });

    await act(async () => {
      mockInstance!.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "text", delta: "" }),
        }),
      );
    });

    expect(onMessage).not.toHaveBeenCalled();
  });
});
