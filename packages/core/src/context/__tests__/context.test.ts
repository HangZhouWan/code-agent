/**
 * 上下文计量与压缩测试
 */

import { describe, expect, it } from "vitest";
import type { SerializedMessage } from "@code-agent/protocol";
import {
  compactContext,
  deterministicSummary,
  mergeContextSummary,
  renderContextSummary,
} from "../compressor.js";
import { ContextManager } from "../manager.js";
import {
  createContextBudget,
  ContextOverflowError,
  type ContextSummary,
  type TokenCounterLike,
} from "../types.js";
import {
  createHeuristicTokenCounter,
  createTokenCounter,
} from "../token-counter.js";

class SimpleCounter implements TokenCounterLike {
  count(text: string): number {
    return text.length;
  }
  countValue(value: unknown): number {
    return JSON.stringify(value).length;
  }
  countMessage(message: SerializedMessage): number {
    return (
      message.content.length +
      (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0) +
      4
    );
  }
  countMessages(messages: SerializedMessage[]): number {
    return messages.reduce((sum, message) => sum + this.countMessage(message), 0);
  }
}

const counter = new SimpleCounter();

function budget(modelWindow = 200) {
  return createContextBudget({
    modelWindow,
    reservedOutput: 0,
    safetyMargin: 0,
    softThreshold: 0.5,
    hardThreshold: 0.9,
  });
}

function baseMessages(): SerializedMessage[] {
  return [
    { id: "sys", role: "system", content: "You are a coding agent." },
    { id: "u1", role: "human", content: "Implement login feature" },
    {
      id: "a1",
      role: "ai",
      content: "Reading file",
      toolCalls: [{ id: "c1", name: "file_read", args: { path: "src/auth.ts" } }],
    },
    {
      id: "t1",
      role: "tool",
      content: "file content ".repeat(80),
      toolCallId: "c1",
    },
    { id: "u2", role: "human", content: "Now add tests" },
    { id: "a2", role: "ai", content: "Done" },
  ];
}

function assertToolPairs(messages: SerializedMessage[]): void {
  const available = new Set<string>();
  for (const message of messages) {
    if (message.role === "ai" && message.toolCalls) {
      for (const call of message.toolCalls) available.add(call.id);
    }
    if (message.role === "tool") {
      expect(message.toolCallId).toBeDefined();
      expect(available.has(message.toolCallId!)).toBe(true);
    }
  }
}

describe("token counters", () => {
  it("heuristic 计量中英文并返回正数", () => {
    const heuristic = createHeuristicTokenCounter();
    expect(heuristic.count("hello world")).toBeGreaterThan(0);
    expect(heuristic.count("你好，世界")).toBeGreaterThan(0);
    expect(heuristic.countMessage({ role: "human", content: "hi" })).toBeGreaterThan(2);
  });

  it("按 provider 创建 token counter", () => {
    const openai = createTokenCounter({ provider: "openai" });
    const anthropic = createTokenCounter({ provider: "anthropic" });
    expect(openai.count("hello world")).toBeGreaterThan(0);
    expect(anthropic.count("你好世界")).toBeGreaterThan(0);
    expect(openai.modelWindow).toBeGreaterThan(0);
  });
});

describe("context budget", () => {
  it("计算 effective 与阈值", () => {
    const result = budget(2000);
    expect(result.effective).toBe(2000);
    expect(result.softThreshold).toBe(0.5);
    expect(result.hardThreshold).toBe(0.9);
  });

  it("soft >= hard 时抛错", () => {
    expect(() =>
      createContextBudget({
        modelWindow: 1000,
        softThreshold: 0.9,
        hardThreshold: 0.8,
      }),
    ).toThrow();
  });
});

describe("compactContext", () => {
  it("未超阈值时不压缩", async () => {
    const messages = baseMessages().slice(0, 2);
    const result = await compactContext({
      messages,
      budget: budget(10_000),
      counter,
    });
    expect(result.strategy).toBe("none");
    expect(result.messages).toEqual(messages);
  });

  it("压缩中段，保留 system / 最后用户消息 / 最近周期", async () => {
    const result = await compactContext({
      messages: baseMessages(),
      budget: budget(1024),
      counter,
    });

    expect(result.strategy).toBe("summary");
    expect(result.summary?.userGoals).toContain("Implement login feature");
    expect(result.messages.some((message) => message.id === "sys")).toBe(true);
    expect(result.messages.some((message) => message.id === "u2")).toBe(true);
    expect(result.messages.some((message) => message.id === "a2")).toBe(true);
    expect(result.summarizedMessageIds).toContain("u1");
    assertToolPairs(result.messages);
  });

  it("最近工具周期完整保留", async () => {
    const messages: SerializedMessage[] = [
      { id: "sys", role: "system", content: "system" },
      { id: "u1", role: "human", content: "old goal ".repeat(10) },
      { id: "u2", role: "human", content: "recent goal" },
      {
        id: "a1",
        role: "ai",
        content: "call",
        toolCalls: [{ id: "c1", name: "file_read", args: { path: "a.ts" } }],
      },
      { id: "t1", role: "tool", content: "ok", toolCallId: "c1" },
    ];

    const result = await compactContext({
      messages,
      budget: budget(300),
      counter,
      keepRecentTokens: 100,
    });

    expect(result.messages.some((message) => message.id === "a1")).toBe(true);
    expect(result.messages.some((message) => message.id === "t1")).toBe(true);
    assertToolPairs(result.messages);
  });

  it("摘要器失败时退回确定性摘要", async () => {
    const result = await compactContext({
      messages: baseMessages(),
      budget: budget(1024),
      counter,
      summarizer: {
        summarize: async () => {
          throw new Error("llm failed");
        },
      },
    });

    expect(result.strategy).toBe("summary");
    expect(result.summary?.userGoals).toContain("Implement login feature");
  });

  it("无法容纳时抛出 ContextOverflowError", async () => {
    const messages: SerializedMessage[] = [
      { id: "sys", role: "system", content: "s".repeat(5_000) },
      { id: "u1", role: "human", content: "hi" },
    ];

    await expect(
      compactContext({
        messages,
        budget: budget(50),
        counter,
      }),
    ).rejects.toBeInstanceOf(ContextOverflowError);
  });
});

describe("deterministicSummary", () => {
  it("提取目标、文件、命令和错误", () => {
    const summary = deterministicSummary([
      { id: "u1", role: "human", content: "Fix auth bug" },
      {
        id: "a1",
        role: "ai",
        content: "read",
        toolCalls: [{ id: "c1", name: "file_read", args: { path: "src/auth.ts" } }],
      },
      {
        id: "t1",
        role: "tool",
        content: "Error: failed to read file",
        toolCallId: "c1",
      },
    ]);

    expect(summary.userGoals).toContain("Fix auth bug");
    expect(summary.files).toContainEqual({
      path: "src/auth.ts",
      change: "touched",
    });
    expect(summary.commands.length).toBeGreaterThan(0);
    expect(summary.errors[0]?.message).toContain("Error");
  });

  it("合并摘要时去重并保留覆盖范围", () => {
    const previous: ContextSummary = {
      version: 1,
      coveredMessageIds: ["a"],
      userGoals: ["goal"],
      decisions: ["d1"],
      facts: [],
      files: [{ path: "a.ts", change: "modified" }],
      commands: [],
      errors: [],
      openQuestions: [],
      constraints: [],
    };
    const next: ContextSummary = {
      ...previous,
      coveredMessageIds: ["b"],
      userGoals: ["goal", "goal2"],
      decisions: ["d1", "d2"],
    };

    const merged = mergeContextSummary(previous, next);
    expect(merged.coveredMessageIds).toEqual(["a", "b"]);
    expect(merged.userGoals).toEqual(["goal", "goal2"]);
    expect(merged.decisions).toEqual(["d1", "d2"]);
  });

  it("renderContextSummary 输出结构化块", () => {
    const text = renderContextSummary(
      deterministicSummary([
        { role: "human", content: "do it" },
      ]),
    );
    expect(text).toContain("<context_summary");
    expect(text).toContain("do it");
    expect(text).toContain("</context_summary>");
  });
});

describe("ContextManager", () => {
  it("append 超阈值时自动压缩", async () => {
    const manager = new ContextManager(counter);
    manager.create("s1", [{ role: "system", content: "sys" }]);

    const managerBudget = budget(1024);
    for (let i = 0; i < 10; i++) {
      await manager.append(
        "s1",
        { id: `u${i}`, role: "human", content: "x".repeat(80) },
        managerBudget,
      );
    }

    const snapshot = manager.get("s1");
    expect(snapshot).toBeDefined();
    expect(snapshot!.tokenCount).toBeLessThanOrEqual(managerBudget.effective);
  });

  it("setSummary / delete / size", () => {
    const manager = new ContextManager(counter);
    manager.create("s1", []);
    const summary = deterministicSummary([]);
    manager.setSummary("s1", summary);
    expect(manager.get("s1")?.summary).toBe(summary);
    expect(manager.size).toBe(1);
    expect(manager.delete("s1")).toBe(true);
    expect(manager.size).toBe(0);
  });
});
