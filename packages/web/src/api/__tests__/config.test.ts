/**
 * 模型配置 API client 测试
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchModelConfig, saveModelConfig } from "../config.js";

/** 构造一个最小 Response mock */
function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** 读取 fetch 调用中的 JSON body */
function requestBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchModelConfig", () => {
  it("解析服务端返回的脱敏配置", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({
        LLM_PROVIDER: "anthropic",
        LLM_MODEL: "claude-sonnet-4-5",
        LLM_API_KEY: "sk-a...1234",
        LLM_BASE_URL: "https://example.com/v1",
        WORKSPACE_PATH: "/Users/me/projects/app",
        AUTO_MODE: true,
      }),
    );

    await expect(fetchModelConfig()).resolves.toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      maskedApiKey: "sk-a...1234",
      baseUrl: "https://example.com/v1",
      workspacePath: "/Users/me/projects/app",
      autoMode: true,
    });
  });

  it("未配置（null）时返回 null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(null));

    await expect(fetchModelConfig()).resolves.toBeNull();
  });

  it("Provider 非法时返回 null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({ LLM_PROVIDER: "unknown", LLM_MODEL: "x" }),
    );

    await expect(fetchModelConfig()).resolves.toBeNull();
  });

  it("请求失败时抛出后端错误信息", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        { error: { message: "配置读取失败" } },
        false,
        500,
      ),
    );

    await expect(fetchModelConfig()).rejects.toThrow("配置读取失败");
  });
});

describe("saveModelConfig", () => {
  it("提交 Provider / 模型 / Key / 端点", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ success: true }));

    await saveModelConfig({
      provider: "openai",
      model: " gpt-4o ",
      apiKey: " sk-test ",
      baseUrl: " https://example.com/v1 ",
      workspacePath: " /Users/me/projects/app ",
      autoMode: true,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.any(String),
    });
    expect(requestBody(fetchMock)).toEqual({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-test",
      LLM_BASE_URL: "https://example.com/v1",
      WORKSPACE_PATH: "/Users/me/projects/app",
      AUTO_MODE: true,
    });
  });

  it("Key 留空时不提交 LLM_API_KEY（服务端沿用旧值）", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ success: true }));

    await saveModelConfig({ provider: "openai", model: "gpt-4o" });

    expect(requestBody(fetchMock)).toEqual({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_BASE_URL: null,
      WORKSPACE_PATH: null,
      AUTO_MODE: false,
    });
  });

  it("工作目录留空时提交 null 以清除默认工作目录", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ success: true }));

    await saveModelConfig({
      provider: "openai",
      model: "gpt-4o",
      workspacePath: "   ",
    });

    expect(requestBody(fetchMock)).toMatchObject({ WORKSPACE_PATH: null });
  });

  it("端点为空白时提交 null 以清除自定义端点", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response({ success: true }));

    await saveModelConfig({
      provider: "openai-compatible",
      model: "llama3",
      baseUrl: "   ",
    });

    expect(requestBody(fetchMock)).toMatchObject({ LLM_BASE_URL: null });
  });

  it("业务失败（success=false）时抛错", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({ success: false, error: "API Key 无效" }),
    );

    await expect(
      saveModelConfig({ provider: "openai", model: "gpt-4o", apiKey: "x" }),
    ).rejects.toThrow("API Key 无效");
  });

  it("HTTP 失败时抛错", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response({ success: false, error: "bad request" }, false, 400),
    );

    await expect(
      saveModelConfig({ provider: "openai", model: "gpt-4o", apiKey: "x" }),
    ).rejects.toThrow("bad request");
  });
});
