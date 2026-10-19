/**
 * WorkspaceService 测试
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
import { WorkspaceService } from "../workspace-service.js";

const tempDirs: string[] = [];

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-workspace-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n", "utf-8");
  writeFileSync(join(dir, "README.md"), "# demo\n", "utf-8");
  writeFileSync(join(dir, "image.bin"), Buffer.from([0, 1, 2, 0]));
  writeFileSync(join(dir, "node_modules", "x", "index.js"), "x", "utf-8");
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("WorkspaceService", () => {
  it("listTree 过滤忽略目录并排序", async () => {
    const workspace = new WorkspaceService(makeWorkspace());
    const entries = await workspace.listTree(".");

    expect(entries.some((entry) => entry.path === "src")).toBe(true);
    expect(entries.some((entry) => entry.path === "node_modules")).toBe(
      false,
    );
    expect(entries[0].type).toBe("directory");
  });

  it("readFile 返回语言与内容", async () => {
    const workspace = new WorkspaceService(makeWorkspace());
    const file = await workspace.readFile("src/a.ts");
    expect(file.language).toBe("typescript");
    expect(file.content).toContain("export const a");
    expect(file.isBinary).toBe(false);
  });

  it("readFile 识别二进制", async () => {
    const workspace = new WorkspaceService(makeWorkspace());
    const file = await workspace.readFile("image.bin");
    expect(file.isBinary).toBe(true);
    expect(file.content).toBe("");
  });

  it("拒绝路径穿越", async () => {
    const workspace = new WorkspaceService(makeWorkspace());
    await expect(workspace.readFile("../secret")).rejects.toThrow();
  });

  it("gitStatus 在非 git 仓库返回空数组", async () => {
    const workspace = new WorkspaceService(makeWorkspace());
    await expect(workspace.gitStatus()).resolves.toEqual([]);
  });
});
