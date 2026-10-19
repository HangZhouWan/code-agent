/**
 * AgentExecutionEngine 测试
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AIMessage,
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

function input(tools: ToolDefinition[] = [echoTool()]): AgentTaskInput {
  return {
    taskId,
    role: "code",
    description: "echo hi",
    tools,
    workspacePath: tempDir(),
    systemPrompt: "test agent",
    maxIterations: 5,
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
    expect(result.summary).toContain("Max iterations");
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
