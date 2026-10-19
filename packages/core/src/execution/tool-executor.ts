/**
 * ToolExecutor —— 将模型 tool call 映射到 ToolDefinition 并执行
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import type { StructuredTool } from "@langchain/core/tools";
import type { ToolContext, ToolDefinition, ToolResult } from "../tools/base.js";
import {
  executeTool,
  toolError,
  type ToolExecutionDependencies,
} from "../tools/middleware.js";
import type { ExtractedToolCall } from "./messages.js";

export class ToolExecutor {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(
    tools: ToolDefinition[],
    private readonly dependencies: ToolExecutionDependencies = {},
  ) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** 供 model.bindTools 使用的 LangChain 工具定义 */
  toLangChainTools(ctx: ToolContext): StructuredTool[] {
    return this.list().map(
      (tool) =>
        new DynamicStructuredTool({
          name: tool.name,
          description: tool.description,
          schema: tool.schema,
          func: async (args: Record<string, unknown>) => {
            const result = await this.execute(
              { id: "internal", name: tool.name, args },
              ctx,
            );
            return result.content;
          },
        }),
    );
  }

  async execute(
    call: ExtractedToolCall,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return toolError(`Unknown tool: ${call.name}`, "VALIDATION");
    }
    return executeTool(tool, call.args, ctx, this.dependencies);
  }
}
