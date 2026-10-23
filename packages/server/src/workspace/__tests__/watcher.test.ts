/**
 * WorkspaceWatcher 测试
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkspaceWatcher,
  type WorkspaceChange,
} from "../watcher.js";

const tempDirs: string[] = [];
const watchers: WorkspaceWatcher[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-watcher-"));
  tempDirs.push(dir);
  return dir;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("watcher event timeout");
}

afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.stop();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceWatcher", () => {
  it("文件变更触发 workspace.changed，忽略 node_modules", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "node_modules"), { recursive: true });

    const watcher = new WorkspaceWatcher(dir);
    watchers.push(watcher);
    const events: WorkspaceChange[] = [];
    watcher.onChange((change) => events.push(change));
    await watcher.start();

    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    await waitFor(() => events.some((event) => event.path === "a.ts"));
    expect(events.find((event) => event.path === "a.ts")?.type).toBe(
      "workspace.changed",
    );

    writeFileSync(join(dir, "node_modules", "ignored.js"), "x");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(
      events.some((event) => event.path.startsWith("node_modules")),
    ).toBe(false);
  });
});
