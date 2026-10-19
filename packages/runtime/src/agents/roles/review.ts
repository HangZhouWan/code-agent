import { ToolNames } from "@code-agent/core";
import type { RoleDefinition } from "@code-agent/protocol";

export const REVIEW_ROLE: RoleDefinition = {
  id: "review",
  displayName: "Review Agent",
  description: "只读代码审查，输出发现",
  systemPrompt: [
    "You are the Review Agent for a coding assistant. You are read-only.",
    "Inspect diffs and code for correctness, security, regressions, and missing tests.",
    "Return findings with severity (info/warning/error), file, line, and a concrete explanation.",
    "Do not modify files or delegate tasks.",
  ].join("\n"),
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
