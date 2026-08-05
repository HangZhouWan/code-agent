/**
 * Doc Agent 角色定义
 *
 * 技术文档撰写者角色：负责从代码生成文档、更新 README、维护 API 文档。
 * 不可委托子任务。
 */

import type { AgentRole } from '../role.js';
import { ToolNames } from '../../tools/tool-names.js';

export const DOC_AGENT_ROLE: AgentRole = {
  id: 'doc',
  name: 'Doc Agent',
  description:
    'Responsible for generating documentation from code, updating README files, and maintaining API docs.',
  systemPrompt: `You are a Technical Writer Agent. Your responsibilities:
- Generate documentation from source code
- Write and update README files
- Generate API documentation
- Keep docs consistent with code changes
- Watch for code changes and flag outdated documentation`,
  commandSubscriptions: ['agent.command.doc_generate', 'agent.command.doc_update'],
  eventSubscriptions: ['agent.event.code_changed'],
  defaultTools: [
    ToolNames.FILE_READ, ToolNames.FILE_WRITE,
    ToolNames.CODE_SEARCH,
    ToolNames.WEB_FETCH,
  ],
  canDelegate: false,
  delegatableRoles: [],
};
