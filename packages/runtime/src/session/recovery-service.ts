/**
 * RecoveryService —— 显式恢复未完成的 run
 *
 * - 只恢复非 completed/aborted 的 SessionCheckpoint
 * - 获取租约后再恢复，避免多进程重复执行
 * - pending approvals/questions 需要人工处理，直接跳过
 */

import type { CheckpointStore } from "@code-agent/core";
import type {
  RunId,
  SessionId,
} from "@code-agent/protocol";
import type { AgentSession } from "./agent-session.js";

export interface RecoverySessionInput {
  sessionId: SessionId;
  workspacePath: string;
}

export interface RecoveryServiceOptions {
  checkpoints: CheckpointStore;
  createSession: (input: RecoverySessionInput) => Promise<AgentSession>;
}

export interface RecoveredRun {
  sessionId: SessionId;
  runId: RunId;
  status: "recovered" | "skipped";
  reason?: string;
}

export interface RecoveryServiceReport {
  recovered: number;
  skipped: number;
  runs: RecoveredRun[];
}

export interface RecoverOptions {
  owner?: string;
  ttlMs?: number;
}

export class RecoveryService {
  constructor(private readonly options: RecoveryServiceOptions) {}

  async recoverSessions(options: RecoverOptions = {}): Promise<RecoveryServiceReport> {
    const owner = options.owner ?? `recovery_${process.pid}`;
    const ttlMs = options.ttlMs ?? 60_000;
    const recoverable = await this.options.checkpoints.listRecoverable();
    const runs: RecoveredRun[] = [];
    let recovered = 0;
    let skipped = 0;

    for (const item of recoverable) {
      const checkpoint =
        await this.options.checkpoints.loadLatestSession(item.sessionId);
      if (!checkpoint) {
        skipped++;
        runs.push({
          sessionId: item.sessionId,
          runId: item.runId,
          status: "skipped",
          reason: "checkpoint_missing",
        });
        continue;
      }
      if (!checkpoint.workspacePath) {
        skipped++;
        runs.push({
          sessionId: item.sessionId,
          runId: item.runId,
          status: "skipped",
          reason: "workspace_missing",
        });
        continue;
      }
      if (
        checkpoint.pendingApprovals.length > 0 ||
        (checkpoint.pendingQuestions?.length ?? 0) > 0
      ) {
        skipped++;
        runs.push({
          sessionId: item.sessionId,
          runId: item.runId,
          status: "skipped",
          reason: "pending_interactions",
        });
        continue;
      }

      const acquired = await this.options.checkpoints.acquireLease(
        item.sessionId,
        owner,
        ttlMs,
      );
      if (!acquired) {
        skipped++;
        runs.push({
          sessionId: item.sessionId,
          runId: item.runId,
          status: "skipped",
          reason: "lease_held",
        });
        continue;
      }

      try {
        const session = await this.options.createSession({
          sessionId: checkpoint.sessionId,
          workspacePath: checkpoint.workspacePath,
        });
        const handle = await session.resume(checkpoint.runId);
        const result = await handle.done;
        if (result.status === "completed") {
          recovered++;
          runs.push({
            sessionId: checkpoint.sessionId,
            runId: checkpoint.runId,
            status: "recovered",
          });
        } else {
          skipped++;
          runs.push({
            sessionId: checkpoint.sessionId,
            runId: checkpoint.runId,
            status: "skipped",
            reason: result.status,
          });
        }
      } catch (error) {
        skipped++;
        runs.push({
          sessionId: checkpoint.sessionId,
          runId: checkpoint.runId,
          status: "skipped",
          reason: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await this.options.checkpoints.releaseLease(
          item.sessionId,
          owner,
        );
      }
    }

    return { recovered, skipped, runs };
  }
}
