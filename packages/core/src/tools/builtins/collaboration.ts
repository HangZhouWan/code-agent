/**
 * 多 Agent 协作 / 用户交互工具（新契约）
 *
 * 具体实现由 runtime 注入，core 只定义工具契约。
 */

import { z } from "zod";
import type { CodeProposal } from "@code-agent/protocol";
import { isPathWithin } from "../../permissions/paths.js";
import type { ToolContext, ToolDefinition, ToolResult } from "../base.js";
import { toolError, toolOk } from "../middleware.js";
import { ToolNames } from "../tool-names.js";

export interface PlanTaskInput {
  id: string;
  description: string;
  role?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  dependsOn?: string[];
}

/** submit_proposals 的输入 */
export interface PlanSubmitInput {
  summary: string;
  proposals: CodeProposal[];
}

/** submit_proposals 的执行结果，会作为工具结果返回给模型 */
export interface PlanSubmitOutcome {
  status: "approved" | "rejected";
  selectedProposalIds: string[];
  selectedProposals?: CodeProposal[];
  feedback?: string;
  /** 当前会话是否启用了计划模式 */
  planMode: boolean;
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

  submitProposals(
    input: PlanSubmitInput,
    ctx?: ToolContext,
  ): Promise<PlanSubmitOutcome>;

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

  const submitProposalsTool: ToolDefinition = {
    name: ToolNames.SUBMIT_PROPOSALS,
    description:
      "计划模式下提交 1-4 个具体改进方案并等待用户批准。" +
      "必须先只读调研；用户批准前不得修改文件。",
    schema: z.object({
      summary: z.string().min(1).max(2_000).describe("整体调研结论"),
      proposals: z
        .array(
          z.object({
            id: z.string().min(1).max(64),
            title: z.string().min(1).max(200),
            summary: z.string().min(1).max(1_000),
            files: z
              .array(
                z.object({
                  path: z.string().min(1).max(500),
                  changes: z
                    .array(z.string().min(1).max(500))
                    .min(1)
                    .max(20),
                }),
              )
              .min(1)
              .max(20),
            rationale: z.string().max(1_000).optional(),
            risks: z.string().max(1_000).optional(),
            effort: z.enum(["small", "medium", "large"]).optional(),
            recommended: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(4),
    }),
    permission: "allow",
    sideEffect: "none",
    async execute(args, ctx): Promise<ToolResult> {
      const proposals = args.proposals as CodeProposal[];
      const ids = new Set<string>();
      for (const proposal of proposals) {
        if (ids.has(proposal.id)) {
          return toolError(
            `Invalid proposals: duplicate id "${proposal.id}"`,
            "VALIDATION",
          );
        }
        ids.add(proposal.id);
        for (const file of proposal.files) {
          if (!isPathWithin(ctx.workspacePath, file.path)) {
            return toolError(
              `Invalid proposals: path escapes workspace "${file.path}"`,
              "VALIDATION",
            );
          }
        }
      }
      if (proposals.filter((proposal) => proposal.recommended).length > 1) {
        return toolError(
          "Invalid proposals: at most one proposal may be recommended",
          "VALIDATION",
        );
      }

      const outcome = await service.submitProposals(
        { summary: args.summary, proposals },
        ctx,
      );
      const instruction = !outcome.planMode
        ? "Plan mode is off. Do not call submit_proposals; implement the request directly."
        : outcome.status === "approved"
          ? "User approved the selected proposals. Implement only those proposals now, then verify the result."
          : "User rejected the proposals. No mutating tools are available. Revise the proposals using the feedback and call submit_proposals again, or ask_user if blocked.";
      return toolOk(JSON.stringify({ ...outcome, instruction }, null, 2));
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

  return [
    delegateTaskTool,
    planUpdateTool,
    submitProposalsTool,
    askUserTool,
  ];
}
