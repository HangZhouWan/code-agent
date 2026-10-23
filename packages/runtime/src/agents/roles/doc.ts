import { ToolNames } from "@code-agent/core";
import type { RoleDefinition } from "@code-agent/protocol";
import { composeRoleSystemPrompt } from "./prompt-compose.js";
import { DOC_PROMPT } from "./prompts.generated.js";

export const DOC_ROLE: RoleDefinition = {
  id: "doc",
  displayName: "Doc Agent",
  description: "维护文档、注释和 README",
  systemPrompt: composeRoleSystemPrompt(DOC_PROMPT),
  defaultTools: [
    ToolNames.FILE_READ,
    ToolNames.FILE_LIST,
    ToolNames.FILE_GLOB,
    ToolNames.CODE_SEARCH,
    ToolNames.FILE_WRITE,
    ToolNames.FILE_EDIT,
    ToolNames.GIT_STATUS,
    ToolNames.GIT_DIFF,
    ToolNames.MEMORY_SEARCH,
    ToolNames.MEMORY_STORE,
    ToolNames.ASK_USER,
  ],
  acceptedCommands: ["agent.command.doc"],
  canDelegate: false,
  delegatableRoles: [],
  maxConcurrency: 1,
};
