/**
 * 执行引擎入口
 */

export { AgentExecutionEngine, createExecutionEngine } from "./engine.js";
export type {
  ChatModelLike,
  AgentExecutionEngineOptions,
} from "./engine.js";
export type {
  AgentInvoker,
  AgentTaskInput,
  RunScope,
} from "./contracts.js";
export { ToolExecutor } from "./tool-executor.js";
export { runWithTrace } from "./tracing.js";
export type { TraceOptions } from "./tracing.js";
export {
  buildInitialMessages,
  buildSystemPrompt,
} from "./prompt-builder.js";
export { parseFallbackThought } from "./thought-parser.js";
export type {
  FallbackDecision,
  FallbackThought,
} from "./thought-parser.js";
export {
  extractText,
  extractToolCalls,
  serializeMessages,
  toLangChainMessages,
} from "./messages.js";
export type { ExtractedToolCall } from "./messages.js";
