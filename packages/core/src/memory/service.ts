/**
 * MemoryService —— 记忆写入、更新、检索与提炼落库
 */

import {
  asMemoryId,
  asRunId,
  asSessionId,
  type MemoryId,
  type MemoryKind,
  type MemoryOp,
  type MemoryQuery,
  type MemoryRecord,
  type MemoryScope,
  type MemorySource,
  type MemoryStatus,
  type RunDigest,
  type WorkspaceId,
} from "@code-agent/protocol";
import {
  DEFAULT_MEMORY_CONFIG,
  type MemoryConfig,
  type MemoryExtractor,
  type MemoryListFilter,
  type MemoryOpsResult,
  type MemoryStore,
} from "./types.js";

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{10,}\b/i,
  /api[_-]?key\s*[:=]/i,
  /password\s*[:=]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const INSTRUCTION_PATTERNS = [
  /ignore (all )?(previous|above) instructions/i,
  /system prompt/i,
  /you must (always|never)/i,
];

export interface StoreMemoryInput {
  content: string;
  kind: MemoryKind;
  scope?: MemoryScope;
  tags?: string[];
  keywords?: string[];
  confidence?: number;
  source?: Partial<MemorySource>;
  pinned?: boolean;
}

export interface StoreMemoryResult {
  record: MemoryRecord;
  pendingReview: boolean;
}

export interface MemoryServiceOptions {
  store: MemoryStore;
  workspaceId: WorkspaceId;
  extractor?: MemoryExtractor;
  config?: Partial<MemoryConfig>;
  /** 额外敏感内容过滤；返回 true 表示安全 */
  secretFilter?: (text: string) => boolean;
  /** 可注入时钟，便于测试 */
  now?: () => string;
}

function unique(values: string[], cap = 10): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    cap,
  );
}

function deriveKeywords(content: string, cap = 10): string[] {
  return unique(
    content
      .toLowerCase()
      .split(/[\s,.;:!?()[\]{}"'`~@#$%^&*+=|\\/<>-]+/)
      .filter((token) => token.length >= 3 || /[一-鿿]/.test(token)),
    cap,
  );
}

export class MemoryService {
  private readonly config: MemoryConfig;
  private readonly now: () => string;

  constructor(private readonly options: MemoryServiceOptions) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...options.config };
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private isSafe(content: string): boolean {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) return false;
    if (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(content))) {
      return false;
    }
    return this.options.secretFilter ? this.options.secretFilter(content) : true;
  }

  private validateContent(content: string): string {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("Memory content must not be empty");
    }
    if (trimmed.length > this.config.maxContentLength) {
      throw new Error(
        `Memory content exceeds ${this.config.maxContentLength} characters`,
      );
    }
    if (!this.isSafe(trimmed)) {
      throw new Error("Memory content rejected by safety filter");
    }
    return trimmed;
  }

  async search(query: MemoryQuery): Promise<MemoryRecord[]> {
    const results = await this.options.store.search(
      query,
      this.options.workspaceId,
    );
    if (results.length > 0) {
      await this.options.store.recordUsage(
        results.map((result) => result.record.id),
        this.now(),
      );
    }
    return results.map((result) => result.record);
  }

  async store(input: StoreMemoryInput): Promise<StoreMemoryResult> {
    const content = this.validateContent(input.content);
    const confidence = Math.max(0, Math.min(1, input.confidence ?? 0.8));
    const status: MemoryStatus =
      confidence >= this.config.autoApplyConfidence ? "active" : "pending_review";
    const scope = input.scope ?? "workspace";
    const now = this.now();
    const tags = unique(input.tags ?? []);
    const keywords = unique(input.keywords ?? deriveKeywords(content));

    const record: MemoryRecord = {
      id: asMemoryId(`mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`),
      workspaceId: this.options.workspaceId,
      scope,
      kind: input.kind,
      content,
      tags,
      keywords,
      confidence,
      status,
      source: {
        sessionId: input.source?.sessionId ?? asSessionId(""),
        runId: input.source?.runId ?? asRunId(""),
        messageIds: input.source?.messageIds ?? [],
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
      useCount: 0,
      ...(input.pinned ? { pinned: true } : {}),
    };

    await this.options.store.put(record);
    return { record, pendingReview: status === "pending_review" };
  }

  async applyOps(
    ops: MemoryOp[],
    source: MemorySource,
  ): Promise<MemoryOpsResult> {
    const result: MemoryOpsResult = {
      applied: 0,
      pendingReview: 0,
      skipped: 0,
      errors: [],
    };
    const limited = ops.slice(0, this.config.maxOpsPerRun);

    for (const op of limited) {
      try {
        switch (op.op) {
          case "noop":
            result.skipped++;
            break;

          case "create": {
            const stored = await this.store({
              content: op.content,
              kind: op.kind,
              scope: op.scope,
              tags: op.tags,
              keywords: op.keywords,
              confidence: op.confidence,
              source,
            });
            result.applied++;
            if (stored.pendingReview) result.pendingReview++;
            break;
          }

          case "update": {
            const existing = await this.options.store.get(op.id);
            if (!existing) {
              result.skipped++;
              result.errors.push(`Memory not found: ${op.id}`);
              break;
            }
            if (existing.pinned && op.content !== undefined) {
              result.skipped++;
              result.errors.push(`Memory ${op.id} is pinned; content update skipped`);
              break;
            }

            const patch: Partial<Omit<MemoryRecord, "id" | "version" | "createdAt">> =
              {};
            if (op.content !== undefined) {
              patch.content = this.validateContent(op.content);
            }
            if (op.tags) patch.tags = unique(op.tags);
            if (op.keywords) patch.keywords = unique(op.keywords);
            if (op.confidence !== undefined) {
              const confidence = Math.max(0, Math.min(1, op.confidence));
              patch.confidence = confidence;
              if (!existing.pinned) {
                patch.status =
                  confidence >= this.config.autoApplyConfidence
                    ? "active"
                    : "pending_review";
              }
            }
            patch.updatedAt = this.now();

            const updated = await this.options.store.update(
              op.id,
              patch,
              existing.version,
            );
            result.applied++;
            if (updated.status === "pending_review") result.pendingReview++;
            break;
          }

          case "merge": {
            const records = (
              await Promise.all(op.ids.map((id) => this.options.store.get(id)))
            ).filter((record): record is MemoryRecord => record !== null);
            if (records.length === 0) {
              result.skipped++;
              result.errors.push("No memories found to merge");
              break;
            }

            const base = records[0];
            const merged = await this.store({
              content: op.content,
              kind: base.kind,
              scope: base.scope,
              tags: unique([...base.tags, ...op.tags]),
              keywords: unique([
                ...base.keywords,
                ...(op.keywords ?? []),
                ...deriveKeywords(op.content),
              ]),
              confidence: op.confidence,
              source,
            });
            result.applied++;
            if (merged.pendingReview) result.pendingReview++;

            for (const record of records) {
              if (record.pinned) continue;
              await this.options.store.update(
                record.id,
                { status: "archived", updatedAt: this.now() },
                record.version,
              );
            }
            break;
          }

          case "delete": {
            const existing = await this.options.store.get(op.id);
            if (!existing || existing.pinned) {
              result.skipped++;
              if (existing?.pinned) {
                result.errors.push(`Memory ${op.id} is pinned; delete skipped`);
              }
              break;
            }
            await this.options.store.delete(op.id);
            result.applied++;
            break;
          }
        }
      } catch (error) {
        result.skipped++;
        result.errors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return result;
  }

  async extractAndApply(digest: RunDigest): Promise<MemoryOpsResult> {
    if (!this.options.extractor) {
      return { applied: 0, pendingReview: 0, skipped: 0, errors: [] };
    }

    const query = [...digest.userMessages, digest.finalResponse]
      .join(" ")
      .slice(0, 2_000);
    const candidates = await this.options.store.search(
      { query, topK: 20 },
      this.options.workspaceId,
    );
    const ops = await this.options.extractor.extract({
      digest,
      candidates: candidates.map((candidate) => candidate.record),
    });

    return this.applyOps(ops, {
      sessionId: digest.sessionId,
      runId: digest.runId,
      messageIds: [],
    });
  }

  async list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    return this.options.store.list(filter);
  }

  async get(id: MemoryId): Promise<MemoryRecord | null> {
    return this.options.store.get(id);
  }

  async delete(id: MemoryId): Promise<boolean> {
    return this.options.store.delete(id);
  }
}
