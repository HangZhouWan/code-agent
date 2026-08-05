/**
 * config.ts 单元测试
 *
 * 覆盖：
 * - loadConfig 正常加载与默认值
 * - LLM_API_KEY 缺失时抛出 ZodError
 * - z.coerce.number() 字符串转数字
 * - 可选字段 LLM_BASE_URL
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { loadConfig } from "../config.js";

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 可用的最小环境变量集 */
const MINIMAL_ENV = {
  LLM_API_KEY: "sk-test-key-123",
  LLM_PROVIDER: "openai",
  LLM_MODEL: "gpt-4o",
  HOST: "0.0.0.0",
  PORT: "3000",
  WORKSPACE_PATH: "./workspace",
  DB_PATH: ".agent/data/code-agent.db",
};

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  beforeEach(() => {
    // 重置环境变量
    for (const key of Object.keys(MINIMAL_ENV)) {
      delete process.env[key];
    }
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MAX_RETRIES;
  });

  // ── 正常加载 ──

  it("应该加载完整配置并返回正确的值", () => {
    setEnv(MINIMAL_ENV);
    const cfg = loadConfig();

    expect(cfg.LLM_PROVIDER).toBe("openai");
    expect(cfg.LLM_MODEL).toBe("gpt-4o");
    expect(cfg.LLM_API_KEY).toBe("sk-test-key-123");
    expect(cfg.HOST).toBe("0.0.0.0");
    expect(cfg.PORT).toBe(3000);
    expect(cfg.WORKSPACE_PATH).toBe("./workspace");
    expect(cfg.DB_PATH).toBe(".agent/data/code-agent.db");
  });

  // ── 默认值 ──

  it("LLM_PROVIDER 默认应为 openai", () => {
    setEnv({ LLM_API_KEY: "sk-abc" });
    const cfg = loadConfig();
    expect(cfg.LLM_PROVIDER).toBe("openai");
  });

  it("LLM_MODEL 默认应为 gpt-4o", () => {
    setEnv({ LLM_API_KEY: "sk-abc" });
    const cfg = loadConfig();
    expect(cfg.LLM_MODEL).toBe("gpt-4o");
  });

  it("HOST 默认应为 0.0.0.0", () => {
    setEnv({ LLM_API_KEY: "sk-abc" });
    const cfg = loadConfig();
    expect(cfg.HOST).toBe("0.0.0.0");
  });

  it("PORT 默认应为 3000（number 类型）", () => {
    setEnv({ LLM_API_KEY: "sk-abc" });
    const cfg = loadConfig();
    expect(cfg.PORT).toBe(3000);
    expect(typeof cfg.PORT).toBe("number");
  });

  it("WORKSPACE_PATH 默认应为 ./workspace", () => {
    setEnv({ LLM_API_KEY: "sk-abc" });
    const cfg = loadConfig();
    expect(cfg.WORKSPACE_PATH).toBe("./workspace");
  });

  it("DB_PATH 默认应为 .agent/data/code-agent.db", () => {
    setEnv({ LLM_API_KEY: "sk-abc" });
    const cfg = loadConfig();
    expect(cfg.DB_PATH).toBe(".agent/data/code-agent.db");
  });

  it("LLM_MAX_RETRIES 默认应为 3", () => {
    setEnv({ LLM_API_KEY: "sk-abc" });
    const cfg = loadConfig();
    expect(cfg.LLM_MAX_RETRIES).toBe(3);
  });

  // ── LLM_API_KEY 必填 ──

  it("LLM_API_KEY 缺失时应抛出 ZodError", () => {
    // 不设置任何环境变量
    expect(() => loadConfig()).toThrow(z.ZodError);
  });

  it("LLM_API_KEY 缺失时的错误信息应包含路径提示", () => {
    try {
      loadConfig();
      expect.unreachable("应该抛出 ZodError");
    } catch (err) {
      if (err instanceof z.ZodError) {
        const paths = err.errors.map((e) => e.path.join("."));
        expect(paths).toContain("LLM_API_KEY");
      } else {
        throw err;
      }
    }
  });

  // ── z.coerce.number() ──

  it("PORT 字符串应被 coerce 为 number", () => {
    setEnv({ LLM_API_KEY: "sk-abc", PORT: "8080" });
    const cfg = loadConfig();
    expect(cfg.PORT).toBe(8080);
    expect(typeof cfg.PORT).toBe("number");
  });

  it("LLM_MAX_RETRIES 字符串应被 coerce 为 number", () => {
    setEnv({ LLM_API_KEY: "sk-abc", LLM_MAX_RETRIES: "5" });
    const cfg = loadConfig();
    expect(cfg.LLM_MAX_RETRIES).toBe(5);
    expect(typeof cfg.LLM_MAX_RETRIES).toBe("number");
  });

  // ── 可选字段 ──

  it("LLM_BASE_URL 不设置时应为 undefined", () => {
    setEnv({ LLM_API_KEY: "sk-abc" });
    const cfg = loadConfig();
    expect(cfg.LLM_BASE_URL).toBeUndefined();
  });

  it("LLM_BASE_URL 设置时应有值", () => {
    setEnv({ LLM_API_KEY: "sk-abc", LLM_BASE_URL: "https://api.proxy.com/v1" });
    const cfg = loadConfig();
    expect(cfg.LLM_BASE_URL).toBe("https://api.proxy.com/v1");
  });

  // ── LLM_PROVIDER 枚举 ──

  it("LLM_PROVIDER 应接受 openai", () => {
    setEnv({ LLM_API_KEY: "sk-abc", LLM_PROVIDER: "openai" });
    expect(() => loadConfig()).not.toThrow();
  });

  it("LLM_PROVIDER 应接受 anthropic", () => {
    setEnv({ LLM_API_KEY: "sk-abc", LLM_PROVIDER: "anthropic" });
    expect(() => loadConfig()).not.toThrow();
  });

  it("LLM_PROVIDER 应接受 openai-compatible", () => {
    setEnv({ LLM_API_KEY: "sk-abc", LLM_PROVIDER: "openai-compatible" });
    expect(() => loadConfig()).not.toThrow();
  });

  it("LLM_PROVIDER 为无效值时应抛出 ZodError", () => {
    setEnv({ LLM_API_KEY: "sk-abc", LLM_PROVIDER: "invalid-provider" });
    expect(() => loadConfig()).toThrow(z.ZodError);
  });

  // ── 类型验证 ──

  it("返回的配置对象应有正确的类型", () => {
    setEnv(MINIMAL_ENV);
    const cfg = loadConfig();

    // 验证每个字段的类型
    expect(typeof cfg.LLM_PROVIDER).toBe("string");
    expect(typeof cfg.LLM_MODEL).toBe("string");
    expect(typeof cfg.LLM_API_KEY).toBe("string");
    expect(typeof cfg.HOST).toBe("string");
    expect(typeof cfg.PORT).toBe("number");
    expect(typeof cfg.WORKSPACE_PATH).toBe("string");
    expect(typeof cfg.DB_PATH).toBe("string");
    expect(typeof cfg.LLM_MAX_RETRIES).toBe("number");
  });
});
