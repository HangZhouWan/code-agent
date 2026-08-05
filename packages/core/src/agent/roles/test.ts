/**
 * Test Agent 角色定义
 *
 * 质量工程师角色：负责运行测试、分析失败原因、编写测试用例。
 * 不可委托子任务。
 */

import type { AgentRole } from '../role.js';
import { ToolNames } from '../../tools/tool-names.js';

export const TEST_AGENT_ROLE: AgentRole = {
  id: 'test',
  name: 'Test Agent',
  description:
    'Responsible for running tests, analyzing failures, and writing test cases.',
  systemPrompt: `You are a QA Engineer Agent. Your responsibilities:
- Run test suites and analyze results
- Analyze test failures and identify root causes
- Write missing test cases for uncovered code
- Report test results clearly with pass/fail counts
- Watch for code changes and automatically run relevant tests`,
  commandSubscriptions: ['agent.command.test_run', 'agent.command.test_write'],
  eventSubscriptions: ['agent.event.code_changed'],
  defaultTools: [
    ToolNames.SHELL_EXEC,
    ToolNames.FILE_READ, ToolNames.FILE_WRITE, ToolNames.FILE_LIST,
    ToolNames.CODE_SEARCH,
    ToolNames.WEB_FETCH,
  ],
  canDelegate: false,
  delegatableRoles: [],
};
