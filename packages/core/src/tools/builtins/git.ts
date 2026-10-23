/**
 * Git 工具（新契约）
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { simpleGit } from "simple-git";
import type { ToolContext, ToolDefinition, ToolResult } from "../base.js";
import { toolError, toolOk } from "../middleware.js";
import { ToolNames } from "../tool-names.js";

function git(ctx: ToolContext) {
  return simpleGit(ctx.workspacePath);
}

/**
 * 检查工作区是否为 git 仓库。
 *
 * 输入：工具上下文
 * 输出：非仓库时返回可操作的错误结果，否则返回 null
 */
function ensureGitRepo(ctx: ToolContext): ToolResult | null {
  if (existsSync(join(ctx.workspacePath, ".git"))) return null;
  return toolError(
    "Workspace is not a git repository. Do not retry git tools; " +
      "ask the user before running git init.",
    "VALIDATION",
  );
}

export const gitStatusTool: ToolDefinition = {
  name: ToolNames.GIT_STATUS,
  description: "查看 Git 工作区状态（已修改、已暂存、未跟踪）。",
  schema: z.object({}),
  permission: "allow",
  sideEffect: "none",
  async execute(_args, ctx): Promise<ToolResult> {
    const notRepo = ensureGitRepo(ctx);
    if (notRepo) return notRepo;
    const status = await git(ctx).status();
    return toolOk(JSON.stringify(status, null, 2));
  },
};

export const gitDiffTool: ToolDefinition<z.ZodObject<{
  path: z.ZodOptional<z.ZodString>;
  staged: z.ZodDefault<z.ZodBoolean>;
  base: z.ZodOptional<z.ZodString>;
}>> = {
  name: ToolNames.GIT_DIFF,
  description:
    "查看 Git diff；可选 staged、base 或指定 path。",
  schema: z.object({
    path: z.string().optional().describe("限定文件路径"),
    staged: z.boolean().default(false).describe("是否查看已暂存变更"),
    base: z.string().optional().describe("对比的 base ref，例如 main"),
  }),
  permission: "allow",
  sideEffect: "none",
  async execute(args, ctx): Promise<ToolResult> {
    const notRepo = ensureGitRepo(ctx);
    if (notRepo) return notRepo;
    const options: string[] = [];
    if (args.staged) options.push("--staged");
    if (args.base) options.push(args.base);
    if (args.path) options.push("--", args.path);
    const diff = await git(ctx).diff(options);
    return toolOk(diff || "(没有差异)");
  },
};

export const gitLogTool: ToolDefinition<z.ZodObject<{
  maxCount: z.ZodDefault<z.ZodNumber>;
  path: z.ZodOptional<z.ZodString>;
}>> = {
  name: ToolNames.GIT_LOG,
  description: "查看 Git 提交日志。",
  schema: z.object({
    maxCount: z.number().int().min(1).max(200).default(20),
    path: z.string().optional().describe("限定文件路径"),
  }),
  permission: "allow",
  sideEffect: "none",
  async execute(args, ctx): Promise<ToolResult> {
    const notRepo = ensureGitRepo(ctx);
    if (notRepo) return notRepo;
    const log = await git(ctx).log({
      maxCount: args.maxCount,
      ...(args.path ? { file: args.path } : {}),
    });
    if (log.all.length === 0) {
      return toolOk("(暂无提交记录)");
    }
    return toolOk(
      log.all
        .map((commit) => `${commit.hash.slice(0, 7)} ${commit.date.slice(0, 10)} ${commit.message}`)
        .join("\n"),
    );
  },
};

export const gitAddTool: ToolDefinition<z.ZodObject<{
  paths: z.ZodArray<z.ZodString>;
}>> = {
  name: ToolNames.GIT_ADD,
  description: "将文件加入 Git 暂存区。",
  schema: z.object({
    paths: z.array(z.string().min(1)).min(1).describe("要暂存的文件路径"),
  }),
  permission: "confirm",
  sideEffect: "mutating",
  async execute(args, ctx): Promise<ToolResult> {
    const notRepo = ensureGitRepo(ctx);
    if (notRepo) return notRepo;
    await git(ctx).add(args.paths);
    return toolOk(`已暂存 ${args.paths.length} 个文件`, { paths: args.paths });
  },
};

export const gitCommitTool: ToolDefinition<z.ZodObject<{
  message: z.ZodString;
}>> = {
  name: ToolNames.GIT_COMMIT,
  description: "创建 Git 提交；需要先暂存文件（git_add）。",
  schema: z.object({
    message: z.string().min(1).describe("提交信息"),
  }),
  permission: "confirm",
  sideEffect: "mutating",
  async execute(args, ctx): Promise<ToolResult> {
    const notRepo = ensureGitRepo(ctx);
    if (notRepo) return notRepo;
    try {
      const result = await git(ctx).commit(args.message);
      return toolOk(`提交成功: ${result.commit}`, {
        commit: result.commit,
        summary: result.summary,
      });
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : String(error),
        "TOOL_FAILED",
      );
    }
  },
};

export const gitBranchTool: ToolDefinition<z.ZodObject<{
  name: z.ZodOptional<z.ZodString>;
  checkout: z.ZodDefault<z.ZodBoolean>;
}>> = {
  name: ToolNames.GIT_BRANCH,
  description: "列出本地分支，或创建并切换新分支。",
  schema: z.object({
    name: z.string().optional().describe("新分支名称；不传则列出分支"),
    checkout: z.boolean().default(true).describe("创建后是否切换"),
  }),
  permission: "confirm",
  sideEffect: "mutating",
  async execute(args, ctx): Promise<ToolResult> {
    const notRepo = ensureGitRepo(ctx);
    if (notRepo) return notRepo;
    const g = git(ctx);
    if (args.name) {
      if (args.checkout) {
        await g.checkoutLocalBranch(args.name);
        return toolOk(`已创建并切换到分支: ${args.name}`);
      }
      await g.branch([args.name]);
      return toolOk(`已创建分支: ${args.name}`);
    }

    const branches = await g.branchLocal();
    const current = branches.current;
    return toolOk(
      Object.keys(branches.branches)
        .map((branch) => (branch === current ? `* ${branch}` : `  ${branch}`))
        .join("\n") || "(暂无本地分支)",
    );
  },
};
