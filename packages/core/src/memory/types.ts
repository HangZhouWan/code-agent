/**
 * 长期记忆端口与配置
 */

import type {
  MemoryId,
  MemoryKind,
  MemoryOp,
  MemoryQuery,
  MemoryRecord,
  MemoryScope,
  MemoryStatus,
  RunDigest,
  WorkspaceId,
} from "@code-agent/protocol";

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
}

export interface MemoryListFilter {
  scope?: MemoryScope;
  status?: MemoryStatus;
  kinds?: MemoryKind[];
  workspaceId?: WorkspaceId;
  limit?: number;
  offset?: number;
}

export interface MemoryStore {
  get(id: MemoryId): Promise<MemoryRecord | null>;
  list(filter?: MemoryListFilter): Promise<MemoryRecord[]>;
  search(query: MemoryQuery, workspaceId: WorkspaceId): Promise<MemorySearchResult[]>;
  put(record: MemoryRecord): Promise<void>;
  update(
    id: MemoryId,
    patch: Partial<Omit<MemoryRecord, "id" | "version" | "createdAt">>,
    expectedVersion?: number,
  ): Promise<MemoryRecord>;
  delete(id: MemoryId): Promise<boolean>;
  recordUsage(ids: MemoryId[], usedAt: string): Promise<void>;
  snapshot(): MemoryRecord[];
}

export interface MemoryExtractor {
  extract(input: {
    digest: RunDigest;
    candidates: MemoryRecord[];
  }): Promise<MemoryOp[]>;
}

export interface MemoryConfig {
  autoApplyConfidence: number;
  maxOpsPerRun: number;
  maxContentLength: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  autoApplyConfidence: 0.8,
  maxOpsPerRun: 5,
  maxContentLength: 500,
};

export interface MemoryOpsResult {
  applied: number;
  pendingReview: number;
  skipped: number;
  errors: string[];
}

export class MemoryVersionConflictError extends Error {
  constructor(id: string, expected: number, actual: number) {
    super(`Memory ${id} version conflict: expected ${expected}, actual ${actual}`);
    this.name = "MemoryVersionConflictError";
  }
}
