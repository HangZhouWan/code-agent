# 包结构与依赖规则

## 1. 依赖图

```
protocol
   ↑
  core
   ↑
 runtime
  ↙    ↘
server  cli

protocol ← web

testkit ← 所有包的 devDependencies
```

禁止反向依赖。ESLint `no-restricted-imports` 强制执行；迁移期间 legacy 代码允许 `warn`，新包必须 `error`。

## 2. 包职责与发布

| 包 | private | 发布 | 说明 |
|---|---|---|---|
| `@code-agent/protocol` | 是 | 否 | 纯 schema/类型，不导入 `node:*` |
| `@code-agent/core` | 是 | 否 | 可被 Node 使用，不依赖上层 |
| `@code-agent/runtime` | 是 | 否 | 依赖 core + protocol |
| `@code-agent/server` | 是 | 否 | 依赖 runtime + protocol |
| `@code-agent/cli` | 否 | 是 | 唯一发布包；core/runtime 被打进 bundle |
| `@code-agent/web` | 是 | 否 | 只依赖 protocol |
| `@code-agent/testkit` | 是 | 否 | 仅开发使用 |

## 3. 内部导出规则

- 包根 `index.ts` 只导出策展过的公共 API，禁止 `export *`。
- 适配器只使用 runtime 重新导出的应用 API（`createHarness`、`loadConfig`、`resolvePaths`、`Harness`），不直接伸手进 core 内部模块。
- protocol 的 wire DTO 必须 JSON-safe：ISO 时间字符串、普通对象、禁止 `Date`/类实例。
- 所有包使用 ESM（`"type": "module"`）。

## 4. 构建

- TypeScript project references：`packages/core`、`server`、`cli`、`testkit` 使用 `composite: true`。
- 根 `tsconfig.json` 是 solution；`pnpm typecheck` 走各包 `tsc -b`，干净检出不需要预先 build。
- `web` 使用独立 `tsconfig` + `tsc --noEmit`，由 Vite 构建。
- 后续引入 `development` export condition，让 `tsx`/Vitest/Vite 直接解析源码；生产仍解析 `dist`。

## 5. 目录约定

```
packages/<name>/src/
  __tests__/            单元测试（与模块同目录）
  index.ts              公共 API
```

新代码使用最终目录；旧实现迁移期间移入 `src/legacy/`，文件头标注 `LEGACY — delete in Phase 11`，阶段 11 删除。

## 6. CLI 发布包

- bundle 只包含 cli + core + runtime + protocol，不包含 server/Fastify/Drizzle/better-sqlite3。
- 发布清单只包含外部第三方依赖（`@langchain/*`、`zod`、`simple-git` 等）。
- `test:bundle` 扫描 esbuild metafile，发现禁止依赖即失败。
