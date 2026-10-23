/**
 * LLM 上下文摘要器
 *
 * 输出结构化 ContextSummary；失败时由 compactContext 回退到确定性摘要。
 */

import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { SerializedMessage } from "@code-agent/protocol";
import { deterministicSummary } from "./compressor.js";
import type { ContextSummary, ContextSummarizer } from "./types.js";

export interface SummaryModel {
  invoke(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<{ content: unknown }>;
}

export interface LlmContextSummarizerOptions {
  /** 摘要文本的 token 上限提示 */
  maxTokens?: number;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

function parseSummary(text: string): ContextSummary | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;

    const strings = (input: unknown): string[] =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === "string")
        : [];

    return {
      version: 1,
      coveredMessageIds: strings(value.coveredMessageIds),
      userGoals: strings(value.userGoals),
      decisions: strings(value.decisions),
      facts: strings(value.facts),
      files: Array.isArray(value.files)
        ? value.files
            .filter(
              (file): file is { path: string; change: string } =>
                typeof file === "object" &&
                file !== null &&
                typeof (file as { path?: unknown }).path === "string" &&
                typeof (file as { change?: unknown }).change === "string",
            )
            .map((file) => ({ path: file.path, change: file.change }))
        : [],
      commands: Array.isArray(value.commands)
        ? value.commands
            .filter(
              (command): command is { command: string; result: string } =>
                typeof command === "object" &&
                command !== null &&
                typeof (command as { command?: unknown }).command === "string" &&
                typeof (command as { result?: unknown }).result === "string",
            )
            .map((command) => ({
              command: command.command,
              result: command.result,
            }))
        : [],
      errors: Array.isArray(value.errors)
        ? value.errors
            .filter(
              (error): error is { message: string; resolved: boolean } =>
                typeof error === "object" &&
                error !== null &&
                typeof (error as { message?: unknown }).message === "string" &&
                typeof (error as { resolved?: unknown }).resolved === "boolean",
            )
            .map((error) => ({
              message: error.message,
              resolved: error.resolved,
            }))
        : [],
      openQuestions: strings(value.openQuestions),
      constraints: strings(value.constraints),
    };
  } catch {
    return null;
  }
}

function compactMessages(messages: SerializedMessage[]): string {
  return messages
    .map(
      (message) =>
        `[${message.role}] ${message.content.slice(0, 1_000)}`,
    )
    .join("\n")
    .slice(0, 30_000);
}

export class LlmContextSummarizer implements ContextSummarizer {
  constructor(
    private readonly model: SummaryModel,
    private readonly options: LlmContextSummarizerOptions = {},
  ) {}

  async summarize(input: {
    messages: SerializedMessage[];
    previousSummary?: ContextSummary;
  }): Promise<ContextSummary> {
    try {
      const response = await this.model.invoke([
        new SystemMessage({
          content: [
            "You compact conversation history for a coding agent.",
            "Return JSON only with this schema:",
            '{"userGoals":[],"decisions":[],"facts":[],"files":[{"path":"","change":""}],"commands":[{"command":"","result":""}],"errors":[{"message":"","resolved":false}],"openQuestions":[],"constraints":[]}',
            "Keep goals, decisions, files, commands, unresolved errors and user constraints.",
            "Drop greetings, repeated logs and raw tool output. Be concise.",
            `Keep the summary under ${this.options.maxTokens ?? 2_000} tokens.`,
          ].join("\n"),
        }),
        new HumanMessage({
          content: [
            "Previous summary:",
            input.previousSummary
              ? JSON.stringify(input.previousSummary)
              : "(none)",
            "",
            "Messages to compact:",
            compactMessages(input.messages),
          ].join("\n"),
        }),
      ]);

      const parsed = parseSummary(textContent(response.content));
      if (!parsed) {
        return deterministicSummary(
          input.messages,
          input.previousSummary,
        );
      }
      return {
        ...parsed,
        coveredMessageIds: input.messages
          .map((message) => message.id)
          .filter((id): id is string => Boolean(id)),
      };
    } catch {
      return deterministicSummary(input.messages, input.previousSummary);
    }
  }
}
