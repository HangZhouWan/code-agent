/**
 * 工作区只读浏览服务
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveWorkspacePath } from "@code-agent/runtime";
import type {
  GitFileStatus,
  GitFileStatusCode,
  WorkspaceDiff,
  WorkspaceEntry,
  WorkspaceFile,
} from "@code-agent/protocol";

const execFileAsync = promisify(execFile);

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TREE_ENTRIES = 500;
const IGNORED = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".agent",
]);

const LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".json": "json",
  ".md": "markdown",
  ".css": "css",
  ".html": "html",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".sql": "sql",
  ".sh": "shell",
};

function isIgnored(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]/)
    .some((segment) => IGNORED.has(segment));
}

function languageFor(filePath: string): string | undefined {
  return LANGUAGES[path.extname(filePath).toLowerCase()];
}

export class WorkspaceService {
  constructor(readonly workspacePath: string) {}

  private resolve(relativePath: string): string {
    return resolveWorkspacePath(this.workspacePath, relativePath || ".");
  }

  async listTree(relativePath = "."): Promise<WorkspaceEntry[]> {
    const fullPath = this.resolve(relativePath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const result: WorkspaceEntry[] = [];

    for (const entry of entries) {
      const relative = path.posix.join(
        relativePath === "." ? "" : relativePath,
        entry.name,
      );
      if (isIgnored(relative)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        continue;
      }
      if (result.length >= MAX_TREE_ENTRIES) break;

      const entryPath = path.join(fullPath, entry.name);
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: relative,
          type: "directory",
        });
      } else {
        let size: number | undefined;
        let mtime: string | undefined;
        try {
          const stat = await fs.stat(entryPath);
          size = stat.size;
          mtime = stat.mtime.toISOString();
        } catch {
          // ignore stat failure
        }
        result.push({
          name: entry.name,
          path: relative,
          type: "file",
          ...(size !== undefined ? { size } : {}),
          ...(mtime ? { mtime } : {}),
        });
      }
    }

    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async readFile(relativePath: string): Promise<WorkspaceFile> {
    const fullPath = this.resolve(relativePath);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${relativePath}`);
    }

    const mtime = stat.mtime.toISOString();
    if (stat.size > MAX_FILE_BYTES) {
      return {
        path: relativePath,
        content: "",
        encoding: "utf-8",
        size: stat.size,
        isBinary: false,
        truncated: true,
        mtime,
      };
    }

    const buffer = await fs.readFile(fullPath);
    const isBinary = buffer.includes(0);
    return {
      path: relativePath,
      content: isBinary ? "" : buffer.toString("utf-8"),
      ...(languageFor(relativePath)
        ? { language: languageFor(relativePath) }
        : {}),
      encoding: "utf-8",
      size: stat.size,
      isBinary,
      truncated: false,
      mtime,
    };
  }

  async diff(relativePath: string): Promise<WorkspaceDiff> {
    const fullPath = this.resolve(relativePath);
    const relative = path.relative(this.workspacePath, fullPath) || ".";
    const options = {
      cwd: this.workspacePath,
      maxBuffer: 5 * 1024 * 1024,
    };

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--no-color", "--", relative],
        options,
      );
      if (stdout.trim()) {
        return { path: relative, diff: stdout, isNew: false };
      }
    } catch {
      // not a git repo / git missing
    }

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--no-color", "--no-index", "/dev/null", fullPath],
        options,
      );
      return { path: relative, diff: stdout, isNew: true };
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout;
      if (stdout?.trim()) {
        return { path: relative, diff: stdout, isNew: true };
      }
      return { path: relative, diff: "(没有差异)", isNew: false };
    }
  }

  async gitStatus(): Promise<GitFileStatus[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["status", "--porcelain=v1"],
        { cwd: this.workspacePath, maxBuffer: 5 * 1024 * 1024 },
      );
      return stdout
        .split("\n")
        .map((line) => parseStatusLine(line))
        .filter((item): item is GitFileStatus => item !== null);
    } catch {
      return [];
    }
  }
}

function parseStatusLine(line: string): GitFileStatus | null {
  if (line.length < 4) return null;
  const x = line[0];
  const y = line[1];
  let filePath = line.slice(3).trim();
  if (!filePath) return null;
  if (filePath.includes(" -> ")) {
    filePath = filePath.split(" -> ").pop()!.trim();
  }

  if (x === "?" || y === "?") {
    return { path: filePath, status: "?", staged: false };
  }

  const staged = x !== " ";
  const code = staged ? x : y;
  const status: GitFileStatusCode = ["M", "A", "D", "R", "U"].includes(code)
    ? (code as GitFileStatusCode)
    : "M";
  return { path: filePath, status, staged };
}
