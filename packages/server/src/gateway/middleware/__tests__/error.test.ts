/**
 * error.ts 单元测试
 *
 * 覆盖：
 * - ZodError → 400 + ValidationError
 * - 配置/认证错误 → 503 + ConfigurationError
 * - 其他未知错误 → 500 + InternalError
 * - 响应格式统一性
 * - 生产环境下不泄露错误详情
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ZodError } from "zod";
import { errorHandler } from "../error.js";

// ---------------------------------------------------------------------------
// Mock Fastify Reply
// ---------------------------------------------------------------------------

function createMockReply() {
  const reply: Record<string, unknown> = {
    statusCode: 200,
    sentBody: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: unknown) {
      this.sentBody = body;
      return this;
    },
  };
  return reply;
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("errorHandler", () => {
  beforeEach(() => {
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  // ── 响应格式 ──

  it("应返回统一格式的 ErrorResponse（error + message）", () => {
    const reply = createMockReply();
    const error = new Error("Something went wrong");

    errorHandler(error, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    expect(body).toHaveProperty("error");
    expect(body).toHaveProperty("message");
    expect(typeof body.error).toBe("string");
    expect(typeof body.message).toBe("string");
  });

  // ── ZodError → 400 ──

  it("ZodError 应返回 400 状态码", () => {
    const reply = createMockReply();
    const zodError = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        received: "number",
        path: ["title"],
        message: "Expected string, received number",
      },
    ]);

    errorHandler(zodError, {} as any, reply as any);

    expect(reply.statusCode).toBe(400);
  });

  it("ZodError 响应应包含 ValidationError 错误类型", () => {
    const reply = createMockReply();
    const zodError = new ZodError([
      {
        code: "too_small",
        minimum: 1,
        type: "string",
        inclusive: true,
        exact: false,
        path: ["name"],
        message: "String must contain at least 1 character(s)",
      },
    ]);

    errorHandler(zodError, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    expect(body.error).toBe("ValidationError");
    expect(body.message).toBe("Request validation failed");
  });

  it("ZodError 响应应包含 details 数组（字段级错误）", () => {
    const reply = createMockReply();
    const zodError = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["title"],
        message: "Required",
      },
      {
        code: "invalid_type",
        expected: "number",
        received: "string",
        path: ["port"],
        message: "Expected number, received string",
      },
    ]);

    errorHandler(zodError, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    const details = body.details as Array<Record<string, unknown>>;
    expect(details).toHaveLength(2);
    expect(details[0].path).toBe("title");
    expect(details[0].message).toBe("Required");
    expect(details[1].path).toBe("port");
    expect(details[1].message).toBe("Expected number, received string");
  });

  // ── 配置错误 → 503 ──

  it("API Key 无效错误应返回 503", () => {
    const reply = createMockReply();
    const error = new Error("Incorrect API key provided: sk-xxx...");

    errorHandler(error, {} as any, reply as any);

    expect(reply.statusCode).toBe(503);
  });

  it("认证失败错误应返回 503", () => {
    const reply = createMockReply();
    const error = new Error("401 Unauthorized - Authentication failed");

    errorHandler(error, {} as any, reply as any);

    expect(reply.statusCode).toBe(503);
  });

  it("403 错误应返回 503", () => {
    const reply = createMockReply();
    const error = new Error("403 Forbidden - Invalid API key");

    errorHandler(error, {} as any, reply as any);

    expect(reply.statusCode).toBe(503);
  });

  it("invalid_api_key 错误应返回 503", () => {
    const reply = createMockReply();
    const error = new Error("OpenAI error: invalid_api_key");

    errorHandler(error, {} as any, reply as any);

    expect(reply.statusCode).toBe(503);
  });

  it("配置错误响应应包含 ConfigurationError 类型", () => {
    const reply = createMockReply();
    const error = new Error("API key not found");

    errorHandler(error, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    expect(body.error).toBe("ConfigurationError");
  });

  // ── 未知错误 → 500 ──

  it("普通未知错误应返回 500", () => {
    const reply = createMockReply();
    const error = new Error("Database connection lost");

    errorHandler(error, {} as any, reply as any);

    expect(reply.statusCode).toBe(500);
  });

  it("未知错误响应应包含 InternalError 类型", () => {
    const reply = createMockReply();
    const error = new Error("Unknown failure");

    errorHandler(error, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    expect(body.error).toBe("InternalError");
  });

  it("开发环境应返回具体错误消息", () => {
    process.env.NODE_ENV = "development";
    const reply = createMockReply();
    const error = new Error("Specific debug info");

    errorHandler(error, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    expect(body.message).toBe("Specific debug info");
  });

  it("生产环境应隐藏具体错误消息", () => {
    process.env.NODE_ENV = "production";
    const reply = createMockReply();
    const error = new Error("Sensitive internal details");

    errorHandler(error, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    expect(body.message).toBe("An unexpected error occurred");
  });

  it("开发环境应包含 error stack 在 details 中", () => {
    process.env.NODE_ENV = "development";
    const reply = createMockReply();
    const error = new Error("Stack test");
    error.stack = "Error: Stack test\n    at Test.<anonymous> (test.ts:1:1)";

    errorHandler(error, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    const details = body.details as string[];
    expect(details).toBeDefined();
    expect(details[0]).toContain("Error: Stack test");
  });

  it("生产环境不应包含 error stack", () => {
    process.env.NODE_ENV = "production";
    const reply = createMockReply();
    const error = new Error("Sensitive stack");
    error.stack = "Error: Sensitive stack\n    at secret.ts:42";

    errorHandler(error, {} as any, reply as any);

    const body = reply.sentBody as Record<string, unknown>;
    expect(body.details).toBeUndefined();
  });

  // ── 各种 API Key 错误变体 ──

  it.each([
    ["API key not provided", "api key"],
    ["Invalid ApiKey format", "apikey"],
    ["Missing API_KEY in request", "api_key"],
    ["Unauthorized access", "unauthorized"],
    ["Authentication required", "authentication"],
    ["Invalid key supplied", "invalid key"],
    ["Incorrect API key", "incorrect api key"],
  ])('"%s" 应被识别为配置错误', (message) => {
    const reply = createMockReply();
    const error = new Error(message);

    errorHandler(error, {} as any, reply as any);

    expect(reply.statusCode).toBe(503);
  });

  // ── 边界情况 ──

  it("非 Error 实例的错误也应返回 500", () => {
    const reply = createMockReply();
    // 模拟非 Error 实例的 thrown value
    const stringError = { message: "Not an Error instance" } as Error;

    errorHandler(stringError, {} as any, reply as any);

    expect(reply.statusCode).toBe(500);
  });

  it("空消息的 Error 不应匹配配置错误关键词", () => {
    const reply = createMockReply();
    const error = new Error("");

    errorHandler(error, {} as any, reply as any);

    expect(reply.statusCode).toBe(500);
  });
});
