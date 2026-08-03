#!/usr/bin/env node
/**
 * Post-build script: prepend shebang line to dist/index.js
 *
 * TypeScript compiler doesn't preserve shebang in ESM output,
 * so we add it manually after build.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, "../dist/index.js");

const content = readFileSync(indexPath, "utf-8");

// Only add shebang if not already present
if (!content.startsWith("#!/usr/bin/env node")) {
  writeFileSync(indexPath, `#!/usr/bin/env node\n${content}`);
  console.log("[build] Added shebang to dist/index.js");
} else {
  console.log("[build] Shebang already present in dist/index.js");
}
