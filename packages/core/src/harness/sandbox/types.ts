/**
 * 权限沙箱 —— 类型定义
 *
 * 定义权限校验相关的核心类型：
 * - PermissionResult：校验结果
 * - ToolPermission：工具的全局权限策略
 * - ConfirmRequiredError：需用户确认时抛出的异常
 *
 * PermissionLevel 复用自 tools/base.ts
 * AgentCapability 复用自 tools/registry.ts
 */

import type { PermissionLevel } from '../../tools/base.js';
import type { AgentCapability } from '../../tools/registry.js';

// 重新导出，方便 harness 层统一引用
export type { PermissionLevel, AgentCapability };

/**
 * 权限校验结果
 *
 * 由 SandboxGuard.check() 返回，描述一次工具调用是否被允许。
 */
export interface PermissionResult {
  /** 是否允许执行 */
  allowed: boolean;
  /** 权限级别 */
  level: PermissionLevel;
  /** 拒绝或需要确认的原因（可选） */
  reason?: string;
}

/**
 * 工具的全局权限策略
 *
 * 注册在 PermissionRegistry 中，定义某个工具名称对应的默认权限级别和可选的自定义参数校验。
 */
export interface ToolPermission {
  /** 工具名称，如 "file_read"、"shell_exec" */
  toolName: string;
  /** 默认权限级别 */
  defaultLevel: PermissionLevel;
  /**
   * 自定义参数校验（可选）
   *
   * 接收工具调用参数，返回 PermissionResult 或 null。
   * 返回 null 表示参数通过校验，使用 defaultLevel；
   * 返回 PermissionResult 则覆盖 defaultLevel。
   */
  validateArgs?(args: Record<string, unknown>): PermissionResult | null;
}

/**
 * 需要用户确认异常
 *
 * 当工具的权限级别为 'confirm' 时，SandboxGuard 抛出此异常，
 * 供上层审批流程捕获并展示确认 UI。
 */
export class ConfirmRequiredError extends Error {
  /** 工具名称 */
  public toolName: string;
  /** 工具调用参数 */
  public args: Record<string, unknown>;

  constructor(
    toolName: string,
    args: Record<string, unknown>,
    reason?: string,
  ) {
    super(
      `Tool "${toolName}" requires user confirmation${reason ? `: ${reason}` : ''}`,
    );
    this.name = 'ConfirmRequiredError';
    this.toolName = toolName;
    this.args = args;
  }
}
