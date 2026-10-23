/**
 * LLM 工厂测试
 *
 * 只验证参数装配，不发起网络请求。
 */

import { describe, expect, it } from "vitest";
import { createChatModel } from "../factory.js";

interface WithMaxTokens {
  maxTokens?: number;
}

describe("createChatModel", () => {
  it("anthropic 未知模型默认 maxTokens 为 8192", () => {
    const model = createChatModel({
      provider: "anthropic",
      model: "deepseek-flash",
      apiKey: "test-key",
    }) as unknown as WithMaxTokens;

    expect(model.maxTokens).toBe(8_192);
  });

  it("显式 maxTokens 优先于默认值", () => {
    const model = createChatModel({
      provider: "anthropic",
      model: "deepseek-flash",
      apiKey: "test-key",
      maxTokens: 16_384,
    }) as unknown as WithMaxTokens;

    expect(model.maxTokens).toBe(16_384);
  });
});
