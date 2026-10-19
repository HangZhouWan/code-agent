/**
 * 多 Agent 协作 / 用户交互工具（新契约）
 *
 * 具体实现由 runtime 注入，core 只定义工具契约。
 */

import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../base.js";
import { toolOk } from "../middleware.js";
import { ToolNames } from "../tool-names.js";

export interface PlanTaskInput {
  id: string;
  description: string;
  role?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  dependsOn?: string[];
}

export interface CollaborationToolService {
  delegate(
    input: {
      role: string;
      description: string;
      context?: string;
      files?: string[];
      dependsOn?: string[];
    },
    ctx?: ToolContext,
  ): Promise<unknown>;

  updatePlan(tasks: PlanTaskInput[]): Promise<void>;

  askUser(
    input: {
      question: string;
      options?: string[];
      allowFreeText?: boolean;
    },
    ctx?: ToolContext,
  ): Promise<string>;
}

export function createCollaborationTools(
  service: CollaborationToolService,
): ToolDefinition[] {
  const delegateTaskTool: ToolDefinition = {
    name: ToolNames.DELEGATE_TASK,
    description:
      "把子任务委派给指定角色（code/test/doc/review）。受角色白名单、深度和并发限制。",
    schema: z.object({
      role: z.string().min(1).describe("目标角色 ID"),
      description: z.string().min(1).describe("子任务描述"),
      context: z.string().optional().describe("任务背景摘要"),
      files: z.array(z.string()).optional().describe("相关文件"),
      dependsOn: z.array(z.string()).optional().describe("依赖的任务 ID"),
    }),
    permission: "allow",
    sideEffect: "idempotent",
    async execute(args, ctx): Promise<ToolResult> {
      const result = await service.delegate(
        {
          role: args.role,
          description: args.description,
          ...(args.context ? { context: args.context } : {}),
          ...(args.files ? { files: args.files } : {}),
          ...(args.dependsOn ? { dependsOn: args.dependsOn } : {}),
        },
        ctx,
      );
      return toolOk(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    },
  };

  const planUpdateTool: ToolDefinition = {
    name: ToolNames.PLAN_UPDATE,
    description: "更新当前工作的待办计划与状态。",
    schema: z.object({
      tasks: z
        .array(
          z.object({
            id: z.string().min(1),
            description: z.string().min(1),
            role: z.string().optional(),
            status: z.enum(["pending", "in_progress", "completed", "failed"]),
            dependsOn: z.array(z.string()).optional(),
          }),
        )
        .min(1),
    }),
    permission: "allow",
    sideEffect: "none",
    async execute(args, _ctx): Promise<ToolResult> {
      await service.updatePlan(
        (args.tasks as PlanTaskInput[]).map((task) => ({
          ...task,
          ...(task.dependsOn ? { dependsOn: task.dependsOn } : {}),
        })),
      );
      return toolOk(`计划已更新（${args.tasks.length} 项）`);
    },
  };

  const askUserTool: ToolDefinition = {
    name: ToolNames.ASK_USER,
    description: "向用户提问并等待回答；用于需要澄清或决策的场景。",
    schema: z.object({
      question: z.string().min(1),
      options: z.array(z.string().min(1)).min(1).max(10).optional(),
      allowFreeText: z.boolean().default(true),
    }),
    permission: "allow",
    sideEffect: "none",
    async execute(args, ctx): Promise<ToolResult> {
      const answer = await service.askUser(
        {
          question: args.question,
          ...(args.options ? { options: args.options } : {}),
          allowFreeText: args.allowFreeText,
        },
        ctx,
      );
      return toolOk(`用户回答: ${answer}`);
    },
  };

  return [delegateTaskTool, planUpdateTool, askUserTool];
}
