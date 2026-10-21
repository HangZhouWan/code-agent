#!/usr/bin/env node
/**
 * 从 Markdown 生成角色提示词 TS 模块。
 *
 * 输入：src/agents/roles/prompts/*.md
 * 输出：src/agents/roles/prompts.generated.ts
 *
 * 用法：
 *   node scripts/generate-prompts.mjs          生成（内容相同时不写盘）
 *   node scripts/generate-prompts.mjs --check  只校验，不一致时退出码 1
 *
 * 之所以在构建前生成而不是运行时读取 .md：
 * - runtime 的 tsc 构建不会复制 .md 到 dist；
 * - CLI 通过 esbuild 打成单文件，发布时只包含 dist/index.js。
 * 生成成普通 TS 常量后，上述所有构建方式都无需改动。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 包根目录（不依赖 cwd，兼容 pnpm -r 调用） */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const promptsDir = resolve(packageRoot, "src/agents/roles/prompts");
const outFile = resolve(packageRoot, "src/agents/roles/prompts.generated.ts");

/** 显式源清单：定义导出名、源文件名与输出顺序 */
const SOURCES = [
  ["COMMON_PROMPT", "common"],
  ["CODE_PROMPT", "code"],
  ["TEST_PROMPT", "test"],
  ["DOC_PROMPT", "doc"],
  ["REVIEW_PROMPT", "review"],
];

const HEADER = `/**
 * 自动生成文件，请勿手动编辑。
 * 源文件：src/agents/roles/prompts/*.md
 * 重新生成：pnpm generate:prompts
 */
`;

/**
 * 归一化 Markdown 文本。
 *
 * 输入：原始文件内容
 * 输出：去 BOM、统一 LF、去掉末尾空白的结果
 */
function normalize(text) {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, "\n").trimEnd();
}

/**
 * 将文本转成安全的 TS 字符串字面量。
 *
 * 输入：任意文本
 * 输出：可直接嵌入 TS 源码的双引号字面量
 */
function escapeLiteral(value) {
  // JSON.stringify 会转义引号、反斜杠和控制字符；
  // U+2028/U+2029 在现代 JS 字符串字面量中合法，无需额外处理。
  return JSON.stringify(value);
}

/**
 * 渲染目标文件内容。
 *
 * 输出：完整的 prompts.generated.ts 文本
 * @throws 源文件缺失或为空时抛出
 */
function render() {
  const blocks = SOURCES.map(([exportName, fileName]) => {
    const filePath = resolve(promptsDir, `${fileName}.md`);
    if (!existsSync(filePath)) {
      throw new Error(`[generate-prompts] 缺少源文件: ${filePath}`);
    }
    const text = normalize(readFileSync(filePath, "utf8"));
    if (!text.trim()) {
      throw new Error(`[generate-prompts] 源文件为空: ${filePath}`);
    }
    return `export const ${exportName} = ${escapeLiteral(text)};`;
  });

  return `${HEADER}\n${blocks.join("\n\n")}\n`;
}

const checkOnly = process.argv.includes("--check");
const next = render();
const current = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";

if (current === next) {
  console.log(`[generate-prompts] 已是最新: ${outFile}`);
} else if (checkOnly) {
  console.error(
    "[generate-prompts] 生成文件与 Markdown 源不一致，请运行 pnpm generate:prompts",
  );
  process.exit(1);
} else {
  writeFileSync(outFile, next, "utf8");
  console.log(`[generate-prompts] 已生成: ${outFile}`);
}
