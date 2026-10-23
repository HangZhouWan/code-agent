/**
 * SQLite RunStore
 */

import type {
  CreateRunInput,
  RunPatch,
  RunStore,
} from "@code-agent/runtime";
import {
  asRunId,
  asTaskId,
  type Artifact,
  type RunId,
  type RunSummary,
  type SessionId,
  type TaskRecord,
  type TaskResult,
} from "@code-agent/protocol";
import type { ServerDb } from "../db/server-db.js";

interface RunRow {
  id: string;
  session_id: string;
  status: string;
  node: string | null;
  started_at: string;
  finished_at: string | null;
}

interface TaskRow {
  id: string;
  run_id: string;
  role: string;
  description: string;
  status: string;
  routing: string;
  depends_on: string;
  result: string | null;
  created_at: string;
  updated_at: string;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  task_id: string | null;
  type: string;
  payload: string;
  created_at: string;
}

function toRun(row: RunRow): RunSummary {
  return {
    id: row.id as RunId,
    sessionId: row.session_id as SessionId,
    status: row.status as RunSummary["status"],
    ...(row.node ? { node: row.node } : {}),
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  };
}

function toTask(row: TaskRow): TaskRecord {
  let dependsOn: string[] = [];
  let result: TaskResult | undefined;
  try {
    const parsed: unknown = JSON.parse(row.depends_on);
    if (Array.isArray(parsed)) dependsOn = parsed.map(String);
  } catch {
    dependsOn = [];
  }
  if (row.result) {
    try {
      result = JSON.parse(row.result) as TaskResult;
    } catch {
      result = undefined;
    }
  }
  return {
    id: asTaskId(row.id),
    runId: asRunId(row.run_id),
    role: row.role,
    description: row.description,
    status: row.status as TaskRecord["status"],
    routing: row.routing as TaskRecord["routing"],
    dependsOn: dependsOn.map(asTaskId),
    ...(result ? { result } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    runId: asRunId(row.run_id),
    ...(row.task_id ? { taskId: asTaskId(row.task_id) } : {}),
    type: row.type as Artifact["type"],
    payload: JSON.parse(row.payload) as Artifact["payload"],
    createdAt: row.created_at,
  };
}

export class SqliteRunStore implements RunStore {
  constructor(private readonly db: ServerDb) {}

  async createRun(input: CreateRunInput): Promise<RunSummary> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO runtime_runs
         (id, session_id, status, node, started_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.sessionId,
        input.status,
        input.node ?? null,
        input.startedAt,
      );
    const run = await this.getRun(input.id);
    if (!run) throw new Error(`Failed to create run ${input.id}`);
    return run;
  }

  async updateRun(id: RunId, patch: RunPatch): Promise<void> {
    const current = await this.getRun(id);
    if (!current) return;
    this.db
      .prepare(
        `UPDATE runtime_runs SET status = ?, node = ?, started_at = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? current.status,
        patch.node ?? current.node ?? null,
        current.startedAt,
        patch.finishedAt ?? current.finishedAt ?? null,
        id,
      );
  }

  async getRun(id: RunId): Promise<RunSummary | null> {
    const row = this.db
      .prepare(
        `SELECT id, session_id, status, node, started_at, finished_at
         FROM runtime_runs WHERE id = ?`,
      )
      .get(id) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  async getActiveRun(sessionId: SessionId): Promise<RunSummary | null> {
    const row = this.db
      .prepare(
        `SELECT id, session_id, status, node, started_at, finished_at
         FROM runtime_runs
         WHERE session_id = ? AND status IN ('running','awaiting_approval','awaiting_input')
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(sessionId) as RunRow | undefined;
    return row ? toRun(row) : null;
  }

  async listRuns(sessionId: SessionId): Promise<RunSummary[]> {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, status, node, started_at, finished_at
         FROM runtime_runs WHERE session_id = ? ORDER BY started_at DESC`,
      )
      .all(sessionId) as RunRow[];
    return rows.map(toRun);
  }

  async upsertTask(task: TaskRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO runtime_tasks
         (id, run_id, role, description, status, routing, depends_on, result, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           role = excluded.role,
           description = excluded.description,
           status = excluded.status,
           routing = excluded.routing,
           depends_on = excluded.depends_on,
           result = excluded.result,
           updated_at = excluded.updated_at`,
      )
      .run(
        task.id,
        task.runId,
        task.role,
        task.description,
        task.status,
        task.routing,
        JSON.stringify(task.dependsOn),
        task.result ? JSON.stringify(task.result) : null,
        task.createdAt,
        task.updatedAt,
      );
  }

  async listTasks(runId: RunId): Promise<TaskRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, role, description, status, routing, depends_on, result, created_at, updated_at
         FROM runtime_tasks WHERE run_id = ? ORDER BY created_at ASC`,
      )
      .all(runId) as TaskRow[];
    return rows.map(toTask);
  }

  async appendArtifact(artifact: Artifact): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runtime_artifacts
         (id, run_id, task_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.runId,
        artifact.taskId ?? null,
        artifact.type,
        JSON.stringify(artifact.payload),
        artifact.createdAt,
      );
  }

  async listArtifacts(runId: RunId): Promise<Artifact[]> {
    const rows = this.db
      .prepare(
        `SELECT id, run_id, task_id, type, payload, created_at
         FROM runtime_artifacts WHERE run_id = ? ORDER BY created_at ASC`,
      )
      .all(runId) as ArtifactRow[];
    return rows.map(toArtifact);
  }
}
