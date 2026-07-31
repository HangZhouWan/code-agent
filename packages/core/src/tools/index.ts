/**
 * 工具层 —— 统一导出入口
 *
 * 集中导出所有工具定义、注册表和基础类型，
 * 使用者只需 import from '@code-agent/core' 即可获取所有工具。
 */

// 基础接口和工厂函数
export { createLangChainTool } from './base.js';
export type { ToolDefinition, ToolContext, PermissionLevel } from './base.js';

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
