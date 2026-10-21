import { ToolNames } from "@code-agent/core";
import type { RoleDefinition } from "@code-agent/protocol";
import { composeRoleSystemPrompt } from "./prompt-compose.js";
import { CODE_PROMPT } from "./prompts.generated.js";

export const CODE_ROLE: RoleDefinition = {
  id: "code",
  displayName: "Code Agent",
  description: "读取和修改代码、运行命令、提交变更",
  systemPrompt: composeRoleSystemPrompt(CODE_PROMPT),
  defaultTools: [
    ToolNames.FILE_READ,
    ToolNames.FILE_WRITE,
    ToolNames.FILE_EDIT,
    ToolNames.FILE_LIST,
    ToolNames.FILE_GLOB,
    ToolNames.CODE_SEARCH,
    ToolNames.SHELL_EXEC,
    ToolNames.RUN_TESTS,
    ToolNames.GIT_STATUS,
    ToolNames.GIT_DIFF,
    ToolNames.GIT_LOG,
    ToolNames.GIT_ADD,
    ToolNames.GIT_COMMIT,
    ToolNames.GIT_BRANCH,
    ToolNames.WEB_FETCH,
    ToolNames.MEMORY_SEARCH,
    ToolNames.MEMORY_STORE,
    ToolNames.DELEGATE_TASK,
    ToolNames.PLAN_UPDATE,
    ToolNames.ASK_USER,
  ],
  acceptedCommands: ["agent.command.code"],
  canDelegate: true,
  delegatableRoles: ["test", "doc", "review"],
  maxConcurrency: 1,
};
