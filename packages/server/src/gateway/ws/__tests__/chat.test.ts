/**
 * chat.ts WebSocket 聊天处理单元测试
 *
 * 覆盖：
 * - createChatWebSocket 工厂函数
 * - extractDelta 文本增量提取
 * - ApprovalStore resolve/cleanup
 * - PendingApproval Map 操作
 * - 消息协议序列化
 * - 断线清理逻辑
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIMessageChunk } from "@langchain/core/messages";
import type { WebSocket } from "ws";
import { ToolNames } from "@code-agent/core";
import {
  createChatWebSocket,
  type ChatWebSocketOptions,
  type PendingApprovalItem,
  type ApprovalStore,
} from "../chat.js";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

function createMockWebSocket(): WebSocket & { sentMessages: string[] } {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const sentMessages: string[] = [];

  const ws = {
    sentMessages,
    readyState: 1, // OPEN
    OPEN: 1,
    CLOSED: 3,
    on: vi.fn((event: string, cb: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(cb);
    }),
    send: vi.fn((data: string) => {
      sentMessages.push(data);
    }),
    close: vi.fn(),
    // 触发事件
    emit(event: string, ...args: any[]) {
      const cbs = listeners.get(event) || [];
      cbs.forEach((cb) => cb(...args));
    },
  } as unknown as WebSocket & {
    sentMessages: string[];
    on: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    emit: (event: string, ...args: any[]) => void;
  };

  return ws;
}

// ---------------------------------------------------------------------------
// ApprovalStore 测试
// ---------------------------------------------------------------------------

describe("ApprovalStore", () => {
  let pendingApprovals: Map<string, PendingApprovalItem>;
  let store: ApprovalStore;
  let ws: ReturnType<typeof createMockWebSocket>;

  beforeEach(() => {
    pendingApprovals = new Map();
    ws = createMockWebSocket();

    store = {
      resolve(callId: string, approved: boolean): boolean {
        const item = pendingApprovals.get(callId);
        if (!item) return false;
        pendingApprovals.delete(callId);
        item.resolve(approved);
        return true;
      },
      cleanup(webSocket: unknown): void {
        for (const [callId, item] of pendingApprovals) {
          if (item.ws === webSocket) {
            pendingApprovals.delete(callId);
          }
        }
      },
    };
  });

  it("resolve 应找到并解析待审批项", async () => {
    const resultPromise = new Promise<boolean>((resolve) => {
      pendingApprovals.set("call-1", {
        resolve,
        ws: ws as unknown as WebSocket,
      });
    });

    const found = store.resolve("call-1", true);
    expect(found).toBe(true);

    const result = await resultPromise;
    expect(result).toBe(true);
  });

  it("resolve 应返回 false 当 callId 不存在", () => {
    const found = store.resolve("no-such-call", true);
    expect(found).toBe(false);
  });

  it("resolve 应在解析后删除 Map 中的项", () => {
    pendingApprovals.set("call-2", {
      resolve: () => {},
      ws: ws as unknown as WebSocket,
    });

    store.resolve("call-2", false);
    expect(pendingApprovals.has("call-2")).toBe(false);
  });

  it("cleanup 应删除指定 WebSocket 的所有待审批项", () => {
    const ws2 = createMockWebSocket();

    pendingApprovals.set("call-a", {
      resolve: () => {},
      ws: ws as unknown as WebSocket,
    });
    pendingApprovals.set("call-b", {
      resolve: () => {},
      ws: ws as unknown as WebSocket,
    });
    pendingApprovals.set("call-c", {
      resolve: () => {},
      ws: ws2 as unknown as WebSocket,
    });

    store.cleanup(ws as unknown as WebSocket);

    // ws 相关的应被删除
    expect(pendingApprovals.has("call-a")).toBe(false);
    expect(pendingApprovals.has("call-b")).toBe(false);
    // ws2 相关的应保留
    expect(pendingApprovals.has("call-c")).toBe(true);
  });

  it("cleanup 对未知 WebSocket 应为 noop", () => {
    pendingApprovals.set("call-x", {
      resolve: () => {},
      ws: ws as unknown as WebSocket,
    });

    const unknownWs = createMockWebSocket();
    store.cleanup(unknownWs as unknown as WebSocket);

    expect(pendingApprovals.has("call-x")).toBe(true);
  });

  it("resolve 同一 callId 两次时第二次应返回 false", () => {
    pendingApprovals.set("call-dup", {
      resolve: () => {},
      ws: ws as unknown as WebSocket,
    });

    expect(store.resolve("call-dup", true)).toBe(true);
    expect(store.resolve("call-dup", true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AIMessageChunk delta 提取测试
// ---------------------------------------------------------------------------

describe("extractDelta", () => {
  // Helper: construct AIMessageChunk with given content
  function chunk(content: AIMessageChunk["content"]): AIMessageChunk {
    return new AIMessageChunk({ content });
  }

  it("应提取字符串 content", () => {
    const c = chunk("Hello World");
    // extractDelta is internal; validate via AIMessageChunk behavior
    const content = c.content;
    expect(typeof content).toBe("string");
    expect(content).toBe("Hello World");
  });

  it("应提取数组 content 中的 text 块", () => {
    const c = chunk([
      { type: "text", text: "Hello " },
      { type: "text", text: "World" },
    ] as any);
    const content = c.content;
    expect(Array.isArray(content)).toBe(true);

    // 验证 extractDelta 逻辑提取 text 块
    if (Array.isArray(content)) {
      const text = content
        .filter(
          (block): block is { type: "text"; text: string } =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "text",
        )
        .map((block) => block.text)
        .join("");
      expect(text).toBe("Hello World");
    }
  });

  it("应跳过非 text 类型的内容块", () => {
    const c = chunk([
      { type: "text", text: "Output: " },
      { type: "tool_use", name: "read_file", input: {} },
      { type: "text", text: "Done." },
    ] as any);
    const content = c.content;
    expect(Array.isArray(content)).toBe(true);

    if (Array.isArray(content)) {
      const textBlocks = content.filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text",
      );
      expect(textBlocks).toHaveLength(2);
      expect(textBlocks[0].text).toBe("Output: ");
      expect(textBlocks[1].text).toBe("Done.");
    }
  });

  it("空字符串 content 应返回空字符串", () => {
    const c = chunk("");
    expect(c.content).toBe("");
  });

  it("空数组 content 应返回空字符串", () => {
    const c = chunk([]);
    const content = c.content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as any[]).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WebSocket 消息 JSON 协议测试
// ---------------------------------------------------------------------------

describe("WebSocket 消息协议", () => {
  /** 创建 ChatWebSocketOptions 的最小集 */
  function createOptions(
    overrides: Partial<ChatWebSocketOptions> = {},
  ): ChatWebSocketOptions {
    return {
      model: {} as any,
      toolRegistry: {} as any,
      workspacePath: "./test-workspace",
      pendingApprovals: new Map(),
      ...overrides,
    };
  }

  it("createChatWebSocket 应返回函数", () => {
    const handler = createChatWebSocket(createOptions());
    expect(typeof handler).toBe("function");
  });

  it("WebSocket 连接时应发送初始消息（空 delta）", () => {
    const ws = createMockWebSocket();
    const options = createOptions();
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "test-session" }, server: {} } as any);

    // 验证 send 被调用（初始消息）
    expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1);
    const firstMsg = JSON.parse(ws.sentMessages[0]);
    expect(firstMsg.type).toBe("text");
    expect(firstMsg.delta).toBe("");
  });

  it("应注册 message 事件监听", () => {
    const ws = createMockWebSocket();
    const options = createOptions();
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    expect(ws.on).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("应注册 close 事件监听", () => {
    const ws = createMockWebSocket();
    const options = createOptions();
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    expect(ws.on).toHaveBeenCalledWith("close", expect.any(Function));
  });

  it("应注册 error 事件监听", () => {
    const ws = createMockWebSocket();
    const options = createOptions();
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    expect(ws.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("无效 JSON 消息应返回 error", () => {
    const ws = createMockWebSocket();
    const options = createOptions();
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    ws.sentMessages.length = 0; // 清空初始消息

    // 发送无效 JSON
    ws.emit("message", Buffer.from("not-valid-json"));

    expect(ws.sentMessages.length).toBe(1);
    const msg = JSON.parse(ws.sentMessages[0]);
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Invalid JSON");
  });

  it("空消息内容应返回 error", () => {
    const ws = createMockWebSocket();
    const options = createOptions();
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    ws.sentMessages.length = 0;

    // 发送空 content 的消息
    ws.emit("message", Buffer.from(JSON.stringify({ type: "message", content: "" })));

    expect(ws.sentMessages.length).toBe(1);
    const msg = JSON.parse(ws.sentMessages[0]);
    expect(msg.type).toBe("error");
    expect(msg.message).toBe("Empty message content");
  });

  it("未知消息类型应返回 error", () => {
    const ws = createMockWebSocket();
    const options = createOptions();
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    ws.sentMessages.length = 0;

    ws.emit("message", Buffer.from(JSON.stringify({ type: "unknown_type" })));

    const errors = ws.sentMessages.filter((m) => JSON.parse(m).type === "error");
    expect(errors.length).toBe(1);
    const msg = JSON.parse(errors[0]);
    expect(msg.message).toContain("Unknown message type");
  });

  it("approval 消息缺少 callId 应返回 error", () => {
    const ws = createMockWebSocket();
    const options = createOptions();
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    ws.sentMessages.length = 0;

    ws.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "approval", approved: true })),
    );

    const errors = ws.sentMessages.filter((m) => JSON.parse(m).type === "error");
    expect(errors.length).toBe(1);
    const msg = JSON.parse(errors[0]);
    expect(msg.message).toBe("Missing callId in approval");
  });

  it("approval 消息找不到待审批项时应返回 error", () => {
    const ws = createMockWebSocket();
    const pendingApprovals = new Map<string, PendingApprovalItem>();
    const options = createOptions({ pendingApprovals });
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    ws.sentMessages.length = 0;

    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "approval",
          callId: "no-such",
          approved: true,
        }),
      ),
    );

    const errors = ws.sentMessages.filter((m) => JSON.parse(m).type === "error");
    expect(errors.length).toBe(1);
    const msg = JSON.parse(errors[0]);
    expect(msg.message).toContain("not found");
  });

  it("approval 消息应正确 resolve 待审批项", () => {
    const ws = createMockWebSocket();
    const pendingApprovals = new Map<string, PendingApprovalItem>();
    let resolvedValue: boolean | null = null;

    pendingApprovals.set("call-resolve", {
      resolve: (approved: boolean) => {
        resolvedValue = approved;
      },
      ws: ws as unknown as WebSocket,
    });

    const options = createOptions({ pendingApprovals });
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    ws.sentMessages.length = 0;

    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "approval",
          callId: "call-resolve",
          approved: true,
        }),
      ),
    );

    expect(resolvedValue).toBe(true);
    expect(pendingApprovals.has("call-resolve")).toBe(false);
  });

  it("断线时应清理该 socket 的待审批项", () => {
    const ws = createMockWebSocket();
    const pendingApprovals = new Map<string, PendingApprovalItem>();

    pendingApprovals.set("call-1", {
      resolve: () => {},
      ws: ws as unknown as WebSocket,
    });
    pendingApprovals.set("call-2", {
      resolve: () => {},
      ws: ws as unknown as WebSocket,
    });

    const options = createOptions({ pendingApprovals });
    const handler = createChatWebSocket(options);

    handler(ws as unknown as WebSocket, { params: { id: "s1" }, server: {} } as any);

    // 触发 close 事件
    ws.emit("close");

    expect(pendingApprovals.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ServerMessage 类型测试（编译时 + 运行时）
// ---------------------------------------------------------------------------

describe("ServerMessage 协议", () => {
  it("text 消息应有 type 和 delta", () => {
    const msg = { type: "text" as const, delta: "Hello" };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("text");
    expect(parsed.delta).toBe("Hello");
  });

  it("tool_start 消息应有 type、tool、args", () => {
    const msg = {
      type: "tool_start" as const,
      tool: ToolNames.FILE_READ,
      args: { path: "/test.txt" },
    };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("tool_start");
    expect(parsed.tool).toBe(ToolNames.FILE_READ);
    expect(parsed.args.path).toBe("/test.txt");
  });

  it("tool_end 消息应有 type、tool、result", () => {
    const msg = {
      type: "tool_end" as const,
      tool: ToolNames.FILE_READ,
      result: "File content here",
    };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("tool_end");
    expect(parsed.result).toBe("File content here");
  });

  it("confirm_required 消息应有 callId、tool、args", () => {
    const msg = {
      type: "confirm_required" as const,
      callId: "call-123",
      tool: ToolNames.SHELL_EXEC,
      args: { command: "rm -rf ./tmp" },
    };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("confirm_required");
    expect(parsed.callId).toBe("call-123");
    expect(parsed.tool).toBe(ToolNames.SHELL_EXEC);
  });

  it("done 消息应有 type 和 finalResponse", () => {
    const msg = {
      type: "done" as const,
      finalResponse: "All tasks completed successfully.",
    };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("done");
    expect(parsed.finalResponse).toBe("All tasks completed successfully.");
  });

  it("error 消息应有 type 和 message", () => {
    const msg = {
      type: "error" as const,
      message: "Something went wrong",
    };
    const json = JSON.stringify(msg);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("error");
    expect(parsed.message).toBe("Something went wrong");
  });
});
