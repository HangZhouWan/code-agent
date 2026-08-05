/**
 * 工具层 —— 基础接口定义
 *
 * 定义 ToolDefinition、ToolContext 等核心抽象，
 * 以及将内部工具定义适配为 LangChain StructuredTool 的工厂函数。
 *
 * 设计要点：
 * - Zod schema 驱动：每个工具用 Zod 定义输入 schema，自动获得类型推断和运行时校验
 * - 权限标签：每个工具声明 permission: 'safe' | 'confirm'，供后续 SandboxGuard 使用
 * - 工具上下文：通过 ToolContext 注入 workspacePath 和 sessionId
 */

import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';
import type { StructuredTool } from '@langchain/core/tools';

/**
 * 权限级别
 *
 * - 'safe': 静默放行，无需用户确认
 * - 'confirm': 需要用户确认后才能执行
 * - 'deny': 完全禁止（由 SandboxGuard 动态判断，不由工具声明）
 */
export type PermissionLevel = 'safe' | 'confirm' | 'deny';

/**
 * 工具执行上下文
 *
 * 在每次工具调用时注入，提供工作区和会话信息。
 */
export interface ToolContext {
  /** Agent 工作区根目录，所有文件操作限定在此路径下 */
  workspacePath: string;
  /** 当前会话 ID，用于日志追踪和上下文关联 */
  sessionId: string;
  /**
   * 确认回调（可选）
   *
   * 当工具需要用户确认时（permission = 'confirm'），SandboxGuard 会调用此回调
   * 向用户推送确认请求。回调返回 true 表示批准，false 表示拒绝。
   *
   * 如果未提供此回调，confirm 级别的工具将抛出 ConfirmRequiredError。
   */
  onConfirmRequired?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
}

/**
 * 工具定义接口 —— 工具的标准化描述
 *
 * @typeParam T - Zod schema 类型，定义工具的输入参数结构
 *
 * @example
 * ```ts
 * const myTool: ToolDefinition = {
 *   name: ToolNames.FILE_READ,
 *   description: '读取文件内容',
 *   schema: z.object({ path: z.string() }),
 *   permission: 'safe',
 *   async execute(args, ctx) {
 *     return await fs.readFile(args.path, 'utf-8');
 *   },
 * };
 * ```
 */
export interface ToolDefinition<T extends z.ZodObject<any> = any> {
  /** 工具唯一名称，使用 "领域_动作" 命名规范，如 "file_read"、"git_status" */
  name: string;
  /** 给 LLM 看的工具功能描述，LLM 据此决定是否调用此工具 */
  description: string;
  /** Zod schema，定义输入参数的结构和校验规则 */
  schema: T;
  /** 权限级别：safe 静默放行 / confirm 需用户确认 */
  permission: PermissionLevel;
  /** 执行函数，接收 Zod 推导的参数和工具上下文，返回字符串结果 */
  execute(args: z.infer<T>, ctx: ToolContext): Promise<string>;
}

/**
 * 将 ToolDefinition 包装为 LangChain StructuredTool
 *
 * LangChain Agent 使用 StructuredTool 接口调用工具，
 * 此函数完成从内部 ToolDefinition 到 LangChain 工具的适配转换。
 *
 * @param def - 内部工具定义
 * @param ctx - 工具执行上下文
 * @returns LangChain StructuredTool 实例，可直接传入 AgentExecutor
 */
export function createLangChainTool<T extends z.ZodObject<any>>(
  def: ToolDefinition<T>,
  ctx: ToolContext,
): StructuredTool {
  return new DynamicStructuredTool({
    name: def.name,
    description: def.description,
    schema: def.schema,
    func: async (args: z.infer<T>) => def.execute(args, ctx),
  });
}
