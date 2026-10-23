/**
 * RoleRegistry —— 角色定义注册表
 */

import type { AgentRoleId, RoleDefinition } from "@code-agent/protocol";
import { BUILTIN_ROLES } from "./roles/index.js";

export class RoleRegistry {
  private readonly roles = new Map<string, RoleDefinition>();

  constructor(roles: RoleDefinition[] = BUILTIN_ROLES) {
    for (const role of roles) {
      this.register(role);
    }
  }

  register(role: RoleDefinition): void {
    this.roles.set(role.id, role);
  }

  get(roleId: AgentRoleId): RoleDefinition | undefined {
    return this.roles.get(roleId);
  }

  require(roleId: AgentRoleId): RoleDefinition {
    const role = this.get(roleId);
    if (!role) throw new Error(`Unknown role: ${roleId}`);
    return role;
  }

  has(roleId: AgentRoleId): boolean {
    return this.roles.has(roleId);
  }

  list(): RoleDefinition[] {
    return [...this.roles.values()];
  }

  canDelegate(parent: AgentRoleId, child: AgentRoleId): boolean {
    const role = this.get(parent);
    if (!role || !role.canDelegate) return false;
    if (parent === child) return false;
    return role.delegatableRoles.includes(child);
  }
}
