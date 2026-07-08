/**
 * chatStore 单元测试
 *
 * 覆盖 chatReducer 所有 8 种 Action：
 * - ADD_USER_MESSAGE / ADD_ASSISTANT_MESSAGE
 * - APPEND_TEXT / TOOL_START / TOOL_END
 * - CONFIRM_REQUIRED / DONE / ERROR
 * - 边界条件：空 messages 列表、finalResponse 为空、同名称 tool 匹配
 */

import { describe, it, expect } from "vitest";
import { chatReducer, dbMessagesToMessages, type ChatState, type Message, type DBMessageRow } from "../chatStore.js";

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 初始空状态 */
const empty: ChatState = { messages: [] };

/** 创建一条 user 消息 */
function userMsg(id: string, content: string): Message {
  return { id, role: "user", content, isStreaming: false, toolCalls: [] };
}

/** 创建一条 assistant 消息 */
function assistantMsg(
  id: string,
  content: string,
  isStreaming = false,
  toolCalls: Message["toolCalls"] = [],
): Message {
  return { id, role: "assistant", content, isStreaming, toolCalls };
}

// ---------------------------------------------------------------------------
// ADD_USER_MESSAGE
// ---------------------------------------------------------------------------

describe("ADD_USER_MESSAGE", () => {
  it("应该在空状态中追加一条 user 消息", () => {
    const state = chatReducer(empty, {
      type: "ADD_USER_MESSAGE",
      id: "u1",
      content: "Hello",
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[0].content).toBe("Hello");
    expect(state.messages[0].isStreaming).toBe(false);
    expect(state.messages[0].toolCalls).toEqual([]);
  });

  it("应该在已有消息后追加 user 消息", () => {
    const initial: ChatState = {
      messages: [userMsg("u1", "First")],
    };
    const state = chatReducer(initial, {
      type: "ADD_USER_MESSAGE",
      id: "u2",
      content: "Second",
    });
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].content).toBe("Second");
  });
});

// ---------------------------------------------------------------------------
// ADD_ASSISTANT_MESSAGE
// ---------------------------------------------------------------------------

describe("ADD_ASSISTANT_MESSAGE", () => {
  it("应该追加一条空的 assistant 消息（isStreaming: true）", () => {
    const state = chatReducer(empty, {
      type: "ADD_ASSISTANT_MESSAGE",
      id: "a1",
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("assistant");
    expect(state.messages[0].content).toBe("");
    expect(state.messages[0].isStreaming).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// APPEND_TEXT
// ---------------------------------------------------------------------------

describe("APPEND_TEXT", () => {
  it("应该追加文本增量到最新 assistant 消息", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "", true)],
    };
    const state = chatReducer(initial, { type: "APPEND_TEXT", delta: "Hello" });
    expect(state.messages[0].content).toBe("Hello");

    const state2 = chatReducer(state, { type: "APPEND_TEXT", delta: " world" });
    expect(state2.messages[0].content).toBe("Hello world");
  });

  it("空 messages 时不应崩溃", () => {
    const state = chatReducer(empty, { type: "APPEND_TEXT", delta: "X" });
    expect(state.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TOOL_START
// ---------------------------------------------------------------------------

describe("TOOL_START", () => {
  it("应该追加一个 running 状态的 toolCall", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "", true)],
    };
    const state = chatReducer(initial, {
      type: "TOOL_START",
      tool: "read_file",
      args: { path: "/tmp/test.txt" },
    });
    expect(state.messages[0].toolCalls).toHaveLength(1);
    expect(state.messages[0].toolCalls[0].tool).toBe("read_file");
    expect(state.messages[0].toolCalls[0].status).toBe("running");
  });

  it("空 messages 时不应崩溃", () => {
    const state = chatReducer(empty, {
      type: "TOOL_START",
      tool: "read_file",
      args: {},
    });
    expect(state.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TOOL_END
// ---------------------------------------------------------------------------

describe("TOOL_END", () => {
  it("应该更新匹配 tool 名称的 toolCall 为 done", () => {
    const initial: ChatState = {
      messages: [
        assistantMsg("a1", "", true, [
          { tool: "read_file", args: {}, status: "running" },
        ]),
      ],
    };
    const state = chatReducer(initial, {
      type: "TOOL_END",
      tool: "read_file",
      result: "file contents here",
    });
    expect(state.messages[0].toolCalls[0].status).toBe("done");
    expect(state.messages[0].toolCalls[0].result).toBe("file contents here");
  });

  it("应该从后往前匹配同名称的 toolCall", () => {
    const initial: ChatState = {
      messages: [
        assistantMsg("a1", "", true, [
          { tool: "read_file", args: {}, status: "running" },
          { tool: "read_file", args: { path: "/b" }, status: "running" },
        ]),
      ],
    };
    const state = chatReducer(initial, {
      type: "TOOL_END",
      tool: "read_file",
      result: "result",
    });
    // 应该更新最后一个（索引 1）而非第一个
    expect(state.messages[0].toolCalls[0].status).toBe("running"); // 未变
    expect(state.messages[0].toolCalls[1].status).toBe("done"); // 已更新
  });

  it("无匹配 tool 名称时应静默忽略", () => {
    const initial: ChatState = {
      messages: [
        assistantMsg("a1", "", true, [
          { tool: "read_file", args: {}, status: "running" },
        ]),
      ],
    };
    const state = chatReducer(initial, {
      type: "TOOL_END",
      tool: "nonexistent",
      result: "x",
    });
    expect(state.messages[0].toolCalls[0].status).toBe("running");
  });

  it("空 messages 时不应崩溃", () => {
    const state = chatReducer(empty, {
      type: "TOOL_END",
      tool: "read_file",
      result: "x",
    });
    expect(state.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CONFIRM_REQUIRED
// ---------------------------------------------------------------------------

describe("CONFIRM_REQUIRED", () => {
  it("应该追加 awaiting_approval 状态的 toolCall", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "", true)],
    };
    const state = chatReducer(initial, {
      type: "CONFIRM_REQUIRED",
      callId: "call-1",
      tool: "delete_file",
      args: { path: "/tmp/x" },
    });
    expect(state.messages[0].toolCalls[0].status).toBe("awaiting_approval");
    expect(state.messages[0].toolCalls[0].callId).toBe("call-1");
  });
});

// ---------------------------------------------------------------------------
// DONE
// ---------------------------------------------------------------------------

describe("DONE", () => {
  it("应该标记 isStreaming 为 false", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "streaming...", true)],
    };
    const state = chatReducer(initial, {
      type: "DONE",
      finalResponse: "Done!",
    });
    expect(state.messages[0].isStreaming).toBe(false);
    expect(state.messages[0].content).toBe("Done!");
  });

  it("finalResponse 为空时保留已流式累积的 content", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "accumulated text", true)],
    };
    const state = chatReducer(initial, {
      type: "DONE",
      finalResponse: "",
    });
    expect(state.messages[0].isStreaming).toBe(false);
    expect(state.messages[0].content).toBe("accumulated text");
  });

  it("空 messages 时不应崩溃", () => {
    const state = chatReducer(empty, {
      type: "DONE",
      finalResponse: "x",
    });
    expect(state.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ERROR
// ---------------------------------------------------------------------------

describe("ERROR", () => {
  it("应该追加错误消息并标记前一条 assistant 结束", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "in progress", true)],
    };
    const state = chatReducer(initial, {
      type: "ERROR",
      message: "Something went wrong",
    });
    // 前一条应该结束
    expect(state.messages[0].isStreaming).toBe(false);
    // 新错误消息
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].content).toContain("Something went wrong");
  });

  it("空 messages 时也应追加错误消息", () => {
    const state = chatReducer(empty, {
      type: "ERROR",
      message: "Oops",
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toContain("Oops");
  });
});

// ---------------------------------------------------------------------------
// LOAD_MESSAGES
// ---------------------------------------------------------------------------

describe("LOAD_MESSAGES", () => {
  it("应该替换整个 messages 数组", () => {
    const initial: ChatState = {
      messages: [userMsg("u1", "old message")],
    };
    const loaded = [
      userMsg("u2", "loaded message 1"),
      assistantMsg("a1", "loaded message 2"),
    ];
    const state = chatReducer(initial, {
      type: "LOAD_MESSAGES",
      messages: loaded,
    });
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].content).toBe("loaded message 1");
  });

  it("空数组应清空所有消息", () => {
    const initial: ChatState = {
      messages: [userMsg("u1", "some message")],
    };
    const state = chatReducer(initial, {
      type: "LOAD_MESSAGES",
      messages: [],
    });
    expect(state.messages).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// dbMessagesToMessages
// ---------------------------------------------------------------------------

describe("dbMessagesToMessages", () => {
  it("应该将 human → user 并设置 isStreaming: false", () => {
    const rows = [
      { id: 1, sessionId: "s1", role: "human", content: "Hello", toolName: null, toolArgs: null, toolResult: null, createdAt: "2024-01-01" },
    ];
    const result = dbMessagesToMessages(rows);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hello");
    expect(result[0].isStreaming).toBe(false);
    expect(result[0].toolCalls).toEqual([]);
  });

  it("应该保持 assistant 不变", () => {
    const rows = [
      { id: 2, sessionId: "s1", role: "assistant", content: "Hi!", toolName: null, toolArgs: null, toolResult: null, createdAt: "2024-01-01" },
    ];
    const result = dbMessagesToMessages(rows);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
  });

  it("应该过滤 system 和 tool 角色", () => {
    const rows = [
      { id: 1, sessionId: "s1", role: "system", content: "sys", toolName: null, toolArgs: null, toolResult: null, createdAt: "2024-01-01" },
      { id: 2, sessionId: "s1", role: "human", content: "Hello", toolName: null, toolArgs: null, toolResult: null, createdAt: "2024-01-02" },
      { id: 3, sessionId: "s1", role: "tool", content: "", toolName: "grep", toolArgs: "{}", toolResult: "found", createdAt: "2024-01-03" },
    ];
    const result = dbMessagesToMessages(rows);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("空数组应返回空数组", () => {
    expect(dbMessagesToMessages([])).toEqual([]);
  });

  it("id 应为字符串", () => {
    const rows = [
      { id: 42, sessionId: "s1", role: "human", content: "x", toolName: null, toolArgs: null, toolResult: null, createdAt: "2024-01-01" },
    ];
    const result = dbMessagesToMessages(rows);
    expect(result[0].id).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// 不可变性
// ---------------------------------------------------------------------------

describe("不可变性", () => {
  it("reducer 应返回新对象而非修改原对象", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "", true)],
    };
    const state = chatReducer(initial, { type: "APPEND_TEXT", delta: "X" });
    expect(state).not.toBe(initial);
    expect(state.messages).not.toBe(initial.messages);
    // 原状态应不变
    expect(initial.messages[0].content).toBe("");
  });
});
