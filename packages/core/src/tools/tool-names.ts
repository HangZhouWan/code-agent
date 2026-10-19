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
  FILE_EDIT: 'file_edit',
  FILE_LIST: 'file_list',
  FILE_GLOB: 'file_glob',

  // ---- 代码搜索 ----
  CODE_SEARCH: 'code_search',

  // ---- Shell / 测试 ----
  SHELL_EXEC: 'shell_exec',
  RUN_TESTS: 'run_tests',

  // ---- Git 版本控制 ----
  GIT_STATUS: 'git_status',
  GIT_DIFF: 'git_diff',
  GIT_LOG: 'git_log',
  GIT_ADD: 'git_add',
  GIT_COMMIT: 'git_commit',
  GIT_BRANCH: 'git_branch',

  // ---- Web 请求 ----
  WEB_FETCH: 'web_fetch',

  // ---- 长期记忆 ----
  MEMORY_SEARCH: 'memory_search',
  MEMORY_STORE: 'memory_store',

  // ---- 多 Agent 协作 / 交互 ----
  DELEGATE_TASK: 'delegate_task',
  PLAN_UPDATE: 'plan_update',
  ASK_USER: 'ask_user',
} as const;

/** 所有工具的常量名列表 */
export const ALL_TOOL_NAMES: readonly string[] = Object.values(ToolNames);

/**
 * 权限不再由工具名称名单决定：
 * ToolDefinition.permission + 权限中间件是唯一来源。
 */

/** 工具名称联合类型 —— 用于类型安全的 toolName 参数 */
export type ToolName = (typeof ToolNames)[keyof typeof ToolNames];
