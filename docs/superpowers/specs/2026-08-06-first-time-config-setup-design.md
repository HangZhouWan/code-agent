# First-Time Configuration Setup Wizard

**Date:** 2026-08-06
**Status:** approved

## Motivation

Currently there is no first-time setup flow. Users must manually create `~/.code-agent/config.json` or set environment variables before the CLI or web server will start. This creates a poor onboarding experience — the application should guide users through model configuration on first access.

## Requirements

1. **First-access detection**: Both CLI and web entry points detect whether global config exists and is valid
2. **Platform-native setup UI**: CLI uses terminal interactive prompts; web uses a browser-based form
3. **Single config source**: Both flows write to `~/.code-agent/config.json`
4. **Minimal config scope**: Provider, model, API key, and optional base URL only
5. **Keep existing layering**: Global → project → .env → process.env → CLI flags remains unchanged

## Design Decisions

### Why `~/.code-agent/config.json`?

The project already uses `~/.code-agent/` for global configuration and fallback data. Keeping this path avoids migration cost and maintains backward compatibility.

### Why a shared GlobalConfigManager in core?

CLI and web have different UX but identical storage logic (read, write, validate). Extracting this into `core` avoids duplication and ensures both paths stay in sync when the schema evolves.

### Why server downgrade mode?

When the server starts without valid config, it cannot initialize the LLM model or agent infrastructure. Rather than crashing, it starts minimally (only the config API endpoint) so the web UI can render the setup page. This avoids a chicken-and-egg problem where users need to configure the server but the server won't start.

## Architecture

```
packages/core/src/config/
└── global-config.ts       # GlobalConfigManager class

packages/cli/src/
├── setup-wizard.ts         # CLI interactive prompts
└── index.ts                # Added: config check before bootstrap

packages/server/src/
├── gateway/routes/config.ts  # GET /api/config/status, POST /api/config
└── index.ts                  # Added: downgrade mode on missing config

packages/web/src/
├── components/SetupPage.tsx  # Web config form
└── App.tsx                   # Added: conditional SetupPage vs ChatArea
```

## Data Flow

```
CLI:                                       Web:
  main()                                     Server main()
    │                                           │
    ▼                                           ▼
  GlobalConfigManager.isConfigured()          GlobalConfigManager.isConfigured()
    │                                           │
    ├── false ──► setup-wizard.ts              ├── false ──► downgrade mode
    │               (readline prompts)         │              App.tsx renders SetupPage
    │               save()                     │              POST /api/config → save()
    │               continue bootstrap()       │              reload
    │                                           │
    └── true ───► bootstrap()                  └── true ───► full startup
```

Both paths converge on `save()` → `~/.code-agent/config.json`.

## Components

### 1. GlobalConfigManager (`packages/core/src/config/global-config.ts`)

```
Config schema (configFileSchema):
  LLM_PROVIDER: "openai" | "anthropic" | "openai-compatible"
  LLM_MODEL: string
  LLM_API_KEY: string
  LLM_BASE_URL?: string

Class: GlobalConfigManager
  - getConfigPath(): string          // ~/.code-agent/config.json
  - isConfigured(): boolean          // file exists + valid + LLM_API_KEY non-empty
  - load(): GlobalConfig | null      // read + parse + validate
  - save(config: GlobalConfig): void // mkdir + write JSON (pretty-printed)
```

The schema definition lives in `GlobalConfigManager` as the single source of truth. `packages/cli/src/config-loader.ts` imports and reuses this schema (replacing its local `configFileSchema`). This avoids drift between the two files.

### 2. CLI Setup Wizard (`packages/cli/src/setup-wizard.ts`)

```
Sequence:
  1. Welcome banner ("首次使用，请配置 LLM 模型")
  2. Provider selection: [1] OpenAI  [2] Anthropic  [3] OpenAI 兼容
  3. Model name (with provider-aware default, e.g. gpt-4o / claude-sonnet-4-5)
  4. API key (warn user about security, no echo masking)
  5. Custom base URL (optional, can skip)
  6. Confirm & save → print path → continue

Implementation:
  - Uses Node.js built-in readline (already used in repl.ts)
  - Numbered menu for provider selection reduces input errors
  - Each prompt shows current default in brackets; Enter accepts default
```

Invoked from `main()` in `index.ts`, between args parsing and `bootstrap()`. Does not block if `isConfigured()` returns true.

### 3. Server Downgrade Mode

When `GlobalConfigManager.isConfigured()` returns false at startup:
- Fastify server starts in downgrade mode with only the config routes registered
- LLM model, ToolRegistry, Agent infrastructure, and DB are NOT initialized
- Other route handlers (chat, agents, tools, sessions) are not registered at all — requests to those paths get standard Fastify 404

When configuration is saved via POST:
- Server writes config file
- Returns `{ success: true, message: "请重启服务以加载新配置" }`
- User manually restarts, or server could auto-reload (future enhancement)

### 4. Config API Endpoints (`packages/server/src/gateway/routes/config.ts`)

| Method | Path | Request Body | Response |
|--------|------|-------------|----------|
| GET | `/api/config/status` | — | `{ setupRequired: boolean }` |
| POST | `/api/config` | `{ LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, LLM_BASE_URL? }` | `{ success: true }` or `{ success: false, error: string }` |

POST validates the input against the same schema. On success, calls `GlobalConfigManager.save()`.

### 5. Web SetupPage (`packages/web/src/components/SetupPage.tsx`)

Layout: centered card with form fields and a submit button.

```
State:
  - loading: boolean (initial status check)
  - setupRequired: boolean
  - provider, model, apiKey, baseUrl: form fields
  - submitting: boolean
  - error: string | null
  - success: boolean

Behavior:
  - On mount: GET /api/config/status
  - Provider dropdown changes model placeholder:
      openai → "gpt-4o"
      anthropic → "claude-sonnet-4-5"
      openai-compatible → "llama3"
  - API key input uses type="password"
  - Submit: POST /api/config, show success or error
  - On success: show "配置成功，请重启服务" message
```

## Files Changed

| File | Change |
|------|--------|
| `packages/core/src/config/global-config.ts` | **New**: GlobalConfigManager class |
| `packages/core/src/config/index.ts` | **New**: barrel export |
| `packages/core/src/index.ts` | **Modify**: export GlobalConfigManager |
| `packages/cli/src/setup-wizard.ts` | **New**: CLI interactive setup |
| `packages/cli/src/index.ts` | **Modify**: add config check before bootstrap |
| `packages/server/src/gateway/routes/config.ts` | **New**: config API endpoints |
| `packages/server/src/gateway/server.ts` | **Modify**: register config routes |
| `packages/server/src/index.ts` | **Modify**: downgrade mode logic |
| `packages/web/src/components/SetupPage.tsx` | **New**: web config form component |
| `packages/web/src/App.tsx` | **Modify**: conditional SetupPage vs ChatArea |

## Files NOT Changed

- `packages/cli/src/config-loader.ts` — existing layered loading stays, reads from same file
- `packages/server/src/config.ts` — keeps reading from process.env for server binding config
- `packages/cli/src/paths.ts` — already writes to `~/.code-agent/`, no path changes needed
- `packages/core/src/llm/*` — no LLM layer changes

## Interaction with Existing Config Layers

The existing priority chain remains unchanged:

1. `~/.code-agent/config.json` (global, now also populated by setup wizard)
2. `$WORKSPACE/.code-agent/config.json` (project override)
3. `$WORKSPACE/.env`
4. `<monorepo_root>/.env` (dev mode)
5. `process.env`
6. CLI flags (`--model`)

The setup wizard only adds to layer 1 — it does not alter the layering behavior. Users can still override globally-configured values at any layer below.

## Error Handling

- **Disk full / permission denied on save**: Show clear error message, allow retry
- **Invalid config file (manual edit after setup)**: `isConfigured()` returns false, triggering setup flow again
- **API key validation**: No remote validation (requires network call to provider); only check non-empty locally
- **Concurrent writes**: Last write wins (simple `writeFileSync`, acceptable for single-user config)
