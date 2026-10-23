/**
 * ESLint flat config
 *
 * 目标：
 * - 统一 TypeScript 解析
 * - 强制包依赖方向（protocol ← core ← runtime ← {server, cli}，web ← protocol）
 * - legacy 已删除，所有边界规则均为 error
 */

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.agent/**",
      "**/publish/**",
    ],
  },

  // parser + TS plugin，不启用会大面积误报的 recommended 规则
  tseslint.configs.base,

  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-debugger": "error",
      "no-duplicate-case": "error",
    },
  },

  // protocol 必须浏览器安全，且不依赖任何 workspace 包
  {
    files: ["packages/protocol/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["node:*", "@code-agent/*"] },
      ],
    },
  },

  // core 不能反向依赖上层
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "@code-agent/runtime",
            "@code-agent/server",
            "@code-agent/cli",
            "@code-agent/web",
          ],
        },
      ],
    },
  },

  // runtime 不能依赖适配器
  {
    files: ["packages/runtime/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "@code-agent/server",
            "@code-agent/cli",
            "@code-agent/web",
          ],
        },
      ],
    },
  },

  // runtime.orchestrator 只能依赖 protocol/core 契约与注入的类型契约，
  // 不能反向依赖会话平面（type-only 导入不产生运行时耦合，允许）
  {
    files: ["packages/runtime/src/orchestrator/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "../ports/types.js",
              allowTypeImports: true,
              message: "orchestrator 只能把端口当作注入的类型契约使用",
            },
            {
              name: "../../ports/types.js",
              allowTypeImports: true,
              message: "orchestrator 只能把端口当作注入的类型契约使用",
            },
            {
              name: "../dispatch/task-dispatcher.js",
              allowTypeImports: true,
              message: "orchestrator 只能把 dispatcher 当作注入的类型契约使用",
            },
            {
              name: "../../dispatch/task-dispatcher.js",
              allowTypeImports: true,
              message: "orchestrator 只能把 dispatcher 当作注入的类型契约使用",
            },
          ],
          patterns: ["**/session/*", "**/approval/*"],
        },
      ],
    },
  },

  // server 不能依赖 cli
  {
    files: ["packages/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["@code-agent/cli", "@code-agent/web"] },
      ],
    },
  },

  // cli 不能依赖 server（唯一发布包必须自包含）
  {
    files: ["packages/cli/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: ["@code-agent/server", "@code-agent/web"] },
      ],
    },
  },

  // web 只依赖 protocol
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "@code-agent/core",
            "@code-agent/runtime",
            "@code-agent/server",
            "@code-agent/cli",
          ],
        },
      ],
    },
  },
);
