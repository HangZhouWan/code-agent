/**
 * ContextManager —— 每会话上下文与压缩入口
 */

import type { SerializedMessage } from "@code-agent/protocol";
import { compactContext } from "./compressor.js";
import type {
  ContextBudget,
  ContextSnapshot,
  ContextSummarizer,
  ContextSummary,
  TokenCounterLike,
} from "./types.js";

export interface CompactOptions {
  pinnedMessageIds?: string[];
  keepRecentTokens?: number;
  inlineToolResultLimit?: number;
}

export class ContextManager {
  private readonly contexts = new Map<string, ContextSnapshot>();

  constructor(
    private readonly counter: TokenCounterLike,
    private readonly summarizer?: ContextSummarizer,
  ) {}

  create(
    sessionId: string,
    messages: SerializedMessage[] = [],
    summary?: ContextSummary,
  ): ContextSnapshot {
    const snapshot: ContextSnapshot = {
      sessionId,
      messages: [...messages],
      ...(summary ? { summary } : {}),
      tokenCount:
        this.counter.countMessages(messages) +
        (summary ? this.counter.countValue(summary) : 0),
    };
    this.contexts.set(sessionId, snapshot);
    return snapshot;
  }

  get(sessionId: string): ContextSnapshot | undefined {
    return this.contexts.get(sessionId);
  }

  async append(
    sessionId: string,
    message: SerializedMessage,
    budget: ContextBudget,
  ): Promise<ContextSnapshot> {
    const current = this.contexts.get(sessionId) ?? this.create(sessionId);
    const messages = [...current.messages, message];
    const snapshot: ContextSnapshot = {
      ...current,
      messages,
      tokenCount:
        this.counter.countMessages(messages) +
        (current.summary ? this.counter.countValue(current.summary) : 0),
    };
    this.contexts.set(sessionId, snapshot);

    if (snapshot.tokenCount > budget.effective * budget.softThreshold) {
      return this.compact(sessionId, budget);
    }
    return snapshot;
  }

  async compact(
    sessionId: string,
    budget: ContextBudget,
    options: CompactOptions = {},
  ): Promise<ContextSnapshot> {
    const current = this.contexts.get(sessionId) ?? this.create(sessionId);
    const result = await compactContext({
      messages: current.messages,
      ...(current.summary ? { summary: current.summary } : {}),
      budget,
      counter: this.counter,
      ...(this.summarizer ? { summarizer: this.summarizer } : {}),
      ...options,
    });

    const snapshot: ContextSnapshot = {
      sessionId,
      messages: result.messages,
      ...(result.summary ? { summary: result.summary } : {}),
      tokenCount: result.afterTokens,
    };
    this.contexts.set(sessionId, snapshot);
    return snapshot;
  }

  setSummary(sessionId: string, summary: ContextSummary): void {
    const current = this.contexts.get(sessionId) ?? this.create(sessionId);
    this.contexts.set(sessionId, {
      ...current,
      summary,
      tokenCount:
        this.counter.countMessages(current.messages) +
        this.counter.countValue(summary),
    });
  }

  delete(sessionId: string): boolean {
    return this.contexts.delete(sessionId);
  }

  get size(): number {
    return this.contexts.size;
  }
}
