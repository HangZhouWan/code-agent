/**
 * Code Agent 角色定义
 *
 * 软件工程师角色：负责读取、编写和修改代码文件。
 * 可委托子任务给 Test Agent 和 Doc Agent。
 */

import type { AgentRole } from '../role.js';
import { ToolNames } from '../../tools/tool-names.js';

export const CODE_AGENT_ROLE: AgentRole = {
  id: 'code',
  name: 'Code Agent',
  description:
    'Responsible for reading, writing, and modifying code files. Handles code review and refactoring tasks.',
  systemPrompt: `You are a Software Engineer Agent. Your responsibilities:
- Read and analyze source code
- Write and modify code files
- Run basic code quality checks
- Report code changes clearly
- When tests fail, analyze the failure and fix the code`,
  commandSubscriptions: [
    'agent.command.code_review',
    'agent.command.code_modify',
    'agent.command.code_generate',
  ],
  eventSubscriptions: ['agent.event.test_failed', 'agent.event.code_changed'],
  defaultTools: [
    ToolNames.FILE_READ, ToolNames.FILE_WRITE, ToolNames.FILE_LIST,
    ToolNames.CODE_SEARCH, ToolNames.SHELL_EXEC,
    ToolNames.GIT_STATUS, ToolNames.GIT_DIFF, ToolNames.GIT_LOG,
    ToolNames.GIT_COMMIT, ToolNames.GIT_BRANCH,
    ToolNames.WEB_FETCH,
  ],
  canDelegate: true,
  delegatableRoles: ['test', 'doc'],
};
