/**
 * 内置工具目录
 *
 * 纯工具 15 个；注入 memory/collaboration 服务后再增加 5 个，共 20 个。
 */

import type { ToolDefinition } from "../base.js";
import {
  codeSearchTool,
  fileEditTool,
  fileGlobTool,
  fileListTool,
  fileReadTool,
  fileWriteTool,
} from "./file.js";
import { runTestsTool, shellExecTool } from "./shell.js";
import {
  gitAddTool,
  gitBranchTool,
  gitCommitTool,
  gitDiffTool,
  gitLogTool,
  gitStatusTool,
} from "./git.js";
import { webFetchTool } from "./web.js";
import { createMemoryTools, type MemoryToolService } from "./memory.js";
import {
  createCollaborationTools,
  type CollaborationToolService,
} from "./collaboration.js";

export interface BuiltinToolOptions {
  memory?: MemoryToolService;
  collaboration?: CollaborationToolService;
}

export function createBuiltinTools(
  options: BuiltinToolOptions = {},
): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    fileReadTool,
    fileWriteTool,
    fileEditTool,
    fileListTool,
    fileGlobTool,
    codeSearchTool,
    shellExecTool,
    runTestsTool,
    gitStatusTool,
    gitDiffTool,
    gitLogTool,
    gitAddTool,
    gitCommitTool,
    gitBranchTool,
    webFetchTool,
  ];

  if (options.memory) {
    tools.push(...createMemoryTools(options.memory));
  }
  if (options.collaboration) {
    tools.push(...createCollaborationTools(options.collaboration));
  }

  return tools;
}

export {
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  fileListTool,
  fileGlobTool,
  codeSearchTool,
  shellExecTool,
  runTestsTool,
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitAddTool,
  gitCommitTool,
  gitBranchTool,
  webFetchTool,
};
export { createMemoryTools, type MemoryToolService } from "./memory.js";
export {
  createCollaborationTools,
  type CollaborationToolService,
  type PlanTaskInput,
} from "./collaboration.js";
export { detectTestCommand } from "./shell.js";
