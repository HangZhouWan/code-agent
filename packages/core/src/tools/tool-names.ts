/**
 * 工具名称常量 —— 全项目唯一的工具名称定义源
 *
 * 所有工具名称的字符串字面量都应引用此文件中的常量，
 * 禁止在其他文件中硬编码工具名称字符串。
 *
 * 命名规范：领域_动作，如 FILE_READ、GIT_STATUS。
 *
 * @example
 * ```ts
 * import { ToolNames } from './tool-names.js';
 *
 * const def: ToolDefinition = {
 *   name: ToolNames.FILE_READ,
 *   // ...
 * };
 * ```
 */

export const ToolNames = {
  // ---- 文件系统 ----
  FILE_READ: 'file_read',
  FILE_WRITE: 'file_write',
  FILE_LIST: 'file_list',

  // ---- 代码搜索 ----
  CODE_SEARCH: 'code_search',

  // ---- Shell 命令 ----
  SHELL_EXEC: 'shell_exec',

  // ---- Git 版本控制 ----
  GIT_STATUS: 'git_status',
  GIT_DIFF: 'git_diff',
  GIT_LOG: 'git_log',
  GIT_COMMIT: 'git_commit',
  GIT_BRANCH: 'git_branch',

  // ---- Web 请求 ----
  WEB_FETCH: 'web_fetch',
} as const;

/** 所有工具的常量名列表 */
export const ALL_TOOL_NAMES: readonly string[] = Object.values(ToolNames);

/** safe 级别工具（只读/静默放行） */
export const SAFE_TOOL_NAMES: readonly string[] = [
  ToolNames.FILE_READ,
  ToolNames.FILE_LIST,
  ToolNames.CODE_SEARCH,
  ToolNames.GIT_STATUS,
  ToolNames.GIT_DIFF,
  ToolNames.GIT_LOG,
  ToolNames.WEB_FETCH,
];

/** confirm 级别工具（写操作/需用户确认） */
export const CONFIRM_TOOL_NAMES: readonly string[] = [
  ToolNames.FILE_WRITE,
  ToolNames.SHELL_EXEC,
  ToolNames.GIT_COMMIT,
  ToolNames.GIT_BRANCH,
];

/** 工具名称联合类型 —— 用于类型安全的 toolName 参数 */
export type ToolName = (typeof ToolNames)[keyof typeof ToolNames];
