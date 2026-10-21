/**
 * PlanApprovalService —— 计划模式的提案与批准状态
 *
 * 每个 run 经历 idle → pending → approved | rejected。
 * 未批准前，mutating 工具会被 core 的工具闸门拦截。
 */

import {
  ToolNames,
  type PlanContext,
  type PlanSubmitInput,
  type PlanSubmitOutcome,
} from "@code-agent/core";
import type {
  CodeProposal,
  RunId,
  TaskId,
} from "@code-agent/protocol";
import type {
  ApprovalOutcome,
  ApprovalService,
} from "../approval/approval-service.js";

type PlanPhase = "idle" | "pending" | "approved" | "rejected" | "disabled";

export interface PlanApprovalServiceOptions {
  approvalService: ApprovalService;
  /** 会话是否启用计划模式 */
  enabled: boolean;
  /** 单次方案确认的超时时间，默认 5 分钟 */
  timeoutMs?: number;
  /** 单个 run 最多提交次数，防止无限拒绝循环 */
  maxSubmissions?: number;
}

export interface PlanApprovalContext {
  runId: RunId;
  taskId: TaskId;
  signal?: AbortSignal;
}

interface PendingPlan {
  promise: Promise<PlanSubmitOutcome>;
  fingerprint: string;
}

/** 将方案集合序列化为稳定的指纹，用于识别重复提交 */
function fingerprintPlan(input: PlanSubmitInput): string {
  return JSON.stringify({
    summary: input.summary,
    proposals: input.proposals.map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      files: proposal.files,
      rationale: proposal.rationale,
      risks: proposal.risks,
      effort: proposal.effort,
      recommended: proposal.recommended,
    })),
  });
}

/**
 * 归一化用户选择。
 *
 * 输入：提交的方案与客户端选择
 * 输出：去重、过滤非法 ID 后的选择；为空时回退到推荐方案或第一个方案
 */
function normalizeSelection(
  proposals: CodeProposal[],
  requested: string[] | undefined,
): string[] {
  const valid = new Set(proposals.map((proposal) => proposal.id));
  const picked = [...new Set(requested ?? [])].filter((id) => valid.has(id));
  if (picked.length > 0) return picked;
  const recommended = proposals.find((proposal) => proposal.recommended);
  return [recommended?.id ?? proposals[0]!.id];
}

export class PlanApprovalService {
  private readonly approvalService: ApprovalService;
  private readonly timeoutMs: number;
  private readonly maxSubmissions: number;
  private enabled: boolean;
  private phase: PlanPhase;
  private runId: RunId | null = null;
  private pending: PendingPlan | null = null;
  private result: PlanSubmitOutcome | null = null;
  private lastRejectedFingerprint: string | null = null;
  private selected: string[] = [];
  private submissions = 0;

  constructor(options: PlanApprovalServiceOptions) {
    this.approvalService = options.approvalService;
    this.enabled = options.enabled;
    this.phase = options.enabled ? "idle" : "disabled";
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this.maxSubmissions = options.maxSubmissions ?? 5;
  }

  /** 新 run 开始时重置全部状态 */
  beginRun(runId: RunId): void {
    this.runId = runId;
    this.phase = this.enabled ? "idle" : "disabled";
    this.pending = null;
    this.result = null;
    this.lastRejectedFingerprint = null;
    this.selected = [];
    this.submissions = 0;
  }

  /** run 结束时清理；迟到的审批结果会被 runId 守卫丢弃 */
  endRun(runId: RunId): void {
    if (this.runId !== runId) return;
    this.runId = null;
    this.phase = this.enabled ? "idle" : "disabled";
    this.pending = null;
    this.result = null;
    this.selected = [];
  }

  /** 会话级开关；调用方需保证没有运行中的 run */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.phase = enabled ? "idle" : "disabled";
    this.pending = null;
    this.result = null;
    this.lastRejectedFingerprint = null;
    this.selected = [];
    this.submissions = 0;
  }

  isRequired(): boolean {
    return this.enabled;
  }

  isApproved(): boolean {
    return this.phase === "approved";
  }

  selectedProposalIds(): readonly string[] {
    return this.selected;
  }

  /** 提供给 core 工具闸门的实时上下文 */
  context(): PlanContext {
    return {
      required: this.enabled,
      isApproved: () => this.phase === "approved",
      selectedProposalIds: () => this.selected,
    };
  }

  /**
   * 提交方案并等待用户决定。
   *
   * 重复提交同一份方案会复用 pending promise 或已拒绝结果，
   * 避免对用户重复弹窗。
   */
  submit(
    input: PlanSubmitInput,
    ctx: PlanApprovalContext,
  ): Promise<PlanSubmitOutcome> {
    if (!this.enabled) {
      return Promise.resolve({
        status: "rejected",
        selectedProposalIds: [],
        planMode: false,
        feedback:
          "Plan mode is off. Do not call submit_proposals; implement the request directly.",
      });
    }

    if (this.phase === "approved" && this.result) {
      return Promise.resolve(this.result);
    }

    const fingerprint = fingerprintPlan(input);

    if (this.pending) {
      if (this.pending.fingerprint === fingerprint) {
        return this.pending.promise;
      }
      return Promise.resolve({
        status: "rejected",
        selectedProposalIds: [],
        planMode: true,
        feedback:
          "Another proposal set is already awaiting approval. Wait for the user's decision.",
      });
    }

    if (
      this.phase === "rejected" &&
      this.lastRejectedFingerprint === fingerprint &&
      this.result
    ) {
      return Promise.resolve(this.result);
    }

    if (this.submissions >= this.maxSubmissions) {
      return Promise.resolve({
        status: "rejected",
        selectedProposalIds: [],
        planMode: true,
        feedback:
          "Too many proposal revisions in this run. Stop and report the blocker instead.",
      });
    }

    this.submissions++;
    this.phase = "pending";
    const promise = this.requestApproval(input, ctx, fingerprint);
    this.pending = { promise, fingerprint };
    return promise;
  }

  private async requestApproval(
    input: PlanSubmitInput,
    ctx: PlanApprovalContext,
    fingerprint: string,
  ): Promise<PlanSubmitOutcome> {
    const outcome: ApprovalOutcome = await this.approvalService.request({
      runId: ctx.runId,
      taskId: ctx.taskId,
      toolName: ToolNames.SUBMIT_PROPOSALS,
      args: {
        summary: input.summary,
        proposalIds: input.proposals.map((proposal) => proposal.id),
      },
      kind: "plan",
      plan: { summary: input.summary, proposals: input.proposals },
      timeoutMs: this.timeoutMs,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    // run 已结束：丢弃迟到结果，避免污染下一次运行
    if (this.runId !== ctx.runId) {
      return {
        status: "rejected",
        selectedProposalIds: [],
        planMode: this.enabled,
        feedback: "Run ended before the proposal was approved.",
      };
    }

    this.pending = null;

    if (outcome.decision === "approved") {
      const selectedProposalIds = normalizeSelection(
        input.proposals,
        outcome.selectedProposalIds,
      );
      const result: PlanSubmitOutcome = {
        status: "approved",
        selectedProposalIds,
        selectedProposals: input.proposals.filter((proposal) =>
          selectedProposalIds.includes(proposal.id),
        ),
        planMode: true,
      };
      this.phase = "approved";
      this.selected = selectedProposalIds;
      this.result = result;
      return result;
    }

    const result: PlanSubmitOutcome = {
      status: "rejected",
      selectedProposalIds: [],
      planMode: true,
      feedback: outcome.feedback ?? outcome.reason ?? "Rejected by user",
    };
    this.phase = "rejected";
    this.lastRejectedFingerprint = fingerprint;
    this.result = result;
    return result;
  }
}
