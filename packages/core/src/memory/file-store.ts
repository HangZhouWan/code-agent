/**
 * 文件长期记忆实现（CLI / 默认）
 *
 * 单 JSON 文件 + 原子写；适合单进程、单工作区场景。
 */

import { existsSync, readFileSync } from "node:fs";
import type {
  MemoryId,
  MemoryQuery,
  MemoryRecord,
  WorkspaceId,
} from "@code-agent/protocol";
import { atomicWriteFileSync } from "../config/global-config.js";
import { InMemoryMemoryStore } from "./in-memory-store.js";
import type {
  MemoryListFilter,
  MemorySearchResult,
  MemoryStore,
} from "./types.js";

interface FileData {
  version: 1;
  records: MemoryRecord[];
}

export interface FileMemoryStoreOptions {
  filePath: string;
  logger?: (message: string) => void;
}

export class FileMemoryStore implements MemoryStore {
  private readonly inner = new InMemoryMemoryStore();
  private readonly filePath: string;
  private readonly logger: (message: string) => void;
  private loaded = false;

  constructor(options: FileMemoryStoreOptions) {
    this.filePath = options.filePath;
    this.logger = options.logger ?? (() => {});
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    if (!existsSync(this.filePath)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf-8"));
      const records = Array.isArray(parsed)
        ? parsed
        : (parsed as FileData).records;
      if (!Array.isArray(records)) {
        throw new Error("invalid memory file shape");
      }
      for (const record of records) {
        if (
          typeof record === "object" &&
          record !== null &&
          typeof (record as MemoryRecord).id === "string" &&
          typeof (record as MemoryRecord).content === "string"
        ) {
          await this.inner.put(record as MemoryRecord);
        }
      }
    } catch (error) {
      this.logger(
        `[memory] Failed to load ${this.filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private persist(): void {
    const data: FileData = {
      version: 1,
      records: this.inner.snapshot(),
    };
    atomicWriteFileSync(
      this.filePath,
      `${JSON.stringify(data, null, 2)}\n`,
      0o600,
    );
  }

  async get(id: MemoryId): Promise<MemoryRecord | null> {
    await this.ensureLoaded();
    return this.inner.get(id);
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    await this.ensureLoaded();
    return this.inner.list(filter);
  }

  async search(
    query: MemoryQuery,
    workspaceId: WorkspaceId,
  ): Promise<MemorySearchResult[]> {
    await this.ensureLoaded();
    return this.inner.search(query, workspaceId);
  }

  async put(record: MemoryRecord): Promise<void> {
    await this.ensureLoaded();
    await this.inner.put(record);
    this.persist();
  }

  async update(
    id: MemoryId,
    patch: Partial<Omit<MemoryRecord, "id" | "version" | "createdAt">>,
    expectedVersion?: number,
  ): Promise<MemoryRecord> {
    await this.ensureLoaded();
    const updated = await this.inner.update(id, patch, expectedVersion);
    this.persist();
    return updated;
  }

  async delete(id: MemoryId): Promise<boolean> {
    await this.ensureLoaded();
    const deleted = await this.inner.delete(id);
    if (deleted) this.persist();
    return deleted;
  }

  async recordUsage(ids: MemoryId[], usedAt: string): Promise<void> {
    await this.ensureLoaded();
    await this.inner.recordUsage(ids, usedAt);
    this.persist();
  }

  snapshot(): MemoryRecord[] {
    return this.inner.snapshot();
  }
}
