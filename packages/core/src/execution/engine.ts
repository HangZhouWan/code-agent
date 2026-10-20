/**
 * AgentExecutionEngine —— 单任务的 ReAct 执行循环
 *
 * 原生 tool calling 为主；不支持 tool call 的 provider 走 JSON fallback。
 */

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import {
  asCallId,
  abortError,
  serializeError,
  type JsonValue,
  type TaskResult,
} from "@code-agent/protocol";
import type { ToolContext } from "../tools/base.js";
import type { ToolExecutionDependencies } from "../tools/middleware.js";
import type { HooksEngine } from "../hooks/engine.js";
import type {
  AgentCheckpointSink,
  AgentCheckpointV1,
  SerializedToolCall,
} from "../checkpoint/types.js";
import type { TokenCounterLike } from "../context/types.js";
import type { AgentInvoker, AgentTaskInput, RunScope } from "./contracts.js";
import {
  extractText,
  extractToolCalls,
  serializeMessages,
  toLangChainMessages,
} from "./messages.js";
import {
  compactContext,
  renderContextSummary,
} from "../context/compressor.js";
import { createHeuristicTokenCounter } from "../context/token-counter.js";
import type {
  ContextBudget,
  ContextSummarizer,
} from "../context/types.js";
import { buildInitialMessages, buildSystemPrompt } from "./prompt-builder.js";
import { parseFallbackThought } from "./thought-parser.js";
import { ToolExecutor } from "./tool-executor.js";
import { ToolNames } from "../tools/tool-names.js";

/** 代码任务描述中出现这些词时，视为需要落盘文件变更 */
const FILE_WRITE_INTENT =
  /创建|新建|生成|写入|保存|create|write|generate|save/i;

/** 提示模型补一次文件写入 */
const FILE_WRITE_NUDGE =
  "You have not created or modified any file. This task requires a file change. " +
  "Use file_write (or file_edit) now, then summarize the result.";

function expectsFileWrite(input: AgentTaskInput): boolean {
  return input.role === "code" && FILE_WRITE_INTENT.test(input.description);
}

/**
 * 是否尝试过写文件。
 *
 * 只要模型发起过 file_write/file_edit 就算（即使被用户拒绝或执行失败），
 * 用于区分“从未尝试写入”和“写入被拒/失败后如实汇报”。
 */
function attemptedFileWrite(history: SerializedToolCall[]): boolean {
  return history.some(
    (call) =>
      call.name === ToolNames.FILE_WRITE ||
      call.name === ToolNames.FILE_EDIT,
  );
}


export interface ChatModelLike {
  invoke(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<BaseMessage>;
  stream?(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ):
    | AsyncIterable<BaseMessage>
    | Promise<AsyncIterable<BaseMessage>>;
  bindTools?(tools: StructuredTool[]): ChatModelLike;
}

export interface AgentExecutionEngineOptions {
  supportsNativeToolCalling?: boolean;
  checkpoints?: AgentCheckpointSink;
  toolDependencies?: ToolExecutionDependencies;
  hooks?: HooksEngine;
  tokenCounter?: TokenCounterLike;
  contextBudget?: ContextBudget;
  contextSummarizer?: ContextSummarizer;
  inlineToolResultLimit?: number;
  onCheckpointError?: (error: unknown) => void;
  now?: () => string;
}

const DEFAULT_MAX_ITERATIONS = 15;
const DEFAULT_TIMEOUT_MS = 300_000;

function concatMessages(
  left: BaseMessage,
  right: BaseMessage,
): BaseMessage {
  const candidate = left as unknown as {
    concat?: (other: AIMessageChunk) => BaseMessage;
  };
  if (typeof candidate.concat === "function") {
    return candidate.concat(right as AIMessageChunk);
  }
  return right;
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

export class AgentExecutionEngine implements AgentInvoker {
  private readonly supportsNative: boolean;
  private readonly now: () => string;
  private readonly tokenCounter?: TokenCounterLike;

  constructor(
    private readonly model: ChatModelLike,
    private readonly options: AgentExecutionEngineOptions = {},
  ) {
    this.supportsNative = options.supportsNativeToolCalling ?? true;
    this.now = options.now ?? (() => new Date().toISOString());
    this.tokenCounter =
      options.tokenCounter ??
      (options.contextBudget
        ? createHeuristicTokenCounter(options.contextBudget.modelWindow)
        : undefined);
  }

  async invoke(
    input: AgentTaskInput,
    scope: RunScope,
  ): Promise<TaskResult> {
    const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const controller = new AbortController();
    const onAbort = () => controller.abort(scope.signal.reason);
    if (scope.signal.aborted) controller.abort(scope.signal.reason);
    else scope.signal.addEventListener("abort", onAbort, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const toolContext: ToolContext = {
      workspacePath: input.workspacePath,
      sessionId: scope.sessionId,
      runId: scope.runId,
      taskId: input.taskId,
      roleId: input.role,
      signal: controller.signal,
      ...(scope.requestApproval
        ? { requestApproval: scope.requestApproval }
        : {}),
      ...(scope.withWriteLock ? { withWriteLock: scope.withWriteLock } : {}),
      ...(scope.delegation ? { delegation: scope.delegation } : {}),
      ...(scope.emit ? { emit: scope.emit } : {}),
    };

    const toolExecutor = new ToolExecutor(
      input.tools,
      this.options.toolDependencies,
    );
    const messages = buildInitialMessages(input);
    const toolHistory: SerializedToolCall[] = [];
    const startedAt = this.now();

    const saveCheckpoint = async (
      step: number,
      status: AgentCheckpointV1["status"],
      pendingTool?: AgentCheckpointV1["pendingTool"],
    ): Promise<void> => {
      if (!this.options.checkpoints) return;
      try {
        const serialized = serializeMessages(messages);
        const checkpoint: AgentCheckpointV1 = {
          v: 1,
          sessionId: scope.sessionId,
          runId: scope.runId,
          taskId: input.taskId,
          roleId: input.role,
          step,
          status,
          messages: serialized,
          tokenCount: this.tokenCounter?.countMessages(serialized) ?? 0,
          toolHistory: [...toolHistory],
          ...(pendingTool ? { pendingTool } : {}),
          startedAt,
          updatedAt: this.now(),
        };
        await this.options.checkpoints.save(checkpoint);
      } catch (error) {
        this.options.onCheckpointError?.(error);
      }
    };

    const useNative =
      this.supportsNative &&
      input.tools.length > 0 &&
      typeof this.model.bindTools === "function";

    try {
      await this.options.hooks?.trigger("run:start", {
        agentId: input.role,
        data: { taskId: input.taskId, role: input.role },
      });

      const result = useNative
        ? await this.runNative(
            input,
            scope,
            messages,
            toolExecutor,
            toolContext,
            toolHistory,
            controller,
            () => timedOut,
            saveCheckpoint,
            maxIterations,
          )
        : await this.runFallback(
            input,
            messages,
            toolExecutor,
            toolContext,
            toolHistory,
            controller,
            () => timedOut,
            saveCheckpoint,
            maxIterations,
          );

      await this.options.hooks?.trigger("run:end", {
        agentId: input.role,
        data: { taskId: input.taskId, status: result.status },
      });
      return result;
    } finally {
      clearTimeout(timer);
      scope.signal.removeEventListener("abort", onAbort);
    }
  }

  private async compactIfNeeded(messages: BaseMessage[]): Promise<void> {
    if (!this.options.contextBudget || !this.tokenCounter) return;

    const serialized = serializeMessages(messages);
    const result = await compactContext({
      messages: serialized,
      budget: this.options.contextBudget,
      counter: this.tokenCounter,
      ...(this.options.contextSummarizer
        ? { summarizer: this.options.contextSummarizer }
        : {}),
      ...(this.options.inlineToolResultLimit
        ? { inlineToolResultLimit: this.options.inlineToolResultLimit }
        : {}),
    });

    if (result.strategy === "none") return;

    const rebuilt = toLangChainMessages(result.messages);
    if (result.summary) {
      rebuilt.splice(
        rebuilt.length > 0 ? 1 : 0,
        0,
        new SystemMessage({
          content: renderContextSummary(result.summary),
        }),
      );
    }
    messages.length = 0;
    messages.push(...rebuilt);

    await this.options.hooks?.trigger("context:compact", {
      agentId: "engine",
      data: {
        beforeTokens: result.beforeTokens,
        afterTokens: result.afterTokens,
        strategy: result.strategy,
      },
    });
  }

  private async runNative(
    input: AgentTaskInput,
    scope: RunScope,
    messages: BaseMessage[],
    toolExecutor: ToolExecutor,
    toolContext: ToolContext,
    toolHistory: SerializedToolCall[],
    controller: AbortController,
    isTimedOut: () => boolean,
    saveCheckpoint: (
      step: number,
      status: AgentCheckpointV1["status"],
      pendingTool?: AgentCheckpointV1["pendingTool"],
    ) => Promise<void>,
    maxIterations: number,
  ): Promise<TaskResult> {
    const bound = this.model.bindTools!(
      toolExecutor.toLangChainTools(toolContext),
    ) as ChatModelLike;
    let nudgedForFileWrite = false;

    for (let step = 0; step < maxIterations; step++) {
      if (controller.signal.aborted) {
        return this.abortResult(input, isTimedOut());
      }

      await saveCheckpoint(step, "running");
      await this.options.hooks?.trigger("llm:before", {
        agentId: input.role,
        data: { step, messageCount: messages.length },
      });

      await this.compactIfNeeded(messages);

      let response: BaseMessage;
      try {
        if (typeof bound.stream === "function") {
          let aggregate: BaseMessage | undefined;
          // LangChain v1 的 Runnable.stream() 返回 Promise<IterableReadableStream>，
          // 自定义 fake 可能直接返回 AsyncIterable；await 对两者都成立。
          const stream = await bound.stream(messages, {
            signal: controller.signal,
          });
          for await (const chunk of stream) {
            const delta = extractText(chunk);
            if (delta) {
              scope.emit?.({
                type: "message.delta",
                messageId: `assistant_${step}`,
                delta,
              });
            }
            aggregate = aggregate
              ? concatMessages(aggregate, chunk)
              : chunk;
          }
          response = aggregate ?? new AIMessage({ content: "" });
        } else {
          response = await bound.invoke(messages, {
            signal: controller.signal,
          });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return this.abortResult(input, isTimedOut());
        }
        return this.failure(
          input,
          "failed",
          serializeError(error, "LLM_FATAL"),
        );
      }

      await this.options.hooks?.trigger("llm:after", {
        agentId: input.role,
        data: { step, toolCalls: extractToolCalls(response).length },
      });

      messages.push(response);
      const calls = extractToolCalls(response);

      if (calls.length === 0) {
        const text = extractText(response);

        // 创建类任务必须有成功的文件写入；否则先提醒模型一次，
        // 仍不写则判定失败，避免“未落盘却报告完成”。
        if (expectsFileWrite(input) && !attemptedFileWrite(toolHistory)) {
          if (!nudgedForFileWrite) {
            nudgedForFileWrite = true;
            messages.push(new HumanMessage({ content: FILE_WRITE_NUDGE }));
            continue;
          }
          return this.failure(
            input,
            "failed",
            serializeError(
              new Error(
                "任务要求创建或修改文件，但未执行任何成功的 file_write/file_edit",
              ),
              "VALIDATION",
            ),
          );
        }

        return this.success(input, text || "Completed", toolHistory);
      }

      for (const call of calls) {
        if (controller.signal.aborted) {
          return this.abortResult(input, isTimedOut());
        }

        const callId = asCallId(call.id);
        const definition = toolExecutor.get(call.name);
        const started = Date.now();
        scope.emit?.({
          type: "tool.started",
          callId,
          runId: scope.runId,
          taskId: input.taskId,
          toolName: call.name,
          args: toJsonValue(call.args),
        });

        await saveCheckpoint(step + 1, "awaiting_tool", {
          callId,
          name: call.name,
          args: toJsonValue(call.args),
          sideEffect:
            definition?.sideEffect ??
            (definition?.permission === "confirm" ? "mutating" : "none"),
        });

        const result = await toolExecutor.execute(call, toolContext);
        toolHistory.push({
          callId,
          name: call.name,
          args: toJsonValue(call.args),
          ok: result.ok,
          content: result.content,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        });

        messages.push(
          new ToolMessage({
            content: result.content,
            tool_call_id: call.id,
          }),
        );

        scope.emit?.({
          type: "tool.finished",
          callId,
          taskId: input.taskId,
          ok: result.ok,
          resultPreview: result.content.slice(0, 500),
          durationMs: Date.now() - started,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        });

        await saveCheckpoint(step + 1, "running");
      }
    }

    return this.failure(
      input,
      "timeout",
      serializeError(
        new Error(`Max iterations (${maxIterations}) reached`),
        "TIMEOUT",
      ),
    );
  }

  private async runFallback(
    input: AgentTaskInput,
    messages: BaseMessage[],
    toolExecutor: ToolExecutor,
    toolContext: ToolContext,
    toolHistory: SerializedToolCall[],
    controller: AbortController,
    isTimedOut: () => boolean,
    saveCheckpoint: (
      step: number,
      status: AgentCheckpointV1["status"],
    ) => Promise<void>,
    maxIterations: number,
  ): Promise<TaskResult> {
    const toolList = input.tools
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");
    const fallbackSystem = [
      buildSystemPrompt(input),
      "",
      "You must respond with a single JSON object:",
      '{"decision":"use_tool"|"done"|"replan","toolCall":{"name":"...","args":{}},"summary":"..."}',
      "Use decision=use_tool when you need a tool. Use decision=done when finished.",
      "Available tools:",
      toolList || "(none)",
    ].join("\n");

    messages[0] = new SystemMessage({ content: fallbackSystem });
    let nudgedForFileWrite = false;

    for (let step = 0; step < maxIterations; step++) {
      if (controller.signal.aborted) {
        return this.abortResult(input, isTimedOut());
      }
      await saveCheckpoint(step, "running");

      await this.compactIfNeeded(messages);

      let response: BaseMessage;
      try {
        response = await this.model.invoke(messages, {
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return this.abortResult(input, isTimedOut());
        }
        return this.failure(
          input,
          "failed",
          serializeError(error, "LLM_FATAL"),
        );
      }

      const text = extractText(response);
      const thought = parseFallbackThought(text);

      if (thought.decision === "done") {
        if (expectsFileWrite(input) && !attemptedFileWrite(toolHistory)) {
          if (!nudgedForFileWrite) {
            nudgedForFileWrite = true;
            messages.push(response);
            messages.push(
              new HumanMessage({
                content:
                  FILE_WRITE_NUDGE +
                  ' Respond with decision="use_tool" and a file_write toolCall.',
              }),
            );
            continue;
          }
          return this.failure(
            input,
            "failed",
            serializeError(
              new Error(
                "任务要求创建或修改文件，但未执行任何成功的 file_write/file_edit",
              ),
              "VALIDATION",
            ),
          );
        }
        return this.success(
          input,
          thought.summary ?? text ?? "Completed",
          toolHistory,
        );
      }
      if (thought.decision === "replan") {
        return {
          taskId: input.taskId,
          role: input.role,
          status: "replan_needed",
          summary: thought.summary ?? thought.reason ?? text,
        };
      }
      if (!thought.toolCall) {
        return this.failure(
          input,
          "failed",
          serializeError(new Error("Missing toolCall"), "VALIDATION"),
        );
      }

      const call = {
        id: `fallback-${step}`,
        name: thought.toolCall.name,
        args: thought.toolCall.args,
      };
      const result = await toolExecutor.execute(call, toolContext);
      toolHistory.push({
        callId: asCallId(call.id),
        name: call.name,
        args: toJsonValue(call.args),
        ok: result.ok,
        content: result.content,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      });
      messages.push(
        new HumanMessage({
          content: `[tool result: ${call.name}]\n${result.content}`,
        }),
      );
    }

    return this.failure(
      input,
      "timeout",
      serializeError(
        new Error(`Max iterations (${maxIterations}) reached`),
        "TIMEOUT",
      ),
    );
  }

  private success(
    input: AgentTaskInput,
    summary: string,
    toolHistory: SerializedToolCall[],
  ): TaskResult {
    const filesChanged = toolHistory
      .filter(
        (call) =>
          (call.name === "file_write" || call.name === "file_edit") &&
          typeof (call.args as { path?: unknown }).path === "string",
      )
      .map((call) => ({
        path: (call.args as { path: string }).path,
        changeType: "modified" as const,
      }));

    return {
      taskId: input.taskId,
      role: input.role,
      status: "success",
      summary,
      ...(filesChanged.length > 0
        ? { artifacts: { filesChanged } }
        : {}),
    };
  }

  private failure(
    input: AgentTaskInput,
    status: "failed" | "timeout",
    error: TaskResult["error"],
  ): TaskResult {
    return {
      taskId: input.taskId,
      role: input.role,
      status,
      summary: error?.message ?? "Task failed",
      ...(error ? { error } : {}),
    };
  }

  private abortResult(
    input: AgentTaskInput,
    timedOut: boolean,
  ): TaskResult {
    if (timedOut) {
      return this.failure(
        input,
        "timeout",
        serializeError(new Error("Task timed out"), "TIMEOUT"),
      );
    }
    return {
      taskId: input.taskId,
      role: input.role,
      status: "cancelled",
      summary: "Task cancelled",
      error: abortError(),
    };
  }
}

/** 便捷构造 */
export function createExecutionEngine(
  model: ChatModelLike,
  options?: AgentExecutionEngineOptions,
): AgentExecutionEngine {
  return new AgentExecutionEngine(model, options);
}
