/**
 * 长期记忆工具（新契约）
 *
 * 通过注入的 MemoryToolService 访问记忆存储，
 * 避免工具层直接依赖具体存储实现。
 */

import { z } from "zod";
import type { MemoryKind, MemoryScope } from "@code-agent/protocol";
import type { ToolDefinition, ToolResult } from "../base.js";
import { toolOk } from "../middleware.js";
import { ToolNames } from "../tool-names.js";

const MEMORY_KINDS = [
  "convention",
  "preference",
  "architecture",
  "command",
  "pitfall",
  "fact",
] as const;

const MEMORY_SCOPES = ["workspace", "user"] as const;

export interface MemoryToolService {
  search(
    query: string,
    options?: { topK?: number; scope?: MemoryScope },
  ): Promise<
    Array<{
      id: string;
      content: string;
      kind: MemoryKind;
      scope: MemoryScope;
      confidence: number;
    }>
  >;

  store(input: {
    content: string;
    kind: MemoryKind;
    scope?: MemoryScope;
    tags?: string[];
    confidence?: number;
  }): Promise<{ id: string; status: "active" | "pending_review" }>;
}

export function createMemoryTools(
  service: MemoryToolService,
): ToolDefinition[] {
  const memorySearchTool: ToolDefinition = {
    name: ToolNames.MEMORY_SEARCH,
    description: "检索长期记忆（项目约定、用户偏好、命令、坑点等）。",
    schema: z.object({
      query: z.string().min(1).describe("检索关键词"),
      topK: z.number().int().min(1).max(20).default(5),
      scope: z.enum(MEMORY_SCOPES).optional(),
    }),
    permission: "allow",
    sideEffect: "none",
    async execute(args, _ctx): Promise<ToolResult> {
      const results = await service.search(args.query, {
        topK: args.topK,
        ...(args.scope ? { scope: args.scope } : {}),
      });
      return toolOk(JSON.stringify(results, null, 2), {
        count: results.length,
      });
    },
  };

  const memoryStoreTool: ToolDefinition = {
    name: ToolNames.MEMORY_STORE,
    description:
      "写入一条长期记忆。workspace 作用域自动生效；user 作用域需要用户确认。",
    schema: z.object({
      content: z.string().min(1).max(500).describe("一句可独立理解的事实/约定"),
      kind: z.enum(MEMORY_KINDS),
      scope: z.enum(MEMORY_SCOPES).default("workspace"),
      tags: z.array(z.string().min(1)).max(10).optional(),
      confidence: z.number().min(0).max(1).default(0.8),
    }),
    permission: (args) =>
      args.scope === "user"
        ? { level: "confirm", reason: "写入跨项目用户偏好需要确认" }
        : { level: "allow" },
    sideEffect: "idempotent",
    async execute(args, _ctx): Promise<ToolResult> {
      const result = await service.store({
        content: args.content,
        kind: args.kind,
        scope: args.scope,
        ...(args.tags ? { tags: args.tags } : {}),
        confidence: args.confidence,
      });
      return toolOk(
        result.status === "active"
          ? `记忆已保存: ${result.id}`
          : `记忆已进入审核队列: ${result.id}`,
        result,
      );
    },
  };

  return [memorySearchTool, memoryStoreTool];
}
