import { describe, it, expect, expectTypeOf } from "vitest";
import {
  asRunId,
  asSessionId,
  agentCommandTopic,
  abortError,
  appConfigSchema,
  clientWsMessageSchema,
  contextConfigSchema,
  getDefaultModel,
  getDefaultModelWindow,
  isJsonValue,
  isProviderId,
  jsonValueSchema,
  llmConfigSchema,
  llmOverridesSchema,
  parseClientWsMessage,
  PROVIDER_DEFINITIONS,
  PROVIDER_IDS,
  serializeError,
  isSerializedError,
  serverWsMessageSchema,
  SESSION_EVENT_TYPES,
} from "../index.js";
import type { ProviderId, SessionId, SessionEventType } from "../index.js";

describe("providers", () => {
  it("每个 provider 都有完整定义", () => {
    for (const id of PROVIDER_IDS) {
      const definition = PROVIDER_DEFINITIONS[id];
      expect(definition.id).toBe(id);
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.defaultModel.length).toBeGreaterThan(0);
      expect(definition.modelWindow).toBeGreaterThan(0);
    }
  });

  it("isProviderId 只接受已注册的 provider", () => {
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("anthropic")).toBe(true);
    expect(isProviderId("openai-compatible")).toBe(true);
    expect(isProviderId("unknown")).toBe(false);
  });

  it("默认模型与窗口可查询", () => {
    expect(getDefaultModel("openai")).toBe("gpt-4o");
    expect(getDefaultModelWindow("anthropic")).toBeGreaterThan(0);
  });
});

describe("config schemas", () => {
  it("接受合法的 OpenAI 配置", () => {
    const parsed = llmConfigSchema.parse({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-test",
    });
    expect(parsed.LLM_MAX_RETRIES).toBe(3);
  });

  it("需要 API Key 的 provider 拒绝空 key", () => {
    const result = llmConfigSchema.safeParse({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("openai-compatible 允许空 API Key", () => {
    const result = llmConfigSchema.safeParse({
      LLM_PROVIDER: "openai-compatible",
      LLM_MODEL: "llama3",
    });
    expect(result.success).toBe(true);
  });

  it("partial overrides 允许只覆盖部分字段", () => {
    const parsed = llmOverridesSchema.parse({ LLM_MODEL: "gpt-4.1" });
    expect(parsed.LLM_MODEL).toBe("gpt-4.1");
    expect(parsed.LLM_PROVIDER).toBeUndefined();
  });

  it("appConfigSchema 将 PORT 字符串转为数字", () => {
    const parsed = appConfigSchema.parse({ PORT: "8080" });
    expect(parsed.PORT).toBe(8080);
    expect(parsed.HOST).toBe("127.0.0.1");
  });

  it("context schema 提供默认值并校验阈值顺序", () => {
    const parsed = contextConfigSchema.parse({});
    expect(parsed.CONTEXT_SOFT_THRESHOLD).toBeLessThan(parsed.CONTEXT_HARD_THRESHOLD);

    const invalid = contextConfigSchema.safeParse({
      CONTEXT_SOFT_THRESHOLD: 0.95,
      CONTEXT_HARD_THRESHOLD: 0.8,
    });
    expect(invalid.success).toBe(false);
  });

  it("ProviderId 类型可用于编译期约束", () => {
    expectTypeOf<ProviderId>().toMatchTypeOf<string>();
  });
});

describe("client websocket messages", () => {
  it("解析 message / approval / answer / abort / resume", () => {
    expect(
      clientWsMessageSchema.parse({ type: "message", content: "hello" }),
    ).toEqual({ type: "message", content: "hello" });

    expect(
      clientWsMessageSchema.parse({
        type: "approval",
        callId: "c1",
        approved: true,
      }),
    ).toMatchObject({ type: "approval", approved: true });

    expect(
      clientWsMessageSchema.parse({
        type: "answer",
        questionId: "q1",
        answer: "yes",
      }),
    ).toMatchObject({ type: "answer", answer: "yes" });

    expect(
      clientWsMessageSchema.parse({ type: "abort", runId: "r1" }),
    ).toMatchObject({ type: "abort", runId: "r1" });

    expect(
      clientWsMessageSchema.parse({ type: "resume", runId: "r1" }),
    ).toEqual({ type: "resume", runId: "r1" });

    expect(
      clientWsMessageSchema.parse({ type: "plan_mode", enabled: false }),
    ).toEqual({ type: "plan_mode", enabled: false });
  });

  it("计划审批可以携带选择与反馈", () => {
    expect(
      clientWsMessageSchema.parse({
        type: "approval",
        callId: "c1",
        approved: true,
        selectedProposalIds: ["p1", "p2"],
      }),
    ).toMatchObject({
      type: "approval",
      selectedProposalIds: ["p1", "p2"],
    });

    expect(
      clientWsMessageSchema.parse({
        type: "approval",
        callId: "c2",
        approved: false,
        feedback: "风险太高",
      }),
    ).toMatchObject({ type: "approval", feedback: "风险太高" });
  });

  it("拒绝未知类型", () => {
    expect(() =>
      clientWsMessageSchema.parse({ type: "unknown" }),
    ).toThrow();
  });

  it("拒绝空消息", () => {
    expect(() =>
      clientWsMessageSchema.parse({ type: "message", content: "   " }),
    ).toThrow();
  });

  it("拒绝缺少 approved 的审批消息", () => {
    expect(() =>
      clientWsMessageSchema.parse({ type: "approval", callId: "c1" }),
    ).toThrow();
  });

  it("parseClientWsMessage 返回类型化结果", () => {
    const message = parseClientWsMessage({
      type: "message",
      content: "hello",
    });
    expectTypeOf(message).toMatchTypeOf<
      | { type: "message"; content: string }
      | { type: "approval"; callId: string; approved: boolean }
      | { type: "plan_mode"; enabled: boolean }
      | { type: "answer"; questionId: string; answer: string }
      | { type: "abort"; runId?: string; reason?: string }
      | { type: "resume"; runId: string }
    >();
  });
});

describe("server websocket messages", () => {
  const envelope = {
    v: 1 as const,
    id: "e1",
    sessionId: "s1",
    runId: "r1",
    seq: 1,
    ts: "2026-10-19T12:00:00.000Z",
    event: {
      type: "run.started" as const,
      input: { content: "hello" },
      resumed: false,
    },
  };

  it("解析 ready / event / error", () => {
    expect(
      serverWsMessageSchema.parse({
        type: "ready",
        sessionId: "s1",
        lastSeq: 0,
      }),
    ).toMatchObject({ type: "ready", lastSeq: 0, planMode: true });

    expect(
      serverWsMessageSchema.parse({
        type: "ready",
        sessionId: "s1",
        lastSeq: 0,
        planMode: false,
      }),
    ).toMatchObject({ type: "ready", planMode: false });

    expect(
      serverWsMessageSchema.parse({ type: "event", event: envelope }),
    ).toMatchObject({ type: "event" });

    expect(
      serverWsMessageSchema.parse({
        type: "error",
        error: { code: "INTERNAL", message: "boom", retryable: false },
      }),
    ).toMatchObject({ type: "error" });
  });

  it("拒绝错误版本号", () => {
    expect(() =>
      serverWsMessageSchema.parse({
        type: "event",
        event: { ...envelope, v: 2 },
      }),
    ).toThrow();
  });

  it("拒绝未知事件类型", () => {
    expect(() =>
      serverWsMessageSchema.parse({
        type: "event",
        event: { ...envelope, event: { type: "unknown.event" } },
      }),
    ).toThrow();
  });
});

describe("errors", () => {
  it("将 Error 序列化", () => {
    const serialized = serializeError(new Error("boom"), "TOOL_FAILED");
    expect(serialized).toEqual({
      code: "TOOL_FAILED",
      message: "boom",
      retryable: false,
    });
    expect(isSerializedError(serialized)).toBe(true);
  });

  it("已是 SerializedError 时原样返回", () => {
    const error = {
      code: "TIMEOUT" as const,
      message: "slow",
      retryable: true,
    };
    expect(serializeError(error)).toBe(error);
  });

  it("abortError 使用 ABORTED", () => {
    expect(abortError("user cancelled")).toMatchObject({
      code: "ABORTED",
      message: "user cancelled",
    });
  });
});

describe("json", () => {
  it("识别合法 JsonValue", () => {
    expect(isJsonValue({ a: [1, "x", true, null] })).toBe(true);
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
  });

  it("jsonValueSchema 解析嵌套结构", () => {
    const parsed = jsonValueSchema.parse({ a: [1, "x"], b: null });
    expect(parsed).toEqual({ a: [1, "x"], b: null });
  });
});

describe("events and ids", () => {
  it("agentCommandTopic 生成角色 topic", () => {
    expect(agentCommandTopic("code")).toBe("agent.command.code");
    expect(agentCommandTopic("review")).toBe("agent.command.review");
  });

  it("session 事件类型覆盖完整", () => {
    expect(SESSION_EVENT_TYPES).toContain("run.started");
    expect(SESSION_EVENT_TYPES).toContain("approval.required");
    expect(SESSION_EVENT_TYPES).toContain("user.question.required");
    expect(SESSION_EVENT_TYPES).toContain("context.compacted");
    expect(SESSION_EVENT_TYPES).toContain("run.aborted");
    expectTypeOf<SessionEventType>().toMatchTypeOf<string>();
  });

  it("branded ID 保留字符串行为", () => {
    const sessionId = asSessionId("session-1");
    const runId = asRunId("run-1");
    expect(sessionId).toBe("session-1");
    expect(runId).toBe("run-1");
    expectTypeOf(sessionId).toEqualTypeOf<SessionId>();
  });
});
