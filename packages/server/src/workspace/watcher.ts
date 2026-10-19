/**
 * 工作区文件监听（chokidar + debounce）
 */

import { watch, type FSWatcher } from "chokidar";
import { relative, sep } from "node:path";

export interface WorkspaceChange {
  type: "workspace.changed";
  path: string;
  kind: "rename" | "change";
}

const IGNORED = new Set([".git", "node_modules", "dist", "coverage", ".agent"]);

export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private readonly subscribers = new Set<(change: WorkspaceChange) => void>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly workspacePath: string) {}

  async start(): Promise<void> {
    if (this.watcher) return;

    const watcher = watch(this.workspacePath, {
      ignoreInitial: true,
      persistent: true,
      ignored: (filePath: string) => this.isIgnored(filePath),
    });
    this.watcher = watcher;

    watcher.on("all", (eventType, filePath) => {
      if (typeof filePath !== "string") return;
      const relativePath = relative(this.workspacePath, filePath)
        .split(sep)
        .join("/");
      if (!relativePath || this.isIgnored(filePath)) return;

      const existing = this.timers.get(relativePath);
      if (existing) clearTimeout(existing);

      this.timers.set(
        relativePath,
        setTimeout(() => {
          this.timers.delete(relativePath);
          this.emit({
            type: "workspace.changed",
            path: relativePath,
            kind: eventType === "change" ? "change" : "rename",
          });
        }, 150),
      );
    });

    watcher.on("error", () => {
      // 监听失败不影响文件 API
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      watcher.once("ready", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  stop(): void {
    void this.watcher?.close();
    this.watcher = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  onChange(handler: (change: WorkspaceChange) => void): () => void {
    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  private emit(change: WorkspaceChange): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(change);
      } catch {
        // ignore subscriber failure
      }
    }
  }

  private isIgnored(filePath: string): boolean {
    const relativePath = relative(this.workspacePath, filePath);
    return relativePath
      .split(/[\\/]/)
      .some((segment) => IGNORED.has(segment));
  }
}
