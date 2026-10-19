/**
 * 配置路由测试
 *
 * 覆盖：首次配置状态、保存、脱敏、更新时保留旧 Key、清除端点、校验失败
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { GlobalConfigManager } from "@code-agent/runtime";
import runtimeConfig from "../runtime-config.js";

const tempDirs: string[] = [];
const apps: FastifyInstance[] = [];

/** 创建使用临时配置文件的路由实例 */
async function createApp(): Promise<{
  app: FastifyInstance;
  manager: GlobalConfigManager;
}> {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-config-route-"));
  tempDirs.push(dir);
  const manager = new GlobalConfigManager({
    filePath: join(dir, "config.json"),
  });
  const app = Fastify();
  await app.register(runtimeConfig, {
    prefix: "/api/config",
    manager,
  });
  apps.push(app);
  return { app, manager };
}

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime config routes", () => {
  it("首次配置前 setupRequired 为 true", async () => {
    const { app } = await createApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/config/status",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ setupRequired: true });
  });

  it("保存后返回脱敏配置且状态变为已配置", async () => {
    const { app } = await createApp();

    const save = await app.inject({
      method: "POST",
      url: "/api/config",
      payload: {
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o",
        LLM_API_KEY: "sk-secret-123456",
      },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({ success: true, restartRequired: true });

    const status = await app.inject({
      method: "GET",
      url: "/api/config/status",
    });
    expect(status.json()).toEqual({
      setupRequired: false,
      provider: "openai",
      model: "gpt-4o",
    });

    const current = await app.inject({
      method: "GET",
      url: "/api/config",
    });
    expect(current.json()).toMatchObject({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-s...3456",
    });
  });

  it("更新时 API Key 留空会沿用已保存的 Key", async () => {
    const { app, manager } = await createApp();

    await app.inject({
      method: "POST",
      url: "/api/config",
      payload: {
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o",
        LLM_API_KEY: "sk-secret-123456",
      },
    });

    const update = await app.inject({
      method: "POST",
      url: "/api/config",
      payload: {
        LLM_PROVIDER: "anthropic",
        LLM_MODEL: "claude-sonnet-4-5",
        LLM_API_KEY: "",
      },
    });

    expect(update.statusCode).toBe(200);
    expect(manager.load()).toMatchObject({
      LLM_PROVIDER: "anthropic",
      LLM_MODEL: "claude-sonnet-4-5",
      LLM_API_KEY: "sk-secret-123456",
    });
  });

  it("LLM_BASE_URL 传 null 时清除自定义端点", async () => {
    const { app, manager } = await createApp();

    await app.inject({
      method: "POST",
      url: "/api/config",
      payload: {
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o",
        LLM_API_KEY: "sk-secret-123456",
        LLM_BASE_URL: "https://example.com/v1",
      },
    });
    expect(manager.load()?.LLM_BASE_URL).toBe("https://example.com/v1");

    const update = await app.inject({
      method: "POST",
      url: "/api/config",
      payload: {
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o",
        LLM_BASE_URL: null,
      },
    });

    expect(update.statusCode).toBe(200);
    expect(manager.load()?.LLM_BASE_URL).toBeUndefined();
  });

  it("非法配置返回 400 且不覆盖已有配置", async () => {
    const { app, manager } = await createApp();

    await app.inject({
      method: "POST",
      url: "/api/config",
      payload: {
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o",
        LLM_API_KEY: "sk-secret-123456",
      },
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/config",
      payload: {
        LLM_PROVIDER: "anthropic",
        LLM_MODEL: "",
      },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().success).toBe(false);
    expect(manager.load()).toMatchObject({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
    });
  });
});
