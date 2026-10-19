/**
 * 任务结果与产物
 */

import type { RunId, TaskId } from "../ids.js";
import type { IsoTimestamp, JsonValue } from "../json.js";
import type { SerializedError } from "../errors.js";
import type { AgentRoleId } from "./role.js";
import type { TaskRouting, TaskStatus } from "./plan.js";

export type FileChangeType = "created" | "modified" | "deleted";

export interface FileChange {
  path: string;
  changeType: FileChangeType;
  diff?: string;
}

export interface CommitRecord {
  hash: string;
  message: string;
}

export interface TestResult {
  command: string;
  passed: number;
  failed: number;
  skipped: number;
  failures?: string[];
}

export type ReviewSeverity = "info" | "warning" | "error";

export interface ReviewFinding {
  severity: ReviewSeverity;
  file?: string;
  line?: number;
  message: string;
}

export interface TaskArtifacts {
  filesChanged?: FileChange[];
  commits?: CommitRecord[];
  tests?: TestResult;
  reviewFindings?: ReviewFinding[];
}

export type TaskResultStatus =
  | "success"
  | "failed"
  | "timeout"
  | "replan_needed"
  | "cancelled";

export interface TaskResult {
  taskId: TaskId;
  role: AgentRoleId;
  status: TaskResultStatus;
  summary: string;
  artifacts?: TaskArtifacts;
  error?: SerializedError;
}

export interface TaskRecord {
  id: TaskId;
  runId: RunId;
  role: AgentRoleId;
  description: string;
  status: TaskStatus;
  routing: TaskRouting;
  dependsOn: TaskId[];
  result?: TaskResult;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type ArtifactType = "file_change" | "commit" | "test" | "review" | "blob";

export interface Artifact {
  id: string;
  runId: RunId;
  taskId?: TaskId;
  type: ArtifactType;
  payload: JsonValue;
  createdAt: IsoTimestamp;
}
