/**
 * 上下文压缩类型
 */

import type { SerializedMessage } from "@code-agent/protocol";

export interface ContextBudget {
  modelWindow: number;
  reservedOutput: number;
  safetyMargin: number;
  /** 可用于输入的 token 上限 */
  effective: number;
  /** 触发压缩的阈值（0-1） */
  softThreshold: number;
  /** 强制裁剪的阈值（0-1） */
  hardThreshold: number;
}

export function createContextBudget(input: {
  modelWindow: number;
  reservedOutput?: number;
  safetyMargin?: number;
  softThreshold?: number;
  hardThreshold?: number;
}): ContextBudget {
  const reservedOutput = input.reservedOutput ?? 8_192;
  const safetyMargin = input.safetyMargin ?? 0.05;
  const softThreshold = input.softThreshold ?? 0.75;
  const hardThreshold = input.hardThreshold ?? 0.9;
  if (softThreshold >= hardThreshold) {
    throw new Error("softThreshold must be less than hardThreshold");
  }
  const effective = Math.max(
    1_024,
    Math.floor(input.modelWindow - reservedOutput - input.modelWindow * safetyMargin),
  );
  return {
    modelWindow: input.modelWindow,
    reservedOutput,
    safetyMargin,
    effective,
    softThreshold,
    hardThreshold,
  };
}

export interface ContextSummary {
  version: 1;
  coveredMessageIds: string[];
  userGoals: string[];
  decisions: string[];
  facts: string[];
  files: Array<{ path: string; change: string }>;
  commands: Array<{ command: string; result: string }>;
  errors: Array<{ message: string; resolved: boolean }>;
  openQuestions: string[];
  constraints: string[];
  tokenCount?: number;
}

export interface ContextSummarizer {
  summarize(input: {
    messages: SerializedMessage[];
    previousSummary?: ContextSummary;
  }): Promise<ContextSummary>;
}

export interface TokenCounterLike {
  count(text: string): number;
  countValue(value: unknown): number;
  countMessage(message: SerializedMessage): number;
  countMessages(messages: SerializedMessage[]): number;
}

export type CompactionStrategy =
  | "none"
  | "artifact"
  | "dedupe"
  | "window"
  | "summary"
  | "fallback";

export interface CompactionInput {
  messages: SerializedMessage[];
  summary?: ContextSummary;
  budget: ContextBudget;
  counter: TokenCounterLike;
  /** 最近窗口 token 预算；默认 effective * 0.3 */
  keepRecentTokens?: number;
  /** 永不删除的消息 ID */
  pinnedMessageIds?: string[];
  summarizer?: ContextSummarizer;
  /** 单条工具输出内联上限；默认 8000 字符 */
  inlineToolResultLimit?: number;
}

export interface CompactionResult {
  messages: SerializedMessage[];
  summary?: ContextSummary;
  beforeTokens: number;
  afterTokens: number;
  strategy: CompactionStrategy;
  summarizedMessageIds: string[];
  droppedToolResults: number;
}

export interface ContextSnapshot {
  sessionId: string;
  messages: SerializedMessage[];
  summary?: ContextSummary;
  tokenCount: number;
}

export class ContextOverflowError extends Error {
  constructor(
    public readonly tokens: number,
    public readonly limit: number,
  ) {
    super(`Context overflow: ${tokens} tokens exceeds limit ${limit}`);
    this.name = "ContextOverflowError";
  }
}
