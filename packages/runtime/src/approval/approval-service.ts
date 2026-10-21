/**
 * ApprovalService —— 工具审批与计划方案审批
 *
 * 两类审批共用同一个待处理队列、超时与事件通道：
 * - tool：mutating 工具的逐次确认
 * - plan：计划模式下的一次性方案确认，可携带用户选择与反馈
 */

import {
  asAgentRunId,
  asCallId,
  type ApprovalDecision,
  type ApprovalKind,
  type ApprovalRequest,
  type ApprovalResolution,
  type CallId,
  type JsonValue,
  type PlanProposalSet,
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
  /** 审批类型；缺省为 tool */
  kind?: ApprovalKind;
  /** 计划审批载荷 */
  plan?: PlanProposalSet;
  /** 单次请求的超时覆盖（计划确认通常更久） */
  timeoutMs?: number;
  /** 运行取消信号 */
  signal?: AbortSignal;
}

/** 审批结果；工具审批只关心 decision */
export interface ApprovalOutcome {
  decision: ApprovalDecision;
  selectedProposalIds?: string[];
  feedback?: string;
  /** 超时、取消等由服务端生成的原因 */
  reason?: string;
}

interface PendingApproval {
  request: ApprovalRequest;
  settle: (outcome: ApprovalOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ApprovalService {
  private readonly pending = new Map<CallId, PendingApproval>();
  private readonly timeoutMs: number;

  constructor(private readonly options: ApprovalServiceOptions) {
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  request(input: ApprovalRequestInput): Promise<ApprovalOutcome> {
    if (input.signal?.aborted) {
      return Promise.resolve({ decision: "denied", reason: "aborted" });
    }

    const callId = asCallId(this.options.ids.next("call"));
    const createdAt = this.options.clock.now();
    const timeoutMs = input.timeoutMs ?? this.timeoutMs;
    const expiresAt = new Date(
      this.options.clock.nowMs() + timeoutMs,
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
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.plan ? { plan: input.plan } : {}),
    };

    return new Promise<ApprovalOutcome>((resolve) => {
      const onAbort = () =>
        settle({ decision: "denied", reason: "aborted" });

      const settle = (outcome: ApprovalOutcome): void => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
        if (!this.pending.delete(callId)) return;
        this.options.emit({
          type: "approval.resolved",
          callId,
          decision: outcome.decision,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
          ...(request.kind ? { kind: request.kind } : {}),
          ...(outcome.selectedProposalIds
            ? { selectedProposalIds: outcome.selectedProposalIds }
            : {}),
          ...(outcome.feedback ? { feedback: outcome.feedback } : {}),
        });
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        settle({ decision: "denied", reason: "timeout" });
      }, timeoutMs);

      if (input.signal) {
        input.signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pending.set(callId, { request, settle, timer });
      this.options.emit({ type: "approval.required", request });
    });
  }

  resolve(
    callId: CallId,
    resolution: ApprovalDecision | ApprovalResolution,
  ): boolean {
    const pending = this.pending.get(callId);
    if (!pending) return false;
    const normalized: ApprovalOutcome =
      typeof resolution === "string"
        ? { decision: resolution }
        : {
            decision: resolution.decision,
            ...(resolution.selectedProposalIds
              ? { selectedProposalIds: resolution.selectedProposalIds }
              : {}),
            ...(resolution.feedback !== undefined
              ? { feedback: resolution.feedback }
              : {}),
          };
    pending.settle(normalized);
    return true;
  }

  cancelRun(runId: RunId, reason = "run cancelled"): number {
    let cancelled = 0;
    for (const pending of [...this.pending.values()]) {
      if (pending.request.runId !== runId) continue;
      pending.settle({ decision: "denied", reason });
      cancelled++;
    }
    return cancelled;
  }

  listPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((pending) => pending.request);
  }

  dispose(): void {
    for (const pending of [...this.pending.values()]) {
      pending.settle({ decision: "denied", reason: "disposed" });
    }
  }
}
