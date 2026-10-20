/**
 * AgentExecutionEngine 测试
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AIMessage,
  AIMessageChunk,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  asRunId,
  asSessionId,
  asTaskId,
  type SessionEvent,
} from "@code-agent/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HooksEngine,
  createContextBudget,
  createHeuristicTokenCounter,
} from "../../index.js";
import type { ToolDefinition } from "../../tools/base.js";
import type { AgentCheckpointV1 } from "../../checkpoint/types.js";
import {
  AgentExecutionEngine,
  type ChatModelLike,
} from "../engine.js";
import type { AgentTaskInput, RunScope } from "../contracts.js";

const sessionId = asSessionId("s1");
const runId = asRunId("r1");
const taskId = asTaskId("t1");

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-engine-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

class ScriptedModel implements ChatModelLike {
  readonly calls: BaseMessage[][] = [];
  bound = false;

  constructor(private readonly responses: BaseMessage[]) {}

  bindTools(): ChatModelLike {
    this.bound = true;
    return this;
  }

  async invoke(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<BaseMessage> {
    if (options?.signal?.aborted) {
      throw new Error("aborted");
    }
    this.calls.push([...messages]);
    const next = this.responses.shift();
    if (!next) throw new Error("no scripted response left");
    return next;
  }
}

class StreamingModel implements ChatModelLike {
  bindTools(): ChatModelLike {
    return this;
  }

  async invoke(): Promise<BaseMessage> {
    throw new Error("invoke should not be used");
  }

  async *stream(): AsyncIterable<BaseMessage> {
    yield new AIMessageChunk({ content: "he" });
    yield new AIMessageChunk({ content: "llo" });
  }
}

/** 模拟 LangChain v1：Runnable.stream() 返回 Promise<AsyncIterable> */
class PromiseStreamingModel implements ChatModelLike {
  bindTools(): ChatModelLike {
    return this;
  }

  async invoke(): Promise<BaseMessage> {
    throw new Error("invoke should not be used");
  }

  stream(): Promise<AsyncIterable<BaseMessage>> {
    return Promise.resolve(
      (async function* () {
        yield new AIMessageChunk({ content: "he" });
        yield new AIMessageChunk({ content: "llo" });
      })(),
    );
  }
}

function echoTool(permission: "allow" | "confirm" = "allow"): ToolDefinition {
  return {
    name: "echo",
    description: "echo text",
    schema: z.object({ text: z.string() }),
    permission,
    sideEffect: "none",
    execute: async (args) => `echo:${args.text}`,
  };
}

function input(
  tools: ToolDefinition[] = [echoTool()],
  overrides: Partial<AgentTaskInput> = {},
): AgentTaskInput {
  return {
    taskId,
    role: "code",
    description: "echo hi",
    tools,
    workspacePath: tempDir(),
    systemPrompt: "test agent",
    maxIterations: 5,
    ...overrides,
  };
}

/** 用于验证落盘检查的 file_write 工具 */
function writeTool(permission: "allow" | "confirm" = "allow"): ToolDefinition {
  return {
    name: "file_write",
    description: "write file",
    schema: z.object({ path: z.string(), content: z.string() }),
    permission,
    sideEffect: "mutating",
    execute: async (args) => `wrote:${args.path}`,
  };
}

function scope(
  overrides: Partial<RunScope> = {},
): { scope: RunScope; controller: AbortController } {
  const controller = new AbortController();
  return {
    controller,
    scope: {
      sessionId,
      runId,
      taskId,
      signal: controller.signal,
      ...overrides,
    },
  };
}

function toolCall(name = "echo", text = "hi"): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: "c1", name, args: { text } }],
  });
}

function assertHasToolMessage(messages: BaseMessage[], content: string): void {
  expect(
    messages.some(
      (message) =>
        message instanceof ToolMessage &&
        String(message.content).includes(content),
    ),
  ).toBe(true);
}

describe("native tool calling", () => {
  it("执行工具后返回最终结果", async () => {
    const model = new ScriptedModel([
      toolCall(),
      new AIMessage({ content: "done" }),
    ]);
    const engine = new AgentExecutionEngine(model);
    const { scope: runScope } = scope();

    const result = await engine.invoke(input(), runScope);

    expect(result.status).toBe("success");
    expect(result.summary).toBe("done");
    expect(model.bound).toBe(true);
    assertHasToolMessage(model.calls[1], "echo:hi");
  });

  it("创建类任务未写入文件时先提醒，仍不写则失败", async () => {
    const model = new ScriptedModel([
      new AIMessage({ content: "done" }),
      new AIMessage({ content: "still done" }),
    ]);
    const engine = new AgentExecutionEngine(model);

    const result = await engine.invoke(
      input([writeTool()], { description: "创建一个 index.html 文件" }),
      scope().scope,
    );

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("file_write");
    expect(model.calls).toHaveLength(2);
    expect(String(model.calls[1].at(-1)?.content)).toContain("file_write");
  });

  it("输出被 max_tokens 截断时返回可诊断的失败", async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        response_metadata: { stop_reason: "max_tokens" },
      }),
    ]);
    const engine = new AgentExecutionEngine(model);

    const result = await engine.invoke(
      input([writeTool()], { description: "创建一个 index.html 文件" }),
      scope().scope,
    );

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("max_tokens");
    // 截断时不应再发提醒，避免重复浪费一次调用
    expect(model.calls).toHaveLength(1);
  });

  it("提醒后执行 file_write 则任务成功", async () => {
    const model = new ScriptedModel([
      new AIMessage({ content: "done" }),
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "w1",
            name: "file_write",
            args: { path: "index.html", content: "<html></html>" },
          },
        ],
      }),
      new AIMessage({ content: "created" }),
    ]);
    const engine = new AgentExecutionEngine(model);

    const result = await engine.invoke(
      input([writeTool()], { description: "创建一个 index.html 文件" }),
      scope().scope,
    );

    expect(result.status).toBe("success");
    expect(result.artifacts?.filesChanged?.[0]?.path).toBe("index.html");
  });

  it("用户拒绝 file_write 后仍可完成（不算未尝试写入）", async () => {
    const requestApproval = vi.fn(async () => false);
    const model = new ScriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "w1",
            name: "file_write",
            args: { path: "index.html", content: "<html></html>" },
          },
        ],
      }),
      new AIMessage({ content: "write was denied" }),
    ]);
    const engine = new AgentExecutionEngine(model);

    const result = await engine.invoke(
      input([writeTool("confirm")], { description: "write a file" }),
      scope({ requestApproval }).scope,
    );

    expect(result.status).toBe("success");
    expect(result.summary).toBe("write was denied");
    expect(requestApproval).toHaveBeenCalledTimes(1);
  });

  it("confirm 工具经过审批，拒绝时把错误反馈给模型", async () => {
    const requestApproval = vi.fn(async () => false);
    const model = new ScriptedModel([
      toolCall(),
      new AIMessage({ content: "done" }),
    ]);
    const engine = new AgentExecutionEngine(model);
    const { scope: runScope } = scope({ requestApproval });

    const result = await engine.invoke(input([echoTool("confirm")]), runScope);

    expect(result.status).toBe("success");
    expect(requestApproval).toHaveBeenCalledTimes(1);
    assertHasToolMessage(model.calls[1], "denied");
  });

  it("emit tool.started / tool.finished", async () => {
    const events: SessionEvent[] = [];
    const model = new ScriptedModel([
      toolCall(),
      new AIMessage({ content: "done" }),
    ]);
    const engine = new AgentExecutionEngine(model);
    const { scope: runScope } = scope({ emit: (event) => events.push(event) });

    await engine.invoke(input(), runScope);

    expect(events.map((event) => event.type)).toEqual([
      "tool.started",
      "tool.finished",
    ]);
  });

  it("保存 checkpoint，并记录 pendingTool 与 toolHistory", async () => {
    const saved: AgentCheckpointV1[] = [];
    const model = new ScriptedModel([
      toolCall(),
      new AIMessage({ content: "done" }),
    ]);
    const engine = new AgentExecutionEngine(model, {
      checkpoints: {
        save: async (checkpoint) => {
          saved.push(checkpoint);
        },
      },
    });
    const { scope: runScope } = scope();

    await engine.invoke(input(), runScope);

    expect(saved.length).toBeGreaterThanOrEqual(3);
    expect(saved.some((checkpoint) => checkpoint.pendingTool)).toBe(true);
    expect(
      saved.some((checkpoint) => checkpoint.toolHistory.length > 0),
    ).toBe(true);
  });

  it("abort 在调用模型前生效", async () => {
    const model = new ScriptedModel([new AIMessage({ content: "done" })]);
    const engine = new AgentExecutionEngine(model);
    const { scope: runScope, controller } = scope();
    controller.abort();

    const result = await engine.invoke(input(), runScope);

    expect(result.status).toBe("cancelled");
    expect(model.calls).toHaveLength(0);
  });

  it("达到最大迭代返回 timeout", async () => {
    const model = new ScriptedModel([toolCall(), toolCall(), toolCall()]);
    const engine = new AgentExecutionEngine(model);
    const { scope: runScope } = scope();

    const result = await engine.invoke(
      { ...input(), maxIterations: 2 },
      runScope,
    );

    expect(result.status).toBe("timeout");
    expect(result.summary).toContain("最大迭代次数");
  });

  it("超过预算时触发 context.compact hook", async () => {
    const hooks = new HooksEngine({ onError: () => {} });
    const compacted: unknown[] = [];
    hooks.on("context:compact", async (ctx) => {
      compacted.push(ctx.data);
    });

    const model = new ScriptedModel([new AIMessage({ content: "done" })]);
    const engine = new AgentExecutionEngine(model, {
      hooks,
      tokenCounter: createHeuristicTokenCounter(1024),
      contextBudget: createContextBudget({
        modelWindow: 1024,
        reservedOutput: 0,
        safetyMargin: 0,
        softThreshold: 0.5,
        hardThreshold: 0.9,
      }),
    });
    const { scope: runScope } = scope();

    const result = await engine.invoke(
      { ...input(), description: "x".repeat(2_000) },
      runScope,
    );

    expect(result.status).toBe("success");
    expect(compacted.length).toBeGreaterThan(0);
  });

  it("流式输出 message.delta 并聚合最终内容", async () => {
    const events: SessionEvent[] = [];
    const engine = new AgentExecutionEngine(new StreamingModel());
    const { scope: runScope } = scope({
      emit: (event) => events.push(event),
    });

    const result = await engine.invoke(input(), runScope);

    expect(result.status).toBe("success");
    expect(result.summary).toBe("hello");
    expect(
      events
        .filter((event) => event.type === "message.delta")
        .map((event) => (event.type === "message.delta" ? event.delta : "")),
    ).toEqual(["he", "llo"]);
  });

  it("兼容 LangChain v1 返回 Promise 的 stream", async () => {
    const events: SessionEvent[] = [];
    const engine = new AgentExecutionEngine(new PromiseStreamingModel());
    const { scope: runScope } = scope({
      emit: (event) => events.push(event),
    });

    const result = await engine.invoke(input(), runScope);

    expect(result.status).toBe("success");
    expect(result.summary).toBe("hello");
    expect(
      events.filter((event) => event.type === "message.delta"),
    ).toHaveLength(2);
  });

  it("未知工具返回错误但模型仍可完成", async () => {
    const model = new ScriptedModel([
      toolCall("missing_tool"),
      new AIMessage({ content: "recovered" }),
    ]);
    const engine = new AgentExecutionEngine(model);
    const { scope: runScope } = scope();

    const result = await engine.invoke(input(), runScope);

    expect(result.status).toBe("success");
    assertHasToolMessage(model.calls[1], "Unknown tool");
  });
});

describe("JSON fallback", () => {
  it("done 决策直接完成", async () => {
    const model = new ScriptedModel([
      new AIMessage({ content: '{"decision":"done","summary":"ok"}' }),
    ]);
    const engine = new AgentExecutionEngine(model, {
      supportsNativeToolCalling: false,
    });
    const { scope: runScope } = scope();

    const result = await engine.invoke(input(), runScope);

    expect(result.status).toBe("success");
    expect(result.summary).toBe("ok");
    expect(model.bound).toBe(false);
  });

  it("use_tool 执行工具并把结果写回消息", async () => {
    const model = new ScriptedModel([
      new AIMessage({
        content:
          '{"decision":"use_tool","toolCall":{"name":"echo","args":{"text":"hi"}}}',
      }),
      new AIMessage({ content: '{"decision":"done","summary":"finished"}' }),
    ]);
    const engine = new AgentExecutionEngine(model, {
      supportsNativeToolCalling: false,
    });
    const { scope: runScope } = scope();

    const result = await engine.invoke(input(), runScope);

    expect(result.summary).toBe("finished");
    expect(
      model.calls[1].some((message) =>
        String(message.content).includes("echo:hi"),
      ),
    ).toBe(true);
  });

  it("非法 JSON 返回 replan_needed，而不是误判成功", async () => {
    const model = new ScriptedModel([new AIMessage({ content: "not json" })]);
    const engine = new AgentExecutionEngine(model, {
      supportsNativeToolCalling: false,
    });
    const { scope: runScope } = scope();

    const result = await engine.invoke(input(), runScope);

    expect(result.status).toBe("replan_needed");
  });
});
