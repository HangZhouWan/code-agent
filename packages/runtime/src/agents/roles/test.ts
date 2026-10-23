import { ToolNames } from "@code-agent/core";
import type { RoleDefinition } from "@code-agent/protocol";
import { composeRoleSystemPrompt } from "./prompt-compose.js";
import { TEST_PROMPT } from "./prompts.generated.js";

export const TEST_ROLE: RoleDefinition = {
  id: "test",
  displayName: "Test Agent",
  description: "编写和运行测试，分析失败原因",
  systemPrompt: composeRoleSystemPrompt(TEST_PROMPT),
  defaultTools: [
    ToolNames.FILE_READ,
    ToolNames.FILE_LIST,
    ToolNames.FILE_GLOB,
    ToolNames.CODE_SEARCH,
    ToolNames.FILE_WRITE,
    ToolNames.FILE_EDIT,
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
