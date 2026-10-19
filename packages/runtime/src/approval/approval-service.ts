/**
 * ApprovalService —— 工具审批
 */

import {
  asAgentRunId,
  asCallId,
  type ApprovalDecision,
  type ApprovalRequest,
  type CallId,
  type JsonValue,
  type RunId,
  type SessionEvent,
  type SessionId,
  type TaskId,
} from "@code-agent/protocol";
import type { Clock, IdGenerator } from "../ports/types.js";

export interface ApprovalServiceOptions {
  sessionId: SessionId;
  clock: Clock;
  ids: IdGenerator;
  emit: (event: SessionEvent) => void;
  timeoutMs?: number;
}

export interface ApprovalRequestInput {
  runId: RunId;
  taskId: TaskId;
  agentRunId?: string;
  toolName: string;
  args: JsonValue;
  reason?: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalService {
  private readonly pending = new Map<CallId, PendingApproval>();
  private readonly timeoutMs: number;

  constructor(private readonly options: ApprovalServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  request(input: ApprovalRequestInput): Promise<ApprovalDecision> {
    const callId = asCallId(this.options.ids.next("call"));
    const createdAt = this.options.clock.now();
    const expiresAt = new Date(
      this.options.clock.nowMs() + this.timeoutMs,
    ).toISOString();

    const request: ApprovalRequest = {
      callId,
      sessionId: this.options.sessionId,
      runId: input.runId,
      taskId: input.taskId,
      ...(input.agentRunId
        ? { agentRunId: asAgentRunId(input.agentRunId) }
        : {}),
      toolName: input.toolName,
      args: input.args,
      createdAt,
      expiresAt,
      ...(input.reason ? { reason: input.reason } : {}),
    };

    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        this.options.emit({
          type: "approval.resolved",
          callId,
          decision: "denied",
          reason: "timeout",
        });
        resolve("denied");
      }, this.timeoutMs);

      this.pending.set(callId, { request, resolve, timer });
      this.options.emit({ type: "approval.required", request });
    });
  }

  resolve(callId: CallId, decision: ApprovalDecision): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(callId);
    this.options.emit({ type: "approval.resolved", callId, decision });
    pending.resolve(decision);
    return true;
  }

  cancelRun(runId: RunId, reason = "run cancelled"): number {
    let cancelled = 0;
    for (const [callId, pending] of this.pending) {
      if (pending.request.runId !== runId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(callId);
      this.options.emit({
        type: "approval.resolved",
        callId,
        decision: "denied",
        reason,
      });
      pending.resolve("denied");
      cancelled++;
    }
    return cancelled;
  }

  listPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((pending) => pending.request);
  }

  dispose(): void {
    for (const [callId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(callId);
      pending.resolve("denied");
    }
  }
}
