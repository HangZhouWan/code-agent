#!/usr/bin/env node
/**
 * Bundle CLI entry point with @code-agent/core and @code-agent/server inlined.
 *
 * Uses esbuild to produce a single self-contained dist/index.js.
 * Only third-party npm dependencies remain as external imports.
 */

import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const srcEntry = resolve(rootDir, "src/index.ts");
const outFile = resolve(rootDir, "dist/index.js");

// All third-party packages that should remain external (not bundled)
const externalPatterns = [
  "@langchain/*",
  "langchain",
  "zod",
  "simple-git",
  // Native / platform packages
  "node:*",
  "better-sqlite3",
  // fastify and friends — not used by orchestrator but bundle may reference them
  "fastify",
  "@fastify/*",
  "dotenv",
  "drizzle-orm",
  "drizzle-kit",
];

console.log("[bundle] Building self-contained CLI...");
console.log(`[bundle] Entry: ${srcEntry}`);
console.log(`[bundle] Output: ${outFile}`);

try {
  const result = await build({
    entryPoints: [srcEntry],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: outFile,
    // Everything in node_modules stays external; workspace packages get bundled
    external: [
      // Exclude all node_modules packages except @code-agent/*
      ...externalPatterns,
    ],
    // Don't bundle @code-agent/* — they are workspace packages that should be inlined.
    // By NOT adding them to "external", esbuild bundles them.
    sourcemap: true,
    sourcesContent: false,
    // Resolve conditions for ESM
    conditions: ["import", "node", "default"],
    // Write metafile for dependency analysis
    metafile: true,
    // Log level
    logLevel: "info",
    // Absorb shebang comment from source
    banner: {
      js: `#!/usr/bin/env node`,
    },
  });

  // Report bundle size
  const stats = result.metafile.outputs[outFile];
  if (stats) {
    const kb = (stats.bytes / 1024).toFixed(1);
    console.log(`[bundle] Done — ${kb} KB`);

    // List all external imports that remain
    const externalImports = new Set();
    for (const imp of stats.imports) {
      if (imp.external) {
        externalImports.add(imp.path);
      }
    }
    if (externalImports.size > 0) {
      console.log(`[bundle] External dependencies (${externalImports.size}):`);
      for (const pkg of [...externalImports].sort()) {
        console.log(`  - ${pkg}`);
      }
    }
  } else {
    console.log("[bundle] Done.");
  }
} catch (err) {
  console.error("[bundle] Build failed:", err);
  process.exit(1);
}
