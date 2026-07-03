# 实现计划 01：Monorepo 与基础设施搭建

**对应技术文档**：[2026-07-02-technical-implementation.md](./2026-07-02-technical-implementation.md) 第一、二节

**预计工时**：2-3 天（第 1 周前半段）

---

## 1. 目标

搭建 pnpm monorepo 项目骨架，配置 TypeScript、ESLint、Prettier，确保三个子包（core / server / web）能够独立构建且通过 workspace 协议互相引用。

## 2. 前置条件

| 条件 | 说明 |
|------|------|
| Node.js 22+ | `node -v` ≥ 22.0.0 |
| pnpm 9+ | `pnpm -v` ≥ 9.0.0 |
| Git 已初始化 | 项目根目录已有 `.git` |

## 3. 产出物清单

```
my-agent/
├── pnpm-workspace.yaml
├── package.json                    # 根 workspace 脚本
├── tsconfig.base.json              # 共享 TS 配置
├── .gitignore
├── .prettierrc
├── .env.example
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   ├── server/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           └── App.tsx
```

## 4. 实现步骤

### 步骤 1：初始化根目录

```bash
# 创建根 package.json
pnpm init
```

设置 `package.json` 为 workspace root：
```json
{
  "name": "my-agent",
  "private": true,
  "scripts": {
    "dev": "pnpm --parallel -r dev",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck"
  }
}
```

### 步骤 2：创建 pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

### 步骤 3：创建 tsconfig.base.json

- target: ES2022
- module: NodeNext
- moduleResolution: NodeNext
- strict: true
- declaration + declarationMap + sourceMap

### 步骤 4：初始化三个子包

**packages/core**（`@my-agent/core`）：
- `type: "module"`
- 依赖：`@langchain/core`, `@langchain/openai`, `@langchain/anthropic`, `langchain`, `zod`, `simple-git`
- `tsconfig.json` 继承 `../../tsconfig.base.json`

**packages/server**（`@my-agent/server`）：
- `type: "module"`
- 依赖：`@my-agent/core: workspace:*`，以及 `fastify`, `@langchain/langgraph`, `better-sqlite3`, `drizzle-orm` 等
- dev 脚本使用 `tsx watch`

**packages/web**（`@my-agent/web`）：
- `type: "module"`
- 依赖：`react`, `react-dom`, `react-markdown`, `remark-gfm`
- dev 依赖：`vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`

### 步骤 5：配置 .gitignore

```
node_modules/
dist/
.env
*.db
workspace/
```

### 步骤 6：安装依赖并验证

```bash
pnpm install
pnpm typecheck   # 所有包通过类型检查
pnpm build       # 所有包构建成功
```

## 5. 验收标准

- [ ] `pnpm install` 无错误完成
- [ ] `pnpm typecheck` 三个包均通过
- [ ] `pnpm build` 三个包均成功输出 `dist/`
- [ ] `packages/core/dist/` 可被 `packages/server` 通过 `workspace:*` 正确引用
- [ ] `packages/web` 的 Vite dev server 可正常启动
- [ ] `.env.example` 包含所有必要的环境变量模板

## 6. 后续模块依赖关系

```
本模块 (基础设施)
    ↓
┌───────────────────────────────────────┐
│  02-LLM 抽象层  │  03-工具层          │  ← 可并行
└───────────────────────────────────────┘
    ↓
  04-Agent Runtime
    ↓
  05-Agent 编排层
    ↓
┌───────────────────────────────────────┐
│  06-API Gateway  │  07-数据库         │  ← 可并行
└───────────────────────────────────────┘
    ↓
  08-Web 前端
```
