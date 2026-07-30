/**
 * Code Agent 角色定义
 *
 * 软件工程师角色：负责读取、编写和修改代码文件。
 * 可委托子任务给 Test Agent 和 Doc Agent。
 */

import type { AgentRole } from '../role.js';

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
  defaultTools: ['file_read', 'file_write', 'code_search', 'shell', 'git', 'web_fetch'],
  canDelegate: true,
  delegatableRoles: ['test', 'doc'],
};
