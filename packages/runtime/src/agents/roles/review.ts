import { ToolNames } from "@code-agent/core";
import type { RoleDefinition } from "@code-agent/protocol";
import { composeRoleSystemPrompt } from "./prompt-compose.js";
import { REVIEW_PROMPT } from "./prompts.generated.js";

export const REVIEW_ROLE: RoleDefinition = {
  id: "review",
  displayName: "Review Agent",
  description: "只读代码审查，输出发现",
  systemPrompt: composeRoleSystemPrompt(REVIEW_PROMPT),
  defaultTools: [
    ToolNames.FILE_READ,
    ToolNames.FILE_LIST,
    ToolNames.FILE_GLOB,
    ToolNames.CODE_SEARCH,
    ToolNames.GIT_STATUS,
    ToolNames.GIT_DIFF,
    ToolNames.GIT_LOG,
    ToolNames.MEMORY_SEARCH,
  ],
  acceptedCommands: ["agent.command.review"],
  canDelegate: false,
  delegatableRoles: [],
  maxConcurrency: 1,
};
