/**
 * 审批与用户提问
 */

import type {
  AgentRunId,
  CallId,
  QuestionId,
  RunId,
  SessionId,
  TaskId,
} from "../ids.js";
import type { IsoTimestamp, JsonValue } from "../json.js";

export type ApprovalDecision = "approved" | "denied";

/** 审批类型：工具级确认或计划方案确认；缺省视为 tool */
export type ApprovalKind = "tool" | "plan";

/** 方案工作量估算 */
export type ProposalEffort = "small" | "medium" | "large";

/** 方案中涉及的一个文件及其修改点 */
export interface ProposalChangePoint {
  path: string;
  changes: string[];
}

/** 计划模式下 agent 提交的单个改进方案 */
export interface CodeProposal {
  id: string;
  title: string;
  summary: string;
  files: ProposalChangePoint[];
  rationale?: string;
  risks?: string;
  effort?: ProposalEffort;
  recommended?: boolean;
}

/** 一次提案的完整载荷 */
export interface PlanProposalSet {
  summary: string;
  proposals: CodeProposal[];
}

export interface ApprovalRequest {
  callId: CallId;
  sessionId: SessionId;
  runId: RunId;
  taskId: TaskId;
  agentRunId?: AgentRunId;
  toolName: string;
  args: JsonValue;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  reason?: string;
  /** 审批类型；缺省视为 tool，保持旧事件兼容 */
  kind?: ApprovalKind;
  /** 计划审批载荷；kind 为 plan 时存在 */
  plan?: PlanProposalSet;
}

/** 审批结果；工具审批只需要 decision，计划审批可携带选择与反馈 */
export interface ApprovalResolution {
  decision: ApprovalDecision;
  selectedProposalIds?: string[];
  feedback?: string;
}

export interface UserQuestion {
  questionId: QuestionId;
  sessionId: SessionId;
  runId: RunId;
  taskId: TaskId;
  question: string;
  options?: string[];
  allowFreeText: boolean;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

export interface UserAnswer {
  questionId: QuestionId;
  answer: string;
}
