/**
 * Agent 角色定义
 *
 * 内置四个角色，自定义角色通过 RoleRegistry 注册；id 保持可扩展。
 */

export type AgentRoleId = "code" | "test" | "doc" | "review" | (string & {});

export const BUILTIN_AGENT_ROLE_IDS = ["code", "test", "doc", "review"] as const;

export type BuiltinAgentRoleId = (typeof BUILTIN_AGENT_ROLE_IDS)[number];

export interface RoleDefinition {
  id: AgentRoleId;
  displayName: string;
  description: string;
  systemPrompt: string;
  defaultTools: string[];
  acceptedCommands: string[];
  canDelegate: boolean;
  delegatableRoles: AgentRoleId[];
  maxConcurrency: number;
}
