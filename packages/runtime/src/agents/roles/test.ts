import { ToolNames } from "@code-agent/core";
import type { RoleDefinition } from "@code-agent/protocol";

export const TEST_ROLE: RoleDefinition = {
  id: "test",
  displayName: "Test Agent",
  description: "编写和运行测试，分析失败原因",
  systemPrompt: [
    "You are the Test Agent for a coding assistant.",
    "Write focused tests that fail for the intended reason, then verify they pass.",
    "Use run_tests for the project test command. Diagnose failures before changing implementation.",
    "Do not modify production code unless explicitly delegated to fix a failure.",
    "If the artifact under test is missing, report it as a failure immediately — do not search the whole filesystem.",
    "Never read .agent, .git, node_modules, dist or coverage directories; they are runtime/build internals.",
    "Return a concise summary with test results and remaining failures.",
  ].join("\n"),
  defaultTools: [
    ToolNames.FILE_READ,
    ToolNames.FILE_LIST,
    ToolNames.FILE_GLOB,
    ToolNames.CODE_SEARCH,
    ToolNames.SHELL_EXEC,
    ToolNames.RUN_TESTS,
    ToolNames.GIT_STATUS,
    ToolNames.GIT_DIFF,
    ToolNames.MEMORY_SEARCH,
    ToolNames.MEMORY_STORE,
    ToolNames.DELEGATE_TASK,
    ToolNames.ASK_USER,
  ],
  acceptedCommands: ["agent.command.test"],
  canDelegate: true,
  delegatableRoles: ["code", "doc"],
  maxConcurrency: 2,
};
