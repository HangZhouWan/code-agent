/**
 * 权限注册表 —— PermissionRegistry
 *
 * 管理所有工具名称到权限策略的映射。
 *
 * 核心职责：
 * - 注册工具的权限策略（toolName → ToolPermission）
 * - 查询工具的权限策略
 * - 提供预置的默认权限配置（createDefault）
 */

import type { ToolPermission } from './types.js';
import { SAFE_TOOL_NAMES, CONFIRM_TOOL_NAMES } from '../../tools/tool-names.js';

/**
 * 权限注册表
 *
 * 线程不安全 —— 应在应用启动时完成所有注册后再使用。
 *
 * @example
 * ```ts
 * const registry = PermissionRegistry.createDefault();
 * const perm = registry.get(ToolNames.FILE_READ); // { toolName: ToolNames.FILE_READ, defaultLevel: 'safe' }
 * ```
 */
export class PermissionRegistry {
  /** 权限策略存储，key 为工具名称 */
  private permissions = new Map<string, ToolPermission>();

  /**
   * 注册一个工具的权限策略
   *
   * 同名工具会被覆盖，最后注册的生效。
   *
   * @param tp - 工具权限策略
   */
  register(tp: ToolPermission): void {
    this.permissions.set(tp.toolName, tp);
  }

  /**
   * 查询工具的权限策略
   *
   * @param toolName - 工具名称，如 "file_read"
   * @returns 权限策略，未注册时返回 undefined
   */
  get(toolName: string): ToolPermission | undefined {
    return this.permissions.get(toolName);
  }

  /**
   * 列出所有已注册的工具权限
   *
   * @returns 工具权限策略数组
   */
  listAll(): ToolPermission[] {
    return [...this.permissions.values()];
  }

  /**
   * 创建预置 12 个内置工具的默认权限配置
   *
   * 权限级别分配：
   * - safe（静默放行）：file_read, file_list, file_search, code_search,
   *                      git_status, git_diff, git_log, web_fetch
   * - confirm（需确认）：file_write, shell_exec, git_commit, git_branch
   *
   * @returns 预配置的 PermissionRegistry 实例
   */
  static createDefault(): PermissionRegistry {
    const registry = new PermissionRegistry();

    // ---- safe 级别：静默放行 ----
    for (const name of SAFE_TOOL_NAMES) {
      registry.register({ toolName: name, defaultLevel: 'safe' });
    }

    // ---- confirm 级别：需用户确认 ----
    for (const name of CONFIRM_TOOL_NAMES) {
      registry.register({ toolName: name, defaultLevel: 'confirm' });
    }

    return registry;
  }
}
