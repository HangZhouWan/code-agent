/**
 * 统一配置加载器测试
 *
 * 覆盖：路径解析、分层优先级、API Key 校验、全局配置原子写/掩码。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GlobalConfigManager, maskApiKey } from "../global-config.js";
import { findMonorepoRoot, loadConfig } from "../loader.js";
import {
  expandHomePath,
  resolvePaths,
  workspaceToSlug,
} from "../paths.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `code-agent-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

/** 创建 monorepo + workspace 结构 */
function makeWorkspace(): { root: string; workspace: string } {
  const root = makeTempDir("mono");
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  const workspace = join(root, "packages", "app");
  mkdirSync(workspace, { recursive: true });
  return { root, workspace };
}

beforeEach(() => {
  tempDirs.length = 0;
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
});

describe("workspaceToSlug / expandHomePath / resolvePaths", () => {
  it("expandHomePath 只展开开头的 ~", () => {
    expect(expandHomePath("~/projects/app", "/home/me")).toBe(
      "/home/me/projects/app",
    );
    expect(expandHomePath("~", "/home/me")).toBe("/home/me");
    expect(expandHomePath("/abs/path", "/home/me")).toBe("/abs/path");
    expect(expandHomePath("relative/path", "/home/me")).toBe("relative/path");
  });

  it("将绝对路径转换为 slug", () => {
    expect(workspaceToSlug("/Users/qichen/projects/my-app")).toBe(
      "-Users-qichen-projects-my-app",
    );
  });

  it("默认使用工作区 .agent 目录并派生数据库路径", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");

    const paths = resolvePaths({
      workspacePath: workspace,
      homeDir: home,
      env: {},
      createDirs: true,
    });

    expect(paths.workspacePath).toBe(workspace);
    expect(paths.dataDir).toBe(join(workspace, ".agent", "data"));
    expect(paths.checkpointDir).toBe(
      join(workspace, ".agent", "runtime", "checkpoints"),
    );
    expect(paths.artifactsDir).toBe(join(workspace, ".agent", "artifacts"));
    expect(paths.dbPath).toBe(join(paths.dataDir, "code-agent.db"));
    expect(paths.globalConfigPath).toBe(
      join(home, ".code-agent", "config.json"),
    );
    expect(existsSync(paths.dataDir)).toBe(true);
  });

  it("DB_PATH 环境变量覆盖默认数据库路径", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");
    const customDb = join(home, "custom.db");

    const paths = resolvePaths({
      workspacePath: workspace,
      homeDir: home,
      env: { DB_PATH: customDb },
      createDirs: true,
    });

    expect(paths.dbPath).toBe(customDb);
  });

  it("findMonorepoRoot 能从工作区向上找到 pnpm-workspace.yaml", () => {
    const { root, workspace } = makeWorkspace();
    expect(findMonorepoRoot(workspace)).toBe(root);
  });
});

describe("loadConfig 分层优先级", () => {
  it("全局配置提供 provider/model/key", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");
    writeJson(join(home, ".code-agent", "config.json"), {
      LLM_PROVIDER: "openai",
      LLM_MODEL: "global-model",
      LLM_API_KEY: "global-key",
    });

    const config = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: {},
      logger: () => {},
    });

    expect(config.LLM_MODEL).toBe("global-model");
    expect(config.LLM_API_KEY).toBe("global-key");
    expect(config.LLM_MAX_RETRIES).toBe(3);
  });

  it("项目配置覆盖全局配置", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");
    writeJson(join(home, ".code-agent", "config.json"), {
      LLM_PROVIDER: "openai",
      LLM_MODEL: "global-model",
      LLM_API_KEY: "global-key",
    });
    writeJson(join(workspace, ".code-agent", "config.json"), {
      LLM_MODEL: "project-model",
    });

    const config = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: {},
      logger: () => {},
    });

    expect(config.LLM_MODEL).toBe("project-model");
    expect(config.LLM_API_KEY).toBe("global-key");
  });

  it("monorepo .env 覆盖 workspace .env，process.env 再覆盖 .env", () => {
    const { root, workspace } = makeWorkspace();
    const home = makeTempDir("home");
    writeFileSync(
      join(workspace, ".env"),
      "LLM_MODEL=workspace-env\nLLM_API_KEY=workspace-key\n",
    );
    writeFileSync(
      join(root, ".env"),
      "LLM_MODEL=mono-env\nLLM_API_KEY=mono-key\n",
    );

    const fromEnvFile = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: {},
      logger: () => {},
    });
    expect(fromEnvFile.LLM_MODEL).toBe("mono-env");
    expect(fromEnvFile.LLM_API_KEY).toBe("mono-key");

    const fromProcess = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: {
        LLM_MODEL: "process-model",
        LLM_API_KEY: "process-key",
      },
      logger: () => {},
    });
    expect(fromProcess.LLM_MODEL).toBe("process-model");
    expect(fromProcess.LLM_API_KEY).toBe("process-key");
  });

  it("全局配置的 WORKSPACE_PATH 作为默认工作目录", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");
    writeJson(join(home, ".code-agent", "config.json"), {
      LLM_PROVIDER: "openai",
      LLM_MODEL: "global-model",
      LLM_API_KEY: "global-key",
      WORKSPACE_PATH: workspace,
    });

    const config = loadConfig({
      homeDir: home,
      cwd: makeTempDir("other-cwd"),
      env: {},
      logger: () => {},
    });

    expect(config.WORKSPACE_PATH).toBe(workspace);
    expect(config.paths.workspacePath).toBe(workspace);
  });

  it("显式 workspacePath / 环境变量优先于全局配置工作目录", () => {
    const { workspace } = makeWorkspace();
    const explicit = makeTempDir("explicit");
    const fromEnv = makeTempDir("from-env");
    const home = makeTempDir("home");
    writeJson(join(home, ".code-agent", "config.json"), {
      LLM_PROVIDER: "openai",
      LLM_MODEL: "global-model",
      LLM_API_KEY: "global-key",
      WORKSPACE_PATH: workspace,
    });

    const envConfig = loadConfig({
      homeDir: home,
      cwd: makeTempDir("other-cwd"),
      env: { WORKSPACE_PATH: fromEnv },
      logger: () => {},
    });
    expect(envConfig.WORKSPACE_PATH).toBe(fromEnv);

    const explicitConfig = loadConfig({
      workspacePath: explicit,
      homeDir: home,
      cwd: makeTempDir("other-cwd"),
      env: { WORKSPACE_PATH: fromEnv },
      logger: () => {},
    });
    expect(explicitConfig.WORKSPACE_PATH).toBe(explicit);
  });

  it("LLM_MAX_TOKENS 可从全局配置读取", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");
    writeJson(join(home, ".code-agent", "config.json"), {
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "global-key",
      LLM_MAX_TOKENS: 8192,
    });

    const config = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: {},
      logger: () => {},
    });
    expect(config.LLM_MAX_TOKENS).toBe(8192);
  });

  it("AUTO_MODE 从全局配置读取，环境变量可覆盖", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");
    writeJson(join(home, ".code-agent", "config.json"), {
      LLM_PROVIDER: "openai",
      LLM_MODEL: "global-model",
      LLM_API_KEY: "global-key",
      AUTO_MODE: true,
    });

    const fromGlobal = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: {},
      logger: () => {},
    });
    expect(fromGlobal.AUTO_MODE).toBe(true);

    const fromEnv = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: { AUTO_MODE: "false" },
      logger: () => {},
    });
    expect(fromEnv.AUTO_MODE).toBe(false);
  });

  it("overrides 与 cliModel 具有最高优先级", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");

    const config = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: { LLM_MODEL: "env-model", LLM_API_KEY: "env-key" },
      overrides: { LLM_MODEL: "override-model" },
      cliModel: "cli-model",
      logger: () => {},
    });

    expect(config.LLM_MODEL).toBe("cli-model");
    expect(config.LLM_API_KEY).toBe("env-key");
  });

  it("应用默认值：HOST / PORT / DB_PATH / context", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");

    const config = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: { LLM_API_KEY: "sk-test", LLM_PROVIDER: "openai" },
      logger: () => {},
    });

    expect(config.HOST).toBe("127.0.0.1");
    expect(config.PORT).toBe(3000);
    expect(config.DB_PATH).toBe(join(workspace, ".agent", "data", "code-agent.db"));
    expect(config.CONTEXT.CONTEXT_SOFT_THRESHOLD).toBeLessThan(
      config.CONTEXT.CONTEXT_HARD_THRESHOLD,
    );
    expect(config.paths.workspacePath).toBe(workspace);
  });

  it("需要 API Key 的 provider 缺少 key 时抛错", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");

    expect(() =>
      loadConfig({
        workspacePath: workspace,
        homeDir: home,
        env: {},
        logger: () => {},
      }),
    ).toThrow();
  });

  it("openai-compatible 允许没有 API Key", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");

    const config = loadConfig({
      workspacePath: workspace,
      homeDir: home,
      env: { LLM_PROVIDER: "openai-compatible", LLM_MODEL: "llama3" },
      logger: () => {},
    });

    expect(config.LLM_API_KEY).toBe("");
    expect(config.LLM_PROVIDER).toBe("openai-compatible");
  });

  it("不当的数值环境变量会触发校验错误", () => {
    const { workspace } = makeWorkspace();
    const home = makeTempDir("home");

    expect(() =>
      loadConfig({
        workspacePath: workspace,
        homeDir: home,
        env: { LLM_API_KEY: "sk-test", PORT: "not-a-number" },
        logger: () => {},
      }),
    ).toThrow();
  });
});

describe("GlobalConfigManager", () => {
  it("保存后 isConfigured 为 true，且文件权限为 0600", () => {
    const home = makeTempDir("home");
    const manager = new GlobalConfigManager({ homeDir: home });

    manager.save({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-123456789",
    });

    expect(manager.isConfigured()).toBe(true);
    const loaded = manager.load();
    expect(loaded?.LLM_MAX_RETRIES).toBe(3);
    expect(statSync(manager.getConfigPath()).mode & 0o777).toBe(0o600);
  });

  it("保存并读取 WORKSPACE_PATH，masked 中保留该值", () => {
    const home = makeTempDir("home");
    const manager = new GlobalConfigManager({ homeDir: home });
    manager.save({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-123456789",
      WORKSPACE_PATH: "/Users/me/projects/app",
    });

    expect(manager.load()?.WORKSPACE_PATH).toBe("/Users/me/projects/app");
    expect(manager.masked()?.WORKSPACE_PATH).toBe("/Users/me/projects/app");
  });

  it("保存并读取 AUTO_MODE", () => {
    const home = makeTempDir("home");
    const manager = new GlobalConfigManager({ homeDir: home });
    manager.save({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-123456789",
      AUTO_MODE: true,
    });

    expect(manager.load()?.AUTO_MODE).toBe(true);
    expect(manager.masked()?.AUTO_MODE).toBe(true);
  });

  it("masked 不泄露完整 API Key", () => {
    const home = makeTempDir("home");
    const manager = new GlobalConfigManager({ homeDir: home });
    manager.save({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-123456789",
    });

    expect(manager.masked()?.LLM_API_KEY).toBe("sk-1...6789");
    expect(maskApiKey("short")).toBe("***");
  });

  it("损坏或非法的配置文件视为未配置", () => {
    const home = makeTempDir("home");
    const manager = new GlobalConfigManager({ homeDir: home });
    mkdirSync(join(home, ".code-agent"), { recursive: true });
    writeFileSync(manager.getConfigPath(), "{not-json", "utf-8");

    expect(manager.isConfigured()).toBe(false);
    expect(manager.load()).toBeNull();
  });

  it("openai-compatible 没有 API Key 也算已配置", () => {
    const home = makeTempDir("home");
    const manager = new GlobalConfigManager({ homeDir: home });
    manager.save({
      LLM_PROVIDER: "openai-compatible",
      LLM_MODEL: "llama3",
    });

    expect(manager.isConfigured()).toBe(true);
  });

  it("保存失败时不会留下写到一半的文件", () => {
    const home = makeTempDir("home");
    const manager = new GlobalConfigManager({ homeDir: home });

    expect(() =>
      manager.save({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-4o",
        LLM_API_KEY: "",
      }),
    ).toThrow();
    expect(existsSync(manager.getConfigPath())).toBe(false);
  });

  it("默认构造读取 CODE_AGENT_HOME，与统一 loader 一致", () => {
    const previous = process.env.CODE_AGENT_HOME;
    const customHome = makeTempDir("custom-home");
    process.env.CODE_AGENT_HOME = customHome;
    try {
      const manager = new GlobalConfigManager();
      expect(manager.getConfigPath()).toBe(join(customHome, "config.json"));
    } finally {
      if (previous === undefined) delete process.env.CODE_AGENT_HOME;
      else process.env.CODE_AGENT_HOME = previous;
    }
  });

  it("原子写覆盖旧内容后内容完整", () => {
    const home = makeTempDir("home");
    const manager = new GlobalConfigManager({ homeDir: home });
    manager.save({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o",
      LLM_API_KEY: "sk-old",
    });
    manager.save({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4.1",
      LLM_API_KEY: "sk-new",
    });

    const raw = JSON.parse(readFileSync(manager.getConfigPath(), "utf-8"));
    expect(raw.LLM_MODEL).toBe("gpt-4.1");
    expect(raw.LLM_API_KEY).toBe("sk-new");
  });
});
