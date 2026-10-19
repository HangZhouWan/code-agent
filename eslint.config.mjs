/**
 * ESLint flat config
 *
 * 目标：
 * - 统一 TypeScript 解析
 * - 强制包依赖方向（protocol ← core ← runtime ← {server, cli}，web ← protocol）
 * - 现有 legacy 代码先用 warn，迁移完成后在后续阶段收紧为 error
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
        "warn",
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

  // 适配器不能相互依赖（web 只能依赖 protocol）
  {
    files: ["packages/server/**/*.ts", "packages/cli/**/*.ts"],
    rules: {
      "no-restricted-imports": ["warn", { patterns: ["@code-agent/web"] }],
    },
  },
);
