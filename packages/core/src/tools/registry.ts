/**
 * 工具注册表 —— ToolRegistry
 *
 * 统一管理所有可用工具的注册、查询和按需分发。
 *
 * 核心职责：
 * - 存储 ToolDefinition 映射
 * - 根据 Agent 的能力声明 (AgentCapability) 过滤和返回对应的 LangChain 工具实例
 * - 支持按名称查询单个工具定义
 */

import type { StructuredTool } from '@langchain/core/tools';
import type { ToolDefinition, ToolContext } from './base.js';
import { createLangChainTool } from './base.js';

/**
 * Agent 能力声明 —— 定义 Agent 可以使用的工具集和访问范围
 *
 * 由 Orchestrator 在创建子 Agent 时指定，确保每个子 Agent 只能访问
 * 完成任务所需的工具和路径。
 */
export interface AgentCapability {
  /** 允许使用的工具名称列表 */
  tools: string[];
  /** 允许访问的文件系统路径列表 */
  paths: string[];
  /** 最大 token 数限制（可选） */
  maxTokens?: number;
  /** 执行超时时间，单位毫秒（可选） */
  timeoutMs?: number;
}

/**
 * 工具注册表
 *
 * 线程不安全 —— 应在应用启动时完成所有注册后再使用。
 *
 * @example
 * ```ts
 * const registry = ToolRegistry.createDefault();
 * registry.register(fileReadTool);
 * registry.register(codeSearchTool);
 *
 * const tools = registry.getToolsForAgent(
 *   { tools: ['file.read', 'code_search'], paths: ['./workspace'] },
 *   { workspacePath: './workspace', sessionId: 'test' },
 * );
 * ```
 */
export class ToolRegistry {
  /** 工具定义存储，key 为工具名称 */
  private definitions = new Map<string, ToolDefinition>();

  /**
   * 注册一个工具定义
   *
   * 同名工具会被覆盖，最后注册的生效。
   *
   * @param def - 工具定义对象
   */
  register(def: ToolDefinition): void {
    this.definitions.set(def.name, def);
  }

  /**
   * 按名称获取工具定义
   *
   * @param name - 工具名称，如 "file.read"
   * @returns 工具定义，未注册时返回 undefined
   */
  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  /**
   * 根据 Agent 的能力声明，返回其可用的 LangChain 工具实例
   *
   * 过滤逻辑：只返回 Agent 的 capability.tools 中声明的工具。
   *
   * @param capability - Agent 的能力声明
   * @param ctx - 工具执行上下文
   * @returns LangChain StructuredTool 数组，可直接传入 AgentExecutor
   */
  getToolsForAgent(capability: AgentCapability, ctx: ToolContext): StructuredTool[] {
    const tools: StructuredTool[] = [];
    for (const toolName of capability.tools) {
      const def = this.definitions.get(toolName);
      if (def) {
        tools.push(createLangChainTool(def, ctx));
      }
    }
    return tools;
  }

  /**
   * 列出所有已注册的工具定义
   *
   * @returns 工具定义数组
   */
  listAll(): ToolDefinition[] {
    return [...this.definitions.values()];
  }

  /**
   * 创建空的默认注册表
   *
   * 工具需要在入口文件中显式注册，不在工厂方法中预注册。
   *
   * @returns 新的空 ToolRegistry 实例
   */
  static createDefault(): ToolRegistry {
    return new ToolRegistry();
  }
}
