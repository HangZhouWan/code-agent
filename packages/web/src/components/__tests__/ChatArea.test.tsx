/**
 * ChatArea 组件测试
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  act,
  fireEvent,
} from "@testing-library/react";
import { ChatArea } from "../ChatArea.js";

// ---------------------------------------------------------------------------
// WebSocket Mock
// ---------------------------------------------------------------------------

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  /** 模拟服务端推送一条 WS 消息 */
  receive(message: unknown) {
    this.onmessage?.({
      data: JSON.stringify(message),
    } as MessageEvent);
  }
}

/** 获取最近创建的 WebSocket 实例 */
function latestSocket(): MockWebSocket {
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!socket) throw new Error("no websocket created");
  return socket;
}

/** 构造服务端事件信封 */
function eventMessage(seq: number, event: Record<string, unknown>) {
  return {
    type: "event",
    event: {
      v: 1,
      id: `evt-${seq}`,
      sessionId: "s1",
      runId: "run-1",
      seq,
      ts: "2024-01-01T00:00:00.000Z",
      event,
    },
  };
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
    MockWebSocket.instances = [];
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

  it("重放已持久化的 message.completed 时不应产生重复消息", async () => {
    mockFetchHistory([
      {
        id: "msg-1",
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
    await screen.findByText("Previous answer");

    // 服务端连接后会从 seq 0 重放历史事件
    act(() => {
      latestSocket().receive(
        eventMessage(1, {
          type: "message.completed",
          message: {
            id: "msg-1",
            sessionId: "s1",
            role: "assistant",
            content: "Previous answer",
            createdAt: "2024-01-01T00:00:01.000Z",
          },
        }),
      );
    });

    expect(screen.getAllByText("Previous answer")).toHaveLength(1);
  });

  it("运行中 Send 按钮应变为 Stop，点击后发送 abort", async () => {
    render(<ChatArea sessionId="s1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Send a message to start the conversation/),
      ).toBeInTheDocument();
    });

    const socket = latestSocket();
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });

    fireEvent.change(screen.getByPlaceholderText(/Type a message/), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByText("Send"));

    expect(screen.getByText("Stop")).toBeInTheDocument();
    expect(screen.queryByText("Send")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Stop"));

    expect(socket.sent.map((data) => JSON.parse(data))).toContainEqual({
      type: "abort",
      reason: "用户停止",
    });

    // 服务端确认中断后恢复 Send 按钮
    act(() => {
      socket.receive(
        eventMessage(1, { type: "run.aborted", reason: "用户停止" }),
      );
    });

    expect(screen.queryByText("Stop")).not.toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("点击 Approve 应提交审批 ID，approval.resolved 后移除确认卡片", async () => {
    render(<ChatArea sessionId="s1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Send a message to start the conversation/),
      ).toBeInTheDocument();
    });

    const socket = latestSocket();
    act(() => {
      socket.readyState = MockWebSocket.OPEN;
      socket.onopen?.();
    });
    fireEvent.change(screen.getByPlaceholderText(/Type a message/), {
      target: { value: "delete it" },
    });
    fireEvent.click(screen.getByText("Send"));

    // tool.started 携带 LLM 工具调用 ID，approval.required 携带审批 ID，两者不同
    act(() => {
      socket.receive(
        eventMessage(1, {
          type: "tool.started",
          callId: "llm-call-1",
          toolName: "delete_file",
          args: { path: "/tmp/x" },
        }),
      );
      socket.receive(
        eventMessage(2, {
          type: "approval.required",
          request: {
            callId: "call-approval-1",
            sessionId: "s1",
            runId: "run-1",
            taskId: "task-1",
            toolName: "delete_file",
            args: { path: "/tmp/x" },
            createdAt: "2024-01-01T00:00:00.000Z",
            expiresAt: "2024-01-01T00:02:00.000Z",
          },
        }),
      );
    });

    expect(screen.getByText(/Confirm Action:/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("✅ Approve"));

    expect(socket.sent.map((data) => JSON.parse(data))).toContainEqual({
      type: "approval",
      callId: "call-approval-1",
      approved: true,
    });

    act(() => {
      socket.receive(
        eventMessage(3, {
          type: "approval.resolved",
          callId: "call-approval-1",
          decision: "approved",
        }),
      );
    });

    expect(screen.queryByText(/Confirm Action:/)).not.toBeInTheDocument();
  });
});
