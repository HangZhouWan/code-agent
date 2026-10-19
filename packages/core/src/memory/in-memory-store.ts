/**
 * 内存长期记忆实现（供测试与 CLI 使用）
 */

import type {
  MemoryId,
  MemoryQuery,
  MemoryRecord,
  WorkspaceId,
} from "@code-agent/protocol";
import {
  MemoryVersionConflictError,
  type MemoryListFilter,
  type MemorySearchResult,
  type MemoryStore,
} from "./types.js";

function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[\s,.;:!?()[\]{}"'`~@#$%^&*+=|\\/<>-]+/)
        .filter((token) => token.length >= 2),
    ),
  ];
}

function cloneRecord(record: MemoryRecord): MemoryRecord {
  return {
    ...record,
    tags: [...record.tags],
    keywords: [...record.keywords],
    source: { ...record.source, messageIds: [...record.source.messageIds] },
  };
}

export class InMemoryMemoryStore implements MemoryStore {
  private records: MemoryRecord[];

  constructor(records: MemoryRecord[] = []) {
    this.records = records.map(cloneRecord);
  }

  async get(id: MemoryId): Promise<MemoryRecord | null> {
    const record = this.records.find((item) => item.id === id);
    return record ? cloneRecord(record) : null;
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;
    return this.records
      .filter((record) => {
        if (filter.scope && record.scope !== filter.scope) return false;
        if (filter.status && record.status !== filter.status) return false;
        if (filter.kinds && !filter.kinds.includes(record.kind)) return false;
        if (
          filter.workspaceId &&
          record.scope === "workspace" &&
          record.workspaceId !== filter.workspaceId
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(offset, offset + limit)
      .map(cloneRecord);
  }

  async search(
    query: MemoryQuery,
    workspaceId: WorkspaceId,
  ): Promise<MemorySearchResult[]> {
    const trimmed = query.query.trim().toLowerCase();
    if (!trimmed) return [];
    const tokens = tokenize(trimmed);
    const topK = query.topK ?? 5;

    const results: MemorySearchResult[] = [];
    for (const record of this.records) {
      if (record.status !== "active") continue;
      if (query.scope && record.scope !== query.scope) continue;
      if (record.scope === "workspace" && record.workspaceId !== workspaceId) {
        continue;
      }
      if (query.kinds && !query.kinds.includes(record.kind)) continue;

      const content = record.content.toLowerCase();
      const tags = record.tags.map((tag) => tag.toLowerCase());
      const keywords = record.keywords.map((keyword) => keyword.toLowerCase());

      let score = 0;
      if (content.includes(trimmed)) score += 10;
      for (const token of tokens) {
        if (content.includes(token)) score += 3;
        if (tags.some((tag) => tag.includes(token))) score += 2;
        if (keywords.some((keyword) => keyword.includes(token))) score += 1;
      }
      if (score === 0) continue;

      score += record.confidence;
      if (record.pinned) score += 2;
      const updated = Date.parse(record.updatedAt);
      if (Number.isFinite(updated)) {
        const days = (Date.now() - updated) / 86_400_000;
        score += Math.max(0, 1 - days / 30);
      }

      results.push({ record: cloneRecord(record), score });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async put(record: MemoryRecord): Promise<void> {
    const index = this.records.findIndex((item) => item.id === record.id);
    if (index === -1) {
      this.records.push(cloneRecord(record));
    } else {
      this.records[index] = cloneRecord(record);
    }
  }

  async update(
    id: MemoryId,
    patch: Partial<Omit<MemoryRecord, "id" | "version" | "createdAt">>,
    expectedVersion?: number,
  ): Promise<MemoryRecord> {
    const index = this.records.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error(`Memory not found: ${id}`);
    }
    const current = this.records[index];
    if (
      expectedVersion !== undefined &&
      current.version !== expectedVersion
    ) {
      throw new MemoryVersionConflictError(id, expectedVersion, current.version);
    }

    const next: MemoryRecord = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      version: current.version + 1,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
      tags: patch.tags ? [...patch.tags] : current.tags,
      keywords: patch.keywords ? [...patch.keywords] : current.keywords,
      source: patch.source ? { ...patch.source } : current.source,
    };
    this.records[index] = next;
    return cloneRecord(next);
  }

  async delete(id: MemoryId): Promise<boolean> {
    const before = this.records.length;
    this.records = this.records.filter((record) => record.id !== id);
    return this.records.length !== before;
  }

  async recordUsage(ids: MemoryId[], usedAt: string): Promise<void> {
    const set = new Set(ids);
    this.records = this.records.map((record) =>
      set.has(record.id)
        ? {
            ...record,
            useCount: record.useCount + 1,
            lastUsedAt: usedAt,
          }
        : record,
    );
  }

  snapshot(): MemoryRecord[] {
    return this.records.map(cloneRecord);
  }
}
