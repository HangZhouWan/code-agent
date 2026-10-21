/**
 * 工具层统一导出
 */

export { createLangChainTool, normalizeToolResult } from "./base.js";
export type {
  ToolDefinition,
  ToolContext,
  PermissionLevel,
  ToolSideEffect,
  PermissionDecision,
  PermissionEvaluator,
  ToolPermissionSpec,
  ToolResult,
  PlanContext,
} from "./base.js";

export {
  executeTool,
  toolOk,
  toolError,
  DEFAULT_INLINE_LIMIT,
} from "./middleware.js";
export type {
  ArtifactSink,
  ToolHooks,
  ToolExecutionDependencies,
} from "./middleware.js";

export { ToolNames, ALL_TOOL_NAMES } from "./tool-names.js";
export type { ToolName } from "./tool-names.js";

export {
  createBuiltinTools,
  detectTestCommand,
  createMemoryTools,
  createCollaborationTools,
} from "./builtins/index.js";
export type {
  BuiltinToolOptions,
  MemoryToolService,
  CollaborationToolService,
  PlanSubmitInput,
  PlanSubmitOutcome,
  PlanTaskInput,
} from "./builtins/index.js";
