/**
 * 工具层 —— 统一导出入口
 *
 * 集中导出所有工具定义、注册表和基础类型，
 * 使用者只需 import from '@code-agent/core' 即可获取所有工具。
 */

// 基础接口和工厂函数
export { createLangChainTool, normalizeToolResult } from './base.js';
export type {
  ToolDefinition,
  ToolContext,
  PermissionLevel,
  ToolSideEffect,
  PermissionDecision,
  PermissionEvaluator,
  ToolPermissionSpec,
  ToolResult,
} from './base.js';

// 执行中间件
export {
  executeTool,
  toolOk,
  toolError,
  DEFAULT_INLINE_LIMIT,
} from './middleware.js';
export type {
  ArtifactSink,
  ToolHooks,
  ToolExecutionDependencies,
} from './middleware.js';

// 工具名称常量
export { ToolNames, ALL_TOOL_NAMES, SAFE_TOOL_NAMES, CONFIRM_TOOL_NAMES } from './tool-names.js';
export type { ToolName } from './tool-names.js';

// 新内置工具目录（旧工具仍保留在上方，Phase 4/5 切换）
export { createBuiltinTools, detectTestCommand } from './builtins/index.js';
export { createMemoryTools } from './builtins/memory.js';
export type { MemoryToolService } from './builtins/memory.js';
export { createCollaborationTools } from './builtins/collaboration.js';
export type {
  CollaborationToolService,
  PlanTaskInput,
} from './builtins/collaboration.js';
export type { BuiltinToolOptions } from './builtins/index.js';

// 工具注册表
export { ToolRegistry } from './registry.js';
export type { AgentCapability } from './registry.js';

// 文件工具
export { fileReadTool, fileWriteTool, fileListTool } from './file.js';

// Shell 工具
export { shellExecTool } from './shell.js';

// 代码搜索工具
export { codeSearchTool } from './search.js';

// Git 工具
export {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
} from './git.js';

// Web 工具
export { webFetchTool } from './web.js';
