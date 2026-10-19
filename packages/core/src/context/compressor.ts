/**
 * 上下文压缩流水线
 *
 * 顺序：工具输出截断/外置 → 分组（保护 tool pair）→ 保留最近窗口
 *      → LLM/确定性摘要 → 预算裁剪 → 硬溢出报错
 */

import type { SerializedMessage } from "@code-agent/protocol";
import {
  ContextOverflowError,
  type CompactionInput,
  type CompactionResult,
  type CompactionStrategy,
  type ContextSummary,
  type ContextSummarizer,
  type TokenCounterLike,
} from "./types.js";

interface MessageGroup {
  messages: SerializedMessage[];
  ids: string[];
}

const MAX_SUMMARY_ITEMS = 20;

function messageId(message: SerializedMessage, index: number): string {
  return message.id ?? `msg-${index}`;
}

function groupMessages(messages: SerializedMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const id = messageId(message, i);

    if (message.role === "ai" && (message.toolCalls?.length ?? 0) > 0) {
      const toolCallIds = new Set(message.toolCalls!.map((call) => call.id));
      const group: SerializedMessage[] = [message];
      const ids = [id];
      let j = i + 1;
      while (j < messages.length) {
        const candidate = messages[j];
        if (
          candidate.role !== "tool" ||
          !candidate.toolCallId ||
          !toolCallIds.has(candidate.toolCallId)
        ) {
          break;
        }
        group.push(candidate);
        ids.push(messageId(candidate, j));
        j++;
      }
      groups.push({ messages: group, ids });
      i = j - 1;
    } else {
      groups.push({ messages: [message], ids: [id] });
    }
  }

  return groups;
}

function truncateToolMessages(
  messages: SerializedMessage[],
  limit: number,
  skipIds: Set<string>,
): { messages: SerializedMessage[]; dropped: number } {
  let dropped = 0;
  const result = messages.map((message, index) => {
    if (
      message.role !== "tool" ||
      message.content.length <= limit ||
      skipIds.has(messageId(message, index))
    ) {
      return message;
    }
    dropped++;
    const head = message.content.slice(0, Math.floor(limit * 0.6));
    const tail = message.content.slice(-Math.floor(limit * 0.3));
    return {
      ...message,
      content: `${head}\n...[tool output truncated; ${message.content.length} chars total]...\n${tail}`,
    };
  });
  return { messages: result, dropped };
}

function groupTokens(counter: TokenCounterLike, group: MessageGroup): number {
  return counter.countMessages(group.messages);
}

function flattenGroups(groups: MessageGroup[]): SerializedMessage[] {
  return groups.flatMap((group) => group.messages);
}

function dedupeCap(values: string[], cap = MAX_SUMMARY_ITEMS): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, cap);
}

function mergeFiles(
  a: ContextSummary["files"],
  b: ContextSummary["files"],
): ContextSummary["files"] {
  const map = new Map<string, string>();
  for (const item of [...a, ...b]) {
    map.set(item.path, item.change);
  }
  return [...map.entries()]
    .slice(0, MAX_SUMMARY_ITEMS)
    .map(([path, change]) => ({ path, change }));
}

function mergeCommands(
  a: ContextSummary["commands"],
  b: ContextSummary["commands"],
): ContextSummary["commands"] {
  const map = new Map<string, string>();
  for (const item of [...a, ...b]) {
    map.set(item.command, item.result);
  }
  return [...map.entries()]
    .slice(-MAX_SUMMARY_ITEMS)
    .map(([command, result]) => ({ command, result }));
}

function mergeErrors(
  a: ContextSummary["errors"],
  b: ContextSummary["errors"],
): ContextSummary["errors"] {
  const map = new Map<string, boolean>();
  for (const item of [...a, ...b]) {
    map.set(item.message, item.resolved);
  }
  return [...map.entries()]
    .slice(-MAX_SUMMARY_ITEMS)
    .map(([message, resolved]) => ({ message, resolved }));
}

export function mergeContextSummary(
  previous: ContextSummary | undefined,
  next: ContextSummary,
): ContextSummary {
  if (!previous) return next;
  return {
    version: 1,
    coveredMessageIds: dedupeCap(
      [...previous.coveredMessageIds, ...next.coveredMessageIds],
      10_000,
    ),
    userGoals: dedupeCap([...previous.userGoals, ...next.userGoals]),
    decisions: dedupeCap([...previous.decisions, ...next.decisions]),
    facts: dedupeCap([...previous.facts, ...next.facts]),
    files: mergeFiles(previous.files, next.files),
    commands: mergeCommands(previous.commands, next.commands),
    errors: mergeErrors(previous.errors, next.errors),
    openQuestions: dedupeCap([
      ...previous.openQuestions,
      ...next.openQuestions,
    ]),
    constraints: dedupeCap([...previous.constraints, ...next.constraints]),
    ...(next.tokenCount !== undefined ? { tokenCount: next.tokenCount } : {}),
  };
}

/** 确定性摘要：不调用模型，用于 fallback 与测试 */
export function deterministicSummary(
  messages: SerializedMessage[],
  previousSummary?: ContextSummary,
): ContextSummary {
  const goals: string[] = [];
  const commands: ContextSummary["commands"] = [];
  const files: ContextSummary["files"] = [];
  const errors: ContextSummary["errors"] = [];
  const covered: string[] = [];

  const toolResults = new Map<string, string>();
  messages.forEach((message, index) => {
    covered.push(messageId(message, index));
    if (message.role === "tool" && message.toolCallId) {
      toolResults.set(message.toolCallId, message.content);
    }
  });

  messages.forEach((message, index) => {
    const id = messageId(message, index);
    if (message.role === "human") {
      goals.push(message.content.slice(0, 200));
    }
    if (message.role === "ai" && message.toolCalls) {
      for (const call of message.toolCalls) {
        const result = toolResults.get(call.id) ?? "executed";
        commands.push({
          command: `${call.name} ${JSON.stringify(call.args).slice(0, 160)}`,
          result: result.slice(0, 160),
        });
        const pathValue = (call.args as { path?: unknown }).path;
        if (typeof pathValue === "string") {
          files.push({ path: pathValue, change: "touched" });
        }
      }
    }
    if (message.role === "tool" && /error|failed|exception/i.test(message.content)) {
      errors.push({ message: message.content.slice(0, 200), resolved: false });
    }
    void id;
  });

  const next: ContextSummary = {
    version: 1,
    coveredMessageIds: dedupeCap(covered, 10_000),
    userGoals: dedupeCap(goals),
    decisions: [],
    facts: [],
    files: mergeFiles([], files),
    commands: mergeCommands([], commands),
    errors: mergeErrors([], errors),
    openQuestions: [],
    constraints: [],
  };

  return mergeContextSummary(previousSummary, next);
}

export function renderContextSummary(summary: ContextSummary): string {
  const lines: string[] = ['<context_summary version="1">'];
  const push = (label: string, values: string[]) => {
    if (values.length > 0) lines.push(`${label}: ${values.join(" | ")}`);
  };
  push("user_goals", summary.userGoals);
  push("decisions", summary.decisions);
  push("facts", summary.facts);
  push(
    "files",
    summary.files.map((file) => `${file.path} (${file.change})`),
  );
  push(
    "commands",
    summary.commands.map((command) => `${command.command} => ${command.result}`),
  );
  push(
    "errors",
    summary.errors.map(
      (error) => `${error.message} (${error.resolved ? "resolved" : "open"})`,
    ),
  );
  push("open_questions", summary.openQuestions);
  push("constraints", summary.constraints);
  lines.push("</context_summary>");
  return lines.join("\n");
}

function summaryTokens(
  counter: TokenCounterLike,
  summary: ContextSummary | undefined,
): number {
  if (!summary) return 0;
  // 只计量最终注入 prompt 的文本，而不是整个摘要对象
  return counter.count(renderContextSummary(summary));
}

/**
 * 压缩上下文。
 *
 * @throws ContextOverflowError 当硬阈值下仍无法容纳
 */
export async function compactContext(
  input: CompactionInput,
): Promise<CompactionResult> {
  const { counter, budget } = input;
  const beforeTokens =
    counter.countMessages(input.messages) + summaryTokens(counter, input.summary);

  if (beforeTokens <= budget.effective * budget.softThreshold) {
    return {
      messages: input.messages,
      summary: input.summary,
      beforeTokens,
      afterTokens: beforeTokens,
      strategy: "none",
      summarizedMessageIds: [],
      droppedToolResults: 0,
    };
  }

  const pinnedIds = new Set(input.pinnedMessageIds ?? []);
  const inlineLimit = input.inlineToolResultLimit ?? 8_000;
  const truncated = truncateToolMessages(
    input.messages,
    inlineLimit,
    pinnedIds,
  );
  const groups = groupMessages(truncated.messages);

  if (groups.length === 0) {
    return {
      messages: [],
      summary: input.summary,
      beforeTokens,
      afterTokens: summaryTokens(counter, input.summary),
      strategy: "none",
      summarizedMessageIds: [],
      droppedToolResults: truncated.dropped,
    };
  }

  const pinned = new Set<number>();
  groups.forEach((group, index) => {
    if (group.messages.some((message) => message.role === "system")) {
      pinned.add(index);
    }
    if (group.ids.some((id) => pinnedIds.has(id))) {
      pinned.add(index);
    }
  });

  // 最后一条用户消息
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].messages.some((message) => message.role === "human")) {
      pinned.add(i);
      break;
    }
  }
  // 最近一个完整工具周期
  pinned.add(groups.length - 1);

  const keepRecentTokens =
    input.keepRecentTokens ?? Math.floor(budget.effective * 0.3);
  const recent = new Set<number>();
  let recentTokenCount = 0;
  for (let i = groups.length - 1; i >= 0; i--) {
    if (pinned.has(i)) {
      recent.add(i);
      continue;
    }
    const tokens = groupTokens(counter, groups[i]);
    if (recentTokenCount + tokens > keepRecentTokens) break;
    recent.add(i);
    recentTokenCount += tokens;
  }

  const middleGroups = groups.filter(
    (_group, index) => !pinned.has(index) && !recent.has(index),
  );

  let summary = input.summary;
  let summarizedMessageIds: string[] = [];
  if (middleGroups.length > 0) {
    const middleMessages = flattenGroups(middleGroups);
    summarizedMessageIds = middleGroups.flatMap((group) => group.ids);
    const nextSummary = await summarizeWithFallback(
      input.summarizer,
      middleMessages,
      summary,
    );
    summary = mergeContextSummary(summary, {
      ...nextSummary,
      coveredMessageIds: dedupeCap(
        [...nextSummary.coveredMessageIds, ...summarizedMessageIds],
        10_000,
      ),
    });
  }

  const keptIndices = new Set<number>();
  groups.forEach((_group, index) => {
    if (pinned.has(index) || recent.has(index)) {
      keptIndices.add(index);
    }
  });

  let strategy: CompactionStrategy =
    middleGroups.length > 0 ? "summary" : "window";

  const countKept = (override?: Map<number, MessageGroup>) => {
    const kept = [...keptIndices]
      .sort((a, b) => a - b)
      .map((index) => override?.get(index) ?? groups[index]);
    return (
      counter.countMessages(flattenGroups(kept)) +
      summaryTokens(counter, summary)
    );
  };

  let afterTokens = countKept();

  // 还超限：从最旧的非 pinned 组开始丢弃
  if (afterTokens > budget.effective) {
    strategy = "fallback";
    let lastHuman = -1;
    for (let i = groups.length - 1; i >= 0; i--) {
      if (groups[i].messages.some((message) => message.role === "human")) {
        lastHuman = i;
        break;
      }
    }
    const candidates = [...keptIndices]
      .sort((a, b) => a - b)
      .filter(
        (index) =>
          !pinned.has(index) &&
          index !== groups.length - 1 &&
          index !== lastHuman,
      );

    for (const index of candidates) {
      if (afterTokens <= budget.effective) break;
      keptIndices.delete(index);
      afterTokens = countKept();
    }

    // 最后手段：把保留的工具输出硬截断
    const truncatedGroups = new Map<number, MessageGroup>();
    for (const index of keptIndices) {
      const group = groups[index];
      truncatedGroups.set(index, {
        messages: truncateToolMessages(group.messages, 1_000, new Set())
          .messages,
        ids: group.ids,
      });
    }
    afterTokens = countKept(truncatedGroups);
    if (afterTokens > budget.effective) {
      throw new ContextOverflowError(afterTokens, budget.effective);
    }
  }

  const keptGroups = [...keptIndices]
    .sort((a, b) => a - b)
    .map((index) => groups[index]);

  if (afterTokens > budget.effective) {
    throw new ContextOverflowError(afterTokens, budget.effective);
  }

  const finalSummary = summary
    ? { ...summary, tokenCount: summaryTokens(counter, summary) }
    : undefined;

  return {
    messages: flattenGroups(keptGroups),
    summary: finalSummary,
    beforeTokens,
    afterTokens,
    strategy,
    summarizedMessageIds: dedupeCap(summarizedMessageIds, 10_000),
    droppedToolResults: truncated.dropped,
  };
}

async function summarizeWithFallback(
  summarizer: ContextSummarizer | undefined,
  messages: SerializedMessage[],
  previousSummary?: ContextSummary,
): Promise<ContextSummary> {
  if (!summarizer) {
    return deterministicSummary(messages, previousSummary);
  }
  try {
    return await summarizer.summarize({ messages, previousSummary });
  } catch {
    return deterministicSummary(messages, previousSummary);
  }
}
