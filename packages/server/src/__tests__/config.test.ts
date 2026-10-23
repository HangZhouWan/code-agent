/**
 * Server 配置入口测试
 *
 * 配置合并逻辑由 core 统一实现；这里验证 server 包装层与默认值。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `code-agent-server-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function baseOptions(workspacePath: string, homeDir: string) {
  return {
    workspacePath,
    homeDir,
    cwd: workspacePath,
    loadDotEnv: false,
    logger: () => {},
  } as const;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadConfig", () => {
  it("加载完整配置并应用默认值", () => {
    const workspace = makeTempDir("workspace");
    const home = makeTempDir("home");

    const cfg = loadConfig({
      ...baseOptions(workspace, home),
      env: {
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o",
        LLM_API_KEY: "sk-test",
      },
    });

    expect(cfg.LLM_PROVIDER).toBe("openai");
    expect(cfg.LLM_MODEL).toBe("gpt-4o");
    expect(cfg.LLM_API_KEY).toBe("sk-test");
    expect(cfg.HOST).toBe("127.0.0.1");
    expect(cfg.PORT).toBe(3000);
    expect(cfg.WORKSPACE_PATH).toBe(workspace);
    expect(cfg.DB_PATH).toBe(join(workspace, ".agent", "data", "code-agent.db"));
    expect(cfg.paths.workspacePath).toBe(workspace);
  });

  it("环境变量覆盖默认值并做类型转换", () => {
    const workspace = makeTempDir("workspace");
    const home = makeTempDir("home");

    const cfg = loadConfig({
      ...baseOptions(workspace, home),
      env: {
        LLM_API_KEY: "sk-test",
        HOST: "0.0.0.0",
        PORT: "8080",
        LLM_MAX_RETRIES: "5",
      },
    });

    expect(cfg.HOST).toBe("0.0.0.0");
    expect(cfg.PORT).toBe(8080);
    expect(cfg.LLM_MAX_RETRIES).toBe(5);
  });

  it("读取全局 config.json（setup 写入后 server 可读）", () => {
    const workspace = makeTempDir("workspace");
    const home = makeTempDir("home");
    mkdirSync(join(home, ".code-agent"), { recursive: true });
    writeFileSync(
      join(home, ".code-agent", "config.json"),
      JSON.stringify({
        LLM_PROVIDER: "anthropic",
        LLM_MODEL: "claude-sonnet-4-5",
        LLM_API_KEY: "sk-ant-test",
      }),
      "utf-8",
    );

    const cfg = loadConfig({
      ...baseOptions(workspace, home),
      env: {},
    });

    expect(cfg.LLM_PROVIDER).toBe("anthropic");
    expect(cfg.LLM_MODEL).toBe("claude-sonnet-4-5");
    expect(cfg.LLM_API_KEY).toBe("sk-ant-test");
  });

  it("DB_PATH 可覆盖默认数据库位置", () => {
    const workspace = makeTempDir("workspace");
    const home = makeTempDir("home");
    const dbPath = join(home, "custom.db");

    const cfg = loadConfig({
      ...baseOptions(workspace, home),
      env: { LLM_API_KEY: "sk-test", DB_PATH: dbPath },
    });

    expect(cfg.DB_PATH).toBe(dbPath);
  });

  it("需要 API Key 的 provider 缺失 key 时抛错", () => {
    const workspace = makeTempDir("workspace");
    const home = makeTempDir("home");

    expect(() =>
      loadConfig({
        ...baseOptions(workspace, home),
        env: {},
      }),
    ).toThrow();
  });

  it("openai-compatible 允许无 API Key", () => {
    const workspace = makeTempDir("workspace");
    const home = makeTempDir("home");

    const cfg = loadConfig({
      ...baseOptions(workspace, home),
      env: {
        LLM_PROVIDER: "openai-compatible",
        LLM_MODEL: "llama3",
      },
    });

    expect(cfg.LLM_PROVIDER).toBe("openai-compatible");
    expect(cfg.LLM_API_KEY).toBe("");
  });
});
