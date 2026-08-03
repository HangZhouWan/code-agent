#!/usr/bin/env node
/**
 * Prepare a publishable npm package under publish/.
 *
 * Reads the CLI's package.json as the source of truth, then:
 *   1. Creates publish/dist/ and copies the bundled CLI entry point
 *   2. Generates publish/package.json with name "code-agent" (the npm-facing name)
 *   3. Copies README.md and LICENSE for the npm registry page
 *
 * The publish/ directory is ephemeral — it is gitignored and regenerated on every build.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(__dirname, "..");
const rootDir = resolve(cliDir, "..", "..");
const publishDir = resolve(cliDir, "publish");
const publishDistDir = resolve(publishDir, "dist");

// ---- 1. Read source package.json ----
const sourceJson = JSON.parse(
  readFileSync(resolve(cliDir, "package.json"), "utf-8")
);

// ---- 2. Verify the bundled output exists ----
const bundledEntry = resolve(cliDir, "dist", "index.js");
if (!existsSync(bundledEntry)) {
  console.error(
    "[publish-prep] dist/index.js not found. Run `pnpm build` first."
  );
  process.exit(1);
}

// ---- 3. Build the publish package.json ----
const publishManifest = {
  name: "code-agent", // npm-facing unscoped name
  version: sourceJson.version,
  description: sourceJson.description,
  type: "module",
  bin: {
    "code-agent": "./dist/index.js",
  },
  files: ["dist"],
  dependencies: sourceJson.dependencies ?? {},
  repository: sourceJson.repository,
  license: sourceJson.license,
  keywords: sourceJson.keywords,
  publishConfig: {
    access: "public",
  },
};

// ---- 4. Create publish/dist/ ----
mkdirSync(publishDistDir, { recursive: true });

// ---- 5. Write publish/package.json ----
writeFileSync(
  resolve(publishDir, "package.json"),
  JSON.stringify(publishManifest, null, 2) + "\n"
);
console.log("[publish-prep] Wrote publish/package.json");

// ---- 6. Copy bundled CLI ----
cpSync(bundledEntry, resolve(publishDistDir, "index.js"));
console.log("[publish-prep] Copied dist/index.js → publish/dist/index.js");

// Copy source map if present
const sourceMap = resolve(cliDir, "dist", "index.js.map");
if (existsSync(sourceMap)) {
  cpSync(sourceMap, resolve(publishDistDir, "index.js.map"));
  console.log("[publish-prep] Copied dist/index.js.map → publish/dist/index.js.map");
}

// ---- 7. Copy README ----
const readmeSrc = resolve(rootDir, "README.md");
if (existsSync(readmeSrc)) {
  cpSync(readmeSrc, resolve(publishDir, "README.md"));
  console.log("[publish-prep] Copied README.md");
}

// ---- 8. Copy LICENSE (if present) ----
const licenseSrc = resolve(rootDir, "LICENSE");
if (existsSync(licenseSrc)) {
  cpSync(licenseSrc, resolve(publishDir, "LICENSE"));
  console.log("[publish-prep] Copied LICENSE");
}

console.log("[publish-prep] Done — publish/ is ready for `npm publish`");
