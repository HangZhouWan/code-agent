# First-Time Configuration Setup Wizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-time setup wizard that prompts for LLM model config (CLI via readline, web via SetupPage form), storing to `~/.code-agent/config.json`.

**Architecture:** Shared `GlobalConfigManager` in `@code-agent/core` handles read/write/validate of global config. CLI and server each check config before full startup; if missing, CLI runs interactive prompts, server enters downgrade mode (config API only) so the web SetupPage can render.

**Tech Stack:** TypeScript, Node.js fs/os/readline, React + Tailwind CSS v4, Fastify, Zod, Vitest

## Global Constraints

- Config file lives at `~/.code-agent/config.json`
- Schema: LLM_PROVIDER, LLM_MODEL, LLM_API_KEY (required), LLM_BASE_URL (optional)
- Existing layered config loading in CLI must keep working
- Server downgrade mode must not initialize LLM/agents/DB
- Web API calls use relative paths (`/api/...`)
- All packages use ESM (`"type": "module"`)
- Tests use vitest

---

### Task 1: Create GlobalConfigManager in core package

**Files:**
- Create: `packages/core/src/config/global-config.ts`
- Create: `packages/core/src/config/index.ts`
- Modify: `packages/core/src/index.ts:10` (add export line)

**Interfaces:**
- Produces: `GlobalConfigManager` class with `getConfigPath()`, `isConfigured()`, `load()`, `save()`
- Produces: `GlobalConfig` type, `globalConfigSchema` Zod schema

- [ ] **Step 1: Create global-config.ts**

```typescript
/**
 * GlobalConfigManager —— 全局用户配置读写
 *
 * 管理 ~/.code-agent/config.json 的读取、校验和写入。
 * CLI 和 Web 端共享此模块，保证配置格式一致。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { z } from "zod";

// ─── Schema ────────────────────────────────────────

/**
 * 全局配置文件 JSON Schema
 *
 * 仅包含模型相关配置。与 CLI config-loader 中的 configFileSchema 保持兼容。
 */
export const globalConfigSchema = z.object({
  /** LLM provider */
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]),
  /** Model name */
  LLM_MODEL: z.string().min(1),
  /** API key */
  LLM_API_KEY: z.string().min(1),
  /** Custom API endpoint (optional) */
  LLM_BASE_URL: z.string().optional(),
});

/** 从 Schema 推导的全局配置类型 */
export type GlobalConfig = z.infer<typeof globalConfigSchema>;

// ─── Config Path ───────────────────────────────────

/** 全局配置文件路径：~/.code-agent/config.json */
function getConfigPath(): string {
  return join(homedir(), ".code-agent", "config.json");
}

// ─── Manager ───────────────────────────────────────

export class GlobalConfigManager {
  /**
   * 获取配置文件路径。
   */
  getConfigPath(): string {
    return getConfigPath();
  }

  /**
   * 检查全局配置是否已就绪。
   *
   * 条件：文件存在 + JSON 格式正确 + schema 校验通过。
   * 不满足任一条件返回 false。
   */
  isConfigured(): boolean {
    try {
      if (!existsSync(getConfigPath())) return false;
      const raw = readFileSync(getConfigPath(), "utf-8");
      const parsed = JSON.parse(raw);
      const result = globalConfigSchema.safeParse(parsed);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * 读取并校验全局配置。
   *
   * @returns 校验通过的配置对象，失败时返回 null
   */
  load(): GlobalConfig | null {
    try {
      if (!existsSync(getConfigPath())) return null;
      const raw = readFileSync(getConfigPath(), "utf-8");
      const parsed = JSON.parse(raw);
      const result = globalConfigSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  /**
   * 写入全局配置到 ~/.code-agent/config.json。
   *
   * 自动创建 .code-agent 目录（如果不存在）。
   * 写入前会先校验数据格式。
   *
   * @param config - 待写入的配置
   * @throws {z.ZodError} 数据校验失败时抛出
   */
  save(config: GlobalConfig): void {
    // 先校验
    globalConfigSchema.parse(config);

    const configPath = getConfigPath();
    const dir = dirname(configPath);

    // 确保目录存在
    mkdirSync(dir, { recursive: true });

    // 写入 JSON（pretty-print，方便用户手动编辑）
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
}
```

- [ ] **Step 2: Create barrel export index.ts**

```typescript
export { GlobalConfigManager, globalConfigSchema } from "./global-config.js";
export type { GlobalConfig } from "./global-config.js";
```

- [ ] **Step 3: Wire into core/index.ts**

In `packages/core/src/index.ts`, add after the LLM abstraction line (line 10):

```typescript
// 全局配置管理
export { GlobalConfigManager, globalConfigSchema } from "./config/index.js";
export type { GlobalConfig } from "./config/index.js";
```

- [ ] **Step 4: Typecheck core package**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/ packages/core/src/index.ts
git commit -m "feat(core): add GlobalConfigManager for shared config read/write"
```

---

### Task 2: Update CLI config-loader to reuse shared schema

**Files:**
- Modify: `packages/cli/src/config-loader.ts:21-34` (replace local configFileSchema with import from core)

**Interfaces:**
- Consumes: `globalConfigSchema` from `@code-agent/core`
- Produces: unchanged `loadConfig()` API, same behavior

- [ ] **Step 1: Add import and replace local schema**

In `packages/cli/src/config-loader.ts`, add import at line 17:

```typescript
import { globalConfigSchema } from "@code-agent/core";
```

Replace lines 21-34 (the local `configFileSchema` definition) with:

```typescript
/**
 * Config file schema — reuses the shared global schema from core,
 * extended with additional fields that the layered config loader handles.
 */
const configFileSchema = globalConfigSchema.extend({
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]).optional(),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MAX_RETRIES: z.coerce.number().optional(),
  WORKSPACE_PATH: z.string().optional(),
});
```

Note: The `.extend()` re-declares LLM_PROVIDER/LLM_MODEL/LLM_API_KEY as `.optional()` because in the layered loading context, these fields may come from other layers (like .env) and shouldn't be required at the file level.

- [ ] **Step 2: Typecheck CLI package**

Run: `cd packages/cli && npx tsc --noEmit`
Expected: No type errors. The `configFileSchema` still produces `ConfigFileData` with same shape.

- [ ] **Step 3: Run existing tests**

Run: `cd packages/core && npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/config-loader.ts
git commit -m "refactor(cli): reuse GlobalConfigManager schema in config-loader"
```

---

### Task 3: Create CLI setup wizard

**Files:**
- Create: `packages/cli/src/setup-wizard.ts`

**Interfaces:**
- Consumes: `GlobalConfigManager` from `@code-agent/core`
- Produces: `runSetupWizard(configManager: GlobalConfigManager): Promise<void>`

- [ ] **Step 1: Create setup-wizard.ts**

```typescript
/**
 * CLI 首次配置引导
 *
 * 当 ~/.code-agent/config.json 缺失或无效时，通过 readline 交互式
 * 收集 LLM 模型配置并写入全局配置。
 */

import * as readline from "node:readline";
import type { GlobalConfigManager, GlobalConfig } from "@code-agent/core";

// ─── Provider defaults ─────────────────────────────

const PROVIDER_OPTIONS = [
  { value: "openai" as const, label: "OpenAI", defaultModel: "gpt-4o" },
  { value: "anthropic" as const, label: "Anthropic", defaultModel: "claude-sonnet-4-5" },
  { value: "openai-compatible" as const, label: "OpenAI 兼容 (Ollama / LM Studio)", defaultModel: "llama3" },
];

// ─── Prompt helpers ────────────────────────────────

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function providerMenu(): string {
  let menu = "\n请选择 LLM Provider:\n";
  for (let i = 0; i < PROVIDER_OPTIONS.length; i++) {
    menu += `  [${i + 1}] ${PROVIDER_OPTIONS[i].label}\n`;
  }
  menu += "请输入数字 (1-3): ";
  return menu;
}

// ─── Main Wizard ───────────────────────────────────

export async function runSetupWizard(configManager: GlobalConfigManager): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n" + "=".repeat(50));
  console.log("  欢迎使用 code-agent！");
  console.log("  首次使用，请配置 LLM 模型。");
  console.log("=".repeat(50));

  // ── Step 1: Provider ──
  let providerIndex = -1;
  while (providerIndex < 0 || providerIndex >= PROVIDER_OPTIONS.length) {
    const answer = await question(rl, providerMenu());
    const n = parseInt(answer, 10);
    if (n >= 1 && n <= PROVIDER_OPTIONS.length) {
      providerIndex = n - 1;
    } else {
      console.log("  请输入 1-3 之间的数字。");
    }
  }
  const provider = PROVIDER_OPTIONS[providerIndex];

  // ── Step 2: Model ──
  const model =
    (await question(rl, `模型名称 [${provider.defaultModel}]: `)) || provider.defaultModel;

  // ── Step 3: API Key ──
  let apiKey = "";
  while (!apiKey) {
    apiKey = await question(rl, "API Key (必填，注意不要泄露给他人): ");
    if (!apiKey) {
      console.log("  API Key 为必填项，请输入。");
    }
  }

  // ── Step 4: Base URL (optional) ──
  const baseURL = await question(rl, "自定义 API 端点 (可选，直接回车跳过): ");

  // ── Build config ──
  const config: GlobalConfig = {
    LLM_PROVIDER: provider.value,
    LLM_MODEL: model,
    LLM_API_KEY: apiKey,
    ...(baseURL ? { LLM_BASE_URL: baseURL } : {}),
  };

  // ── Save ──
  try {
    configManager.save(config);
    console.log(`\n✓ 配置已保存到 ${configManager.getConfigPath()}`);
  } catch (err) {
    console.error("\n✗ 保存配置失败:", err instanceof Error ? err.message : String(err));
    rl.close();
    process.exit(1);
  }

  console.log("  正在启动...\n");
  rl.close();
}
```

- [ ] **Step 2: Typecheck CLI package**

Run: `cd packages/cli && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/setup-wizard.ts
git commit -m "feat(cli): add interactive setup wizard for first-time config"
```

---

### Task 4: Integrate setup wizard into CLI entry

**Files:**
- Modify: `packages/cli/src/index.ts:426-448` (main function, insert config check before bootstrap)

**Interfaces:**
- Consumes: `runSetupWizard` from `./setup-wizard.js`, `GlobalConfigManager` from `@code-agent/core`

- [ ] **Step 1: Add imports in index.ts**

In `packages/cli/src/index.ts`, after line 19 (`import { getDataDir, getCheckpointDir } from "./paths.js";`), add:

```typescript
import { GlobalConfigManager } from "@code-agent/core";
import { runSetupWizard } from "./setup-wizard.js";
```

- [ ] **Step 2: Insert config check in main()**

In `packages/cli/src/index.ts`, after the workspacePath resolution block (approximately line 448-449: `console.log(\`[config] Workspace: ${workspacePath}\`);`), add:

```typescript
  // 1a. First-time setup: check global config before bootstrap
  const configManager = new GlobalConfigManager();
  if (!configManager.isConfigured()) {
    await runSetupWizard(configManager);
  }
```

- [ ] **Step 3: Typecheck CLI package**

Run: `cd packages/cli && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Run core tests to verify no regression**

Run: `cd packages/core && npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): trigger setup wizard on first run when config is missing"
```

---

### Task 5: Create server config API routes

**Files:**
- Create: `packages/server/src/gateway/routes/config.ts`

**Interfaces:**
- Consumes: `GlobalConfigManager` from `@code-agent/core`
- Produces: Fastify plugin with `GET /api/config/status` and `POST /api/config`

- [ ] **Step 1: Create config.ts route file**

```typescript
/**
 * 全局配置管理 HTTP 路由
 *
 * 提供首次配置引导所需的 API 端点。
 *
 * | 方法 | 路径               | 说明                       |
 * |------|--------------------|----------------------------|
 * | GET  | /api/config/status | 检查配置是否已就绪         |
 * | POST | /api/config        | 保存全局配置               |
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { GlobalConfigManager } from "@code-agent/core";
import { z } from "zod";

// ─── POST body schema ─────────────────────────────

const saveConfigSchema = z.object({
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]),
  LLM_MODEL: z.string().min(1, "模型名称不能为空"),
  LLM_API_KEY: z.string().min(1, "API Key 不能为空"),
  LLM_BASE_URL: z.string().optional(),
});

// ─── Plugin ────────────────────────────────────────

const configRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const configManager = new GlobalConfigManager();

  /**
   * GET /api/config/status —— 检查全局配置是否已就绪
   *
   * Response 200:
   * { setupRequired: boolean }
   */
  app.get("/config/status", async (_request, reply) => {
    const setupRequired = !configManager.isConfigured();
    reply.status(200).send({ setupRequired });
  });

  /**
   * POST /api/config —— 保存全局配置
   *
   * Request body:
   * { LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, LLM_BASE_URL? }
   *
   * Response 200:
   * { success: true, path: string }
   *
   * Response 400:
   * { success: false, error: string }
   */
  app.post("/config", async (request, reply) => {
    const parsed = saveConfigSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.status(400).send({
        success: false,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    try {
      configManager.save(parsed.data);
      reply.status(200).send({
        success: true,
        path: configManager.getConfigPath(),
      });
    } catch (err) {
      reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : "保存配置失败",
      });
    }
  });
};

export default configRoutes;
```

- [ ] **Step 2: Typecheck server package**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/gateway/routes/config.ts
git commit -m "feat(server): add config status and save API endpoints"
```

---

### Task 6: Modify server entry for downgrade mode + route registration

**Files:**
- Modify: `packages/server/src/gateway/server.ts:27-30` (import config routes)
- Modify: `packages/server/src/gateway/server.ts:165-170` (register config routes)
- Modify: `packages/server/src/index.ts:99-281` (main function, add downgrade path)

**Interfaces:**
- Consumes: `configRoutes` from `./routes/config.js`, `GlobalConfigManager` from `@code-agent/core`

- [ ] **Step 1: Register config routes in server.ts**

In `packages/server/src/gateway/server.ts`, add import at line 30 (after `import agentRoutes from "./routes/agents.js";`):

```typescript
import configRoutes from "./routes/config.js";
```

In the route registration section (after line 165 `await app.register(sessionRoutes, { prefix: "/api" });`), add:

```typescript
  // Config management routes (always available, even in downgrade mode)
  await app.register(configRoutes, { prefix: "/api" });
```

Note: Config routes must be registered unconditionally (not gated by agentRegistry) so they work in downgrade mode.

- [ ] **Step 2: Add downgrade mode to server index.ts**

In `packages/server/src/index.ts`, add import at line 22 (after the `import dotenv from "dotenv";` section):

```typescript
import { GlobalConfigManager } from "@code-agent/core";
```

Then modify the `main()` function. The current structure is:

```
async function main() {
  // header
  // 1. loadConfig() → cfg
  // 2-8. create model, tools, agents, DB, server
  // 9. listen
}
```

Replace the body of `main()` (from line 99) with the version below. The key change: insert a config check between the header and step 1, and branch into downgrade mode when config is missing:

```typescript
async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log("  code-agent server v" + SERVER_VERSION);
  console.log("=".repeat(50));

  // 0. Check global config — if missing, enter downgrade mode
  const configManager = new GlobalConfigManager();
  if (!configManager.isConfigured()) {
    console.log("[config] Global config not found — entering downgrade mode (setup required)");
    console.log("[config] Visit the web UI to configure your LLM model, or run 'code-agent' CLI first.");

    const app = Fastify({ logger: true });
    await app.register(fastifyCors, { origin: true });
    app.setErrorHandler(errorHandler);
    await app.register(configRoutes, { prefix: "/api" });

    await app.listen({ host: "0.0.0.0", port: 3000 });
    console.log("[server] Downgrade mode — config API only at http://0.0.0.0:3000");
    console.log("[server] Configure your LLM model at GET/POST /api/config, then restart.");

    const shutdown = async () => {
      console.log("\n[server] Shutting down...");
      await app.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  // ── Normal startup below (unchanged from original) ──

  // 1. 加载配置
  const cfg = loadConfig();
  // ... rest of original main() unchanged ...
```

Note: The downgrade mode imports `Fastify`, `fastifyCors`, `errorHandler`, and `configRoutes` at the top of the file. These are already imported (Fastify, fastifyCors, errorHandler are in `server.ts` but not in `index.ts`). We need to add these imports to `index.ts`.

- [ ] **Step 3: Add missing imports to server index.ts**

In `packages/server/src/index.ts`, add imports at the top (after the existing import block around line 18):

```typescript
import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { errorHandler } from "./gateway/middleware/error.js";
import configRoutes from "./gateway/routes/config.js";
import { GlobalConfigManager } from "@code-agent/core";
```

Remove the duplicate `GlobalConfigManager` import from Step 2 if already added.

- [ ] **Step 4: Typecheck server package**

Run: `cd packages/server && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Run server tests**

Run: `cd packages/server && npx vitest run`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/gateway/server.ts
git commit -m "feat(server): add downgrade mode when global config is missing"
```

---

### Task 7: Create web SetupPage component

**Files:**
- Create: `packages/web/src/components/SetupPage.tsx`

**Interfaces:**
- Consumes: `POST /api/config`, `GET /api/config/status`
- Produces: React component with form for LLM config

- [ ] **Step 1: Create SetupPage.tsx**

```typescript
/**
 * SetupPage —— 首次配置引导页面
 *
 * 当服务端未配置 LLM 模型时展示，提供 Provider、模型、
 * API Key 和自定义端点的表单，提交后保存到 ~/.code-agent/config.json。
 */

import { useState, useEffect } from "react";

// ─── Types ─────────────────────────────────────────

type Provider = "openai" | "anthropic" | "openai-compatible";

interface ProviderOption {
  value: Provider;
  label: string;
  defaultModel: string;
}

const PROVIDERS: ProviderOption[] = [
  { value: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
  { value: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-5" },
  { value: "openai-compatible", label: "OpenAI 兼容 (Ollama / LM Studio)", defaultModel: "llama3" },
];

// ─── Component ─────────────────────────────────────

export function SetupPage() {
  const [checking, setChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state
  const [provider, setProvider] = useState<Provider>("openai");
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // ── Check config on mount ──
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/config/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSetupRequired(data.setupRequired);
      } catch (err) {
        // If config API is unreachable, assume setup is required
        setSetupRequired(true);
      } finally {
        setChecking(false);
      }
    }
    check();
  }, []);

  // ── Sync model default when provider changes ──
  const handleProviderChange = (value: Provider) => {
    setProvider(value);
    const option = PROVIDERS.find((p) => p.value === value);
    if (option) setModel(option.defaultModel);
  };

  // ── Submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          LLM_PROVIDER: provider,
          LLM_MODEL: model,
          LLM_API_KEY: apiKey,
          ...(baseUrl ? { LLM_BASE_URL: baseUrl } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || `请求失败 (${res.status})`);
        return;
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络请求失败，请检查服务是否运行");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading state ──
  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-400">正在检查配置...</p>
      </div>
    );
  }

  // ── Already configured — shouldn't normally reach here ──
  if (!setupRequired && !success) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-400">配置已就绪，请刷新页面。</p>
      </div>
    );
  }

  // ── Success ──
  if (success) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="w-full max-w-md rounded-xl border border-green-800 bg-gray-900 p-8 text-center">
          <div className="mb-4 text-4xl">✓</div>
          <h2 className="mb-2 text-xl font-semibold text-green-400">配置已保存</h2>
          <p className="mb-6 text-gray-400">
            配置已写入服务器。请重启服务以加载新配置，然后刷新此页面。
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-green-700 px-6 py-2 text-white hover:bg-green-600 transition-colors"
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }

  // ── Setup form ──
  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-8">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">⚡</div>
          <h1 className="text-2xl font-bold text-white">欢迎使用 code-agent</h1>
          <p className="mt-2 text-sm text-gray-400">请配置您的 LLM 模型以开始使用</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Provider */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              Provider
            </label>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as Provider)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              模型名称
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              API Key <span className="text-red-400">*</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              自定义 API 端点 <span className="text-gray-500">(可选)</span>
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !apiKey.trim()}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            {submitting ? "保存中..." : "保存配置"}
          </button>
        </form>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-500">
          配置将保存到 ~/.code-agent/config.json
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck web package**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/SetupPage.tsx
git commit -m "feat(web): add SetupPage component for first-time LLM config"
```

---

### Task 8: Integrate SetupPage into App.tsx

**Files:**
- Modify: `packages/web/src/App.tsx:19-63` (add config check, conditional rendering)

**Interfaces:**
- Consumes: `SetupPage` from `./components/SetupPage.js`

- [ ] **Step 1: Modify App.tsx**

Replace `packages/web/src/App.tsx` entirely:

```typescript
/**
 * 根组件 App
 *
 * 通用 AI Agent 平台的主界面入口。
 *
 * 启动时检查服务端配置状态：
 * - 未配置 → 渲染 SetupPage（首次配置引导）
 * - 已配置 → 渲染正常聊天界面（Sidebar + ChatArea）
 *
 * 布局：
 * ┌──────────────────────────────────────┐
 * │  Sidebar (w-64)  │  ChatArea (flex-1) │
 * │  bg-gray-900     │  bg-gray-950       │
 * │  border-r        │                    │
 * └──────────────────────────────────────┘
 */

import { useState, useCallback, useEffect } from "react";
import { useSessions } from "./hooks/useSessions.js";
import { Sidebar } from "./components/Sidebar.js";
import { ChatArea } from "./components/ChatArea.js";
import { SetupPage } from "./components/SetupPage.js";

// ─── Component ─────────────────────────────────────

export function App() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const { sessions, loading, createSession, deleteSession, updateTitle } =
    useSessions();

  // ── Check config status on mount ──
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/config/status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSetupRequired(data.setupRequired);
      } catch {
        // If unreachable, assume setup is required
        setSetupRequired(true);
      }
    }
    check();
  }, []);

  // ── WebSocket 推送标题时更新侧边栏 ──
  const handleTitleUpdated = useCallback(
    (sessionId: string, title: string) => {
      if (activeSessionId && activeSessionId === sessionId) {
        updateTitle(activeSessionId, title);
      }
    },
    [activeSessionId, updateTitle],
  );

  // ── Still checking ──
  if (setupRequired === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <p className="text-gray-400">正在检查配置...</p>
      </div>
    );
  }

  // ── Setup required ──
  if (setupRequired) {
    return <SetupPage />;
  }

  // ── Normal mode ──
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* ── 侧边栏 ── */}
      <Sidebar
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        sessions={sessions}
        loading={loading}
        onCreateSession={createSession}
        onDeleteSession={deleteSession}
        onUpdateTitle={updateTitle}
      />

      {/* ── 聊天区域 ── */}
      <ChatArea
        sessionId={activeSessionId}
        onTitleUpdated={handleTitleUpdated}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck web package**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run web tests**

Run: `cd packages/web && npx vitest run`
Expected: Existing tests pass. (SetupPage is only rendered when `setupRequired === true`, which won't happen in tests without the config API.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(web): render SetupPage when server config is missing"
```

---

### Task 9: Final integration verification

- [ ] **Step 1: Run all tests**

```bash
cd packages/core && npx vitest run
cd packages/server && npx vitest run
cd packages/web && npx vitest run
```
Expected: All tests pass across all packages.

- [ ] **Step 2: Verify TypeScript across all packages**

```bash
cd packages/core && npx tsc --noEmit
cd packages/cli && npx tsc --noEmit
cd packages/server && npx tsc --noEmit
cd packages/web && npx tsc --noEmit
```
Expected: All packages typecheck without errors.

- [ ] **Step 3: Verify no uncommitted changes**

```bash
git status
```
Expected: Clean working tree.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A
git commit -m "chore: final verification — all tests pass, all packages typecheck"
```
