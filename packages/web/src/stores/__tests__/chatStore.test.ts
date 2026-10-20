/**
 * chatStore 单元测试
 *
 * 覆盖 chatReducer 所有 Action：
 * - ADD_USER_MESSAGE / ADD_ASSISTANT_MESSAGE
 * - APPEND_TEXT / TOOL_START / TOOL_END
 * - CONFIRM_REQUIRED / APPROVAL_RESOLVED / FINALIZE_ASSISTANT
 * - DONE / ERROR / LOAD_MESSAGES
 * - 边界条件：空 messages 列表、finalResponse 为空、同名称 tool 匹配
 */

import { describe, it, expect } from "vitest";
import { chatReducer, dbMessagesToMessages, type ChatState, type Message } from "../chatStore.js";

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
// RUN_STARTED
// ---------------------------------------------------------------------------

describe("RUN_STARTED", () => {
  it("标记 run 为 running（用于重放/多端场景）", () => {
    const state = chatReducer(empty, { type: "RUN_STARTED" });
    expect(state.runStatus).toBe("running");
  });
});

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
    expect(state.runStatus).toBe("running");
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
// APPROVAL_RESOLVED
// ---------------------------------------------------------------------------

describe("APPROVAL_RESOLVED", () => {
  it("批准后应把确认卡切换回 running", () => {
    const initial: ChatState = {
      messages: [
        assistantMsg("a1", "", true, [
          {
            callId: "call-1",
            tool: "delete_file",
            args: {},
            status: "awaiting_approval",
            approvalId: "call-1",
          },
        ]),
      ],
    };
    const state = chatReducer(initial, {
      type: "APPROVAL_RESOLVED",
      callId: "call-1",
      decision: "approved",
    });
    expect(state.messages[0].toolCalls[0].status).toBe("running");
  });

  it("拒绝后应标记为 error 并写入原因", () => {
    const initial: ChatState = {
      messages: [
        assistantMsg("a1", "", true, [
          {
            callId: "call-1",
            tool: "delete_file",
            args: {},
            status: "awaiting_approval",
            approvalId: "call-1",
          },
        ]),
      ],
    };
    const state = chatReducer(initial, {
      type: "APPROVAL_RESOLVED",
      callId: "call-1",
      decision: "denied",
      reason: "user denied",
    });
    expect(state.messages[0].toolCalls[0]).toMatchObject({
      status: "error",
      result: "user denied",
    });
  });

  it("找不到 callId 时保持状态不变", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "", true)],
    };
    const state = chatReducer(initial, {
      type: "APPROVAL_RESOLVED",
      callId: "missing",
      decision: "approved",
    });
    expect(state).toBe(initial);
  });
});

// ---------------------------------------------------------------------------
// FINALIZE_ASSISTANT
// ---------------------------------------------------------------------------

describe("FINALIZE_ASSISTANT", () => {
  it("应该把流式消息原地完成并采用服务端 ID", () => {
    const initial: ChatState = {
      messages: [assistantMsg("local-1", "partial", true)],
    };
    const state = chatReducer(initial, {
      type: "FINALIZE_ASSISTANT",
      id: "msg-1",
      content: "final",
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      id: "msg-1",
      content: "final",
      isStreaming: false,
    });
  });

  it("历史已加载时按 ID 更新，不应追加重复消息", () => {
    const initial: ChatState = {
      messages: [
        userMsg("u1", "hello"),
        assistantMsg("msg-1", "final"),
      ],
    };
    const state = chatReducer(initial, {
      type: "FINALIZE_ASSISTANT",
      id: "msg-1",
      content: "final",
    });
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({
      id: "msg-1",
      content: "final",
      isStreaming: false,
    });
  });

  it("重复事件幂等：同一 ID 处理两次只保留一条消息", () => {
    const first = chatReducer(
      {
        messages: [
          userMsg("u1", "hello"),
          assistantMsg("msg-1", "final"),
        ],
      },
      { type: "FINALIZE_ASSISTANT", id: "msg-1", content: "final" },
    );
    const second = chatReducer(first, {
      type: "FINALIZE_ASSISTANT",
      id: "msg-1",
      content: "final",
    });
    expect(second.messages).toHaveLength(2);
    expect(second.messages.filter((m) => m.id === "msg-1")).toHaveLength(1);
  });

  it("末条不是流式 assistant 时追加新消息", () => {
    const initial: ChatState = {
      messages: [userMsg("u1", "hello")],
    };
    const state = chatReducer(initial, {
      type: "FINALIZE_ASSISTANT",
      id: "msg-1",
      content: "answer",
    });
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].id).toBe("msg-1");
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
    expect(state.runStatus).toBe("completed");
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

  it("空 messages 时追加最终 assistant 消息", () => {
    const state = chatReducer(empty, {
      type: "DONE",
      finalResponse: "x",
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      content: "x",
      isStreaming: false,
    });
  });

  it("已完成的 assistant 消息不应被 finalResponse 覆盖", () => {
    const initial: ChatState = {
      messages: [
        userMsg("u1", "hello"),
        assistantMsg("a1", "previous answer", false),
      ],
    };
    const state = chatReducer(initial, {
      type: "DONE",
      finalResponse: "another run's answer",
    });
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].content).toBe("previous answer");
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
    expect(state.runStatus).toBe("failed");
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
// QUESTION_RESOLVED
// ---------------------------------------------------------------------------

describe("QUESTION_RESOLVED", () => {
  const pendingQuestion = {
    questionId: "q1",
    question: "继续吗？",
    allowFreeText: true,
  };

  it("questionId 匹配时清除待回答问题", () => {
    const state = chatReducer(
      { messages: [], pendingQuestion },
      { type: "QUESTION_RESOLVED", questionId: "q1" },
    );
    expect(state.pendingQuestion).toBeUndefined();
  });

  it("questionId 不匹配时保留当前问题", () => {
    const initial: ChatState = { messages: [], pendingQuestion };
    const state = chatReducer(initial, {
      type: "QUESTION_RESOLVED",
      questionId: "q2",
    });
    expect(state).toBe(initial);
  });

  it("未提供 questionId 时直接清除", () => {
    const state = chatReducer(
      { messages: [], pendingQuestion },
      { type: "QUESTION_RESOLVED" },
    );
    expect(state.pendingQuestion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RESET_MESSAGES
// ---------------------------------------------------------------------------

describe("RESET_MESSAGES", () => {
  it("应清空消息和待回答问题", () => {
    const initial: ChatState = {
      messages: [userMsg("u1", "some message")],
      pendingQuestion: {
        questionId: "q1",
        question: "继续吗？",
        allowFreeText: true,
      },
    };
    const state = chatReducer(initial, { type: "RESET_MESSAGES" });
    expect(state.messages).toHaveLength(0);
    expect(state.pendingQuestion).toBeUndefined();
    expect(state.runStatus).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// LOAD_MESSAGES
// ---------------------------------------------------------------------------

describe("LOAD_MESSAGES", () => {
  it("历史消息在前，保留快照中没有的实时消息", () => {
    const initial: ChatState = {
      messages: [
        userMsg("u-live", "live message"),
        assistantMsg("msg-1", "just finished"),
      ],
    };
    const loaded = [
      userMsg("u2", "loaded message 1"),
      assistantMsg("a1", "loaded message 2"),
    ];
    const state = chatReducer(initial, {
      type: "LOAD_MESSAGES",
      messages: loaded,
    });
    expect(state.messages.map((m) => m.id)).toEqual([
      "u2",
      "a1",
      "u-live",
      "msg-1",
    ]);
  });

  it("历史中已存在的消息不会重复追加", () => {
    const initial: ChatState = {
      messages: [assistantMsg("a1", "same")],
    };
    const state = chatReducer(initial, {
      type: "LOAD_MESSAGES",
      messages: [assistantMsg("a1", "same")],
    });
    expect(state.messages).toHaveLength(1);
  });

  it("加载历史时保留已到达的待回答问题", () => {
    const question = {
      questionId: "q1",
      question: "继续吗？",
      allowFreeText: true,
    };
    const initial: ChatState = {
      messages: [],
      pendingQuestion: question,
    };
    const state = chatReducer(initial, {
      type: "LOAD_MESSAGES",
      messages: [userMsg("u1", "hello")],
    });
    expect(state.pendingQuestion).toEqual(question);
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
