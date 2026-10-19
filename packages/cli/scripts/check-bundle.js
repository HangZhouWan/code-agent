#!/usr/bin/env node
/**
 * CLI bundle guard
 *
 * 确保发布包没有把 server / Fastify / Drizzle / better-sqlite3 打进 bundle。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metafilePath = resolve(rootDir, "dist/metafile.json");

let metafile;
try {
  metafile = JSON.parse(readFileSync(metafilePath, "utf-8"));
} catch {
  console.error(
    "[bundle-guard] dist/metafile.json 不存在，请先执行 pnpm build",
  );
  process.exit(1);
}

const rules = [
  {
    name: "@code-agent/server",
    match: (input) => input.includes("packages/server/"),
  },
  {
    name: "fastify",
    match: (input) => input.includes("node_modules/.pnpm/fastify@"),
  },
  {
    name: "@fastify/*",
    match: (input) => input.includes("node_modules/.pnpm/@fastify+"),
  },
  {
    name: "better-sqlite3",
    match: (input) => input.includes("better-sqlite3@"),
  },
  {
    name: "drizzle-orm",
    match: (input) => input.includes("drizzle-orm@"),
  },
  {
    name: "drizzle-kit",
    match: (input) => input.includes("drizzle-kit@"),
  },
];

const inputs = Object.keys(metafile.inputs ?? {});
const violations = [];

for (const rule of rules) {
  const matches = inputs.filter(rule.match);
  if (matches.length > 0) {
    violations.push(`${rule.name} (${matches[0]})`);
  }
}

if (violations.length > 0) {
  console.error("[bundle-guard] CLI bundle 包含禁止依赖:");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log(`[bundle-guard] passed (${inputs.length} inputs)`);
