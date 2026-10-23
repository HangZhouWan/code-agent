/**
 * 长期记忆 DTO
 *
 * 作用域：
 * - workspace：项目约定、架构、命令、坑点
 * - user：跨项目用户偏好
 */

import type { MemoryId, RunId, SessionId, WorkspaceId } from "../ids.js";
import type { IsoTimestamp } from "../json.js";
import type { Plan } from "./plan.js";
import type { TaskResult } from "./task.js";

export type MemoryScope = "workspace" | "user";

export type MemoryKind =
  | "convention"
  | "preference"
  | "architecture"
  | "command"
  | "pitfall"
  | "fact";

export type MemoryStatus = "active" | "pending_review" | "archived";

export interface MemorySource {
  sessionId: SessionId;
  runId: RunId;
  messageIds: string[];
}

export interface MemoryRecord {
  id: MemoryId;
  workspaceId: WorkspaceId;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  tags: string[];
  keywords: string[];
  confidence: number;
  status: MemoryStatus;
  source: MemorySource;
  version: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  lastUsedAt?: IsoTimestamp;
  useCount: number;
  pinned?: boolean;
}

export type MemoryOp =
  | {
      op: "create";
      kind: MemoryKind;
      scope: MemoryScope;
      content: string;
      tags: string[];
      keywords?: string[];
      confidence: number;
      reason: string;
    }
  | {
      op: "update";
      id: MemoryId;
      content?: string;
      tags?: string[];
      keywords?: string[];
      confidence?: number;
      reason: string;
    }
  | {
      op: "merge";
      ids: MemoryId[];
      content: string;
      tags: string[];
      keywords?: string[];
      confidence: number;
    }
  | { op: "delete"; id: MemoryId; reason: string }
  | { op: "noop"; reason: string };

export interface MemoryQuery {
  query: string;
  scope?: MemoryScope;
  topK?: number;
  kinds?: MemoryKind[];
}

/** run 完成后用于记忆提炼的结构化摘要 */
export interface RunDigest {
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  runId: RunId;
  userMessages: string[];
  plan?: Plan;
  tasks: Array<{
    role: string;
    description: string;
    result?: TaskResult;
    filesChanged: string[];
  }>;
  commandsRun: string[];
  finalResponse: string;
}
