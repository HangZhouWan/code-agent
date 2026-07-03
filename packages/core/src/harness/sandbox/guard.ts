/**
 * 沙箱守卫 —— SandboxGuard
 *
 * 通过 LangChain 的 BaseCallbackHandler 机制在工具执行前拦截调用，
 * 执行多层安全校验。
 *
 * 校验链（按优先级）：
 * 1. Agent capability 检查 → 工具是否在 Agent 声明的 tools[] 中
 * 2. 权限注册表查询     → 工具是否已注册
 * 3. Shell 高危模式检测 → 正则匹配 DENY_PATTERNS（仅 shell.exec）
 * 4. 路径约束           → 参数中的 path 是否在 Agent 的 paths[] 前缀内
 * 5. 自定义参数校验     → ToolPermission.validateArgs()
 * 6. 返回 PermissionResult
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { AgentAction } from '@langchain/core/agents';
import type { PermissionRegistry } from './registry.js';
import type { PermissionResult, AgentCapability } from './types.js';
import { ConfirmRequiredError } from './types.js';

/**
 * Shell 高危命令黑名单
 *
 * 匹配以下任一模式时，无论权限级别如何，都将直接 deny：
 * - rm -rf /...       删除根目录
 * - sudo               提权操作
 * - chmod 777          过于宽松的权限设置
 * - chown              变更文件所有者
 * - dd if=             磁盘直接读写
 * - mkfs.              创建文件系统（格式化）
 * - > /dev/...         重定向到设备文件
 * - curl ... | sh/bash 远程脚本直接执行
 */
const DENY_PATTERNS: RegExp[] = [
  /\brm\s+-rf\s+\//i,
  /\bsudo\b/i,
  /\bchmod\s+777\b/i,
  /\bchown\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\./i,
  />\s*\/dev\//i,
  /\bcurl\b.*\|\s*(?:sh|bash)\b/i,
];

/**
 * 路径穿越模式
 *
 * 检测参数中的路径是否包含 ".." 片段，防止逃逸出 Agent 的允许路径范围。
 */
const PATH_TRAVERSAL_PATTERN = /\.\./;

/**
 * 沙箱守卫
 *
 * 继承 LangChain 的 BaseCallbackHandler，通过 handleAgentAction 回调
 * 在 Agent 决定执行工具时进行权限校验。
 *
 * @example
 * ```ts
 * const guard = new SandboxGuard(registry, capability);
 * // 传入 AgentExecutor 的 callbacks 中
 * const executor = new AgentExecutor({ ..., callbacks: [guard] });
 * ```
 */
export class SandboxGuard extends BaseCallbackHandler {
  name = 'SandboxGuard';
  private registry: PermissionRegistry;
  private capability: AgentCapability;

  constructor(registry: PermissionRegistry, capability: AgentCapability) {
    super();
    this.registry = registry;
    this.capability = capability;
  }

  /**
   * LangChain callback：Agent 决定执行工具时触发
   *
   * 在此方法中执行完整的安全校验链，根据结果放行、请求确认或拒绝。
   *
   * @param action - Agent 将要执行的动作（包含 tool 名称和 toolInput 参数）
   * @param runId - LangChain 运行 ID
   */
  async handleAgentAction(
    action: AgentAction,
    _runId: string,
    _parentRunId?: string,
    _tags?: string[],
  ): Promise<void> {
    const toolName = action.tool;
    const args = (action.toolInput ?? {}) as Record<string, unknown>;

    const result = this.check(toolName, args);

    if (result.level === 'deny') {
      throw new Error(
        `Tool "${toolName}" is denied: ${result.reason ?? 'no reason provided'}`,
      );
    }

    if (result.level === 'confirm') {
      throw new ConfirmRequiredError(toolName, args, result.reason);
    }

    // level === 'safe' → 静默放行
  }

  /**
   * 执行完整的安全校验链
   *
   * @param toolName - 工具名称
   * @param args - 工具调用参数
   * @returns 权限校验结果
   */
  check(toolName: string, args: Record<string, unknown>): PermissionResult {
    // 1. Agent capability 检查 —— 工具是否在 Agent 声明的 tools[] 中
    if (!this.capability.tools.includes(toolName)) {
      return {
        allowed: false,
        level: 'deny',
        reason: `Tool "${toolName}" is not in Agent's capability.tools`,
      };
    }

    // 2. 权限注册表查询 —— 工具是否已注册
    const toolPerm = this.registry.get(toolName);
    if (!toolPerm) {
      return {
        allowed: false,
        level: 'deny',
        reason: `Tool "${toolName}" is not registered in PermissionRegistry`,
      };
    }

    // 3. Shell 高危模式检测（仅针对 shell.exec）
    if (toolName === 'shell.exec') {
      const command = String(args.command ?? '');
      for (const pattern of DENY_PATTERNS) {
        if (pattern.test(command)) {
          return {
            allowed: false,
            level: 'deny',
            reason: `Shell command matches deny pattern: ${pattern}`,
          };
        }
      }
    }

    // 4. 路径约束 —— 参数中的 path 是否在 Agent 的 paths[] 前缀内
    const pathParams = this.extractPathParams(args);
    for (const paramPath of pathParams) {
      // 检测路径穿越
      if (PATH_TRAVERSAL_PATTERN.test(paramPath)) {
        return {
          allowed: false,
          level: 'deny',
          reason: `Path traversal detected in parameter: "${paramPath}"`,
        };
      }

      // 检查路径是否在允许范围内
      const allowed = this.capability.paths.some(
        (allowedPath) => paramPath.startsWith(allowedPath),
      );
      if (!allowed) {
        return {
          allowed: false,
          level: 'deny',
          reason: `Path "${paramPath}" is not within Agent's allowed paths: ${this.capability.paths.join(', ')}`,
        };
      }
    }

    // 5. 自定义参数校验 —— ToolPermission.validateArgs()
    if (toolPerm.validateArgs) {
      const customResult = toolPerm.validateArgs(args);
      if (customResult !== null) {
        return customResult;
      }
    }

    // 6. 返回默认权限级别
    return {
      allowed: toolPerm.defaultLevel !== 'deny',
      level: toolPerm.defaultLevel,
    };
  }

  /**
   * 从工具参数中提取所有路径值
   *
   * 遍历参数对象，提取 key 包含 "path"、"file"、"dir" 等字样
   * 且值为字符串的参数。
   *
   * @param args - 工具调用参数
   * @returns 路径字符串数组
   */
  private extractPathParams(args: Record<string, unknown>): string[] {
    const paths: string[] = [];
    const pathKeyPattern = /^(path|file|dir|directory|folder|target|dest|source|output|input)$/i;

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && pathKeyPattern.test(key)) {
        paths.push(value);
      }
    }

    return paths;
  }
}
