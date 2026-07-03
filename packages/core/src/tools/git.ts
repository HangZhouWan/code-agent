/**
 * Git 版本控制工具
 *
 * 基于 simple-git 库封装的 Git 操作工具集。
 * 所有操作均在 ctx.workspacePath 指定的仓库中执行。
 *
 * 五个工具：
 * - git_status: 查看工作区状态
 * - git_diff: 查看差异对比
 * - git_log: 查看提交日志
 * - git_commit: 创建提交
 * - git_branch: 列出/创建分支
 */

import { z } from 'zod';
import { simpleGit } from 'simple-git';
import type { ToolDefinition, ToolContext } from './base.js';

/**
 * 创建绑定到工作区的 simple-git 实例
 *
 * @param ctx - 工具上下文
 * @returns 绑定到 workspacePath 的 simpleGit 实例
 */
function git(ctx: ToolContext) {
  return simpleGit(ctx.workspacePath);
}

/**
 * git_status —— 查看工作区状态
 *
 * 权限: safe（只读操作）
 * 返回 JSON 格式的状态信息，便于 LLM 解析
 */
export const gitStatusTool: ToolDefinition = {
  name: 'git_status',
  description: '查看 Git 工作区的当前状态，包括已修改、已暂存和未跟踪的文件',
  schema: z.object({}),
  permission: 'safe',
  async execute(_args, ctx) {
    const status = await git(ctx).status();
    return JSON.stringify(status, null, 2);
  },
};

/**
 * git_diff —— 查看差异对比
 *
 * 权限: safe（只读操作）
 * 支持查看未暂存和已暂存的差异
 */
export const gitDiffTool: ToolDefinition = {
  name: 'git_diff',
  description: '查看工作区文件的差异对比。默认显示未暂存的变更，设置 staged=true 查看已暂存的变更',
  schema: z.object({
    staged: z.boolean().default(false).describe('是否仅显示已暂存 (staged) 的变更'),
  }),
  permission: 'safe',
  async execute(args, ctx) {
    const g = git(ctx);
    const diff = args.staged ? await g.diff(['--staged']) : await g.diff();
    return diff || '(没有差异)';
  },
};

/**
 * git_log —— 查看提交日志
 *
 * 权限: safe（只读操作）
 * 默认返回最近 20 条简略日志
 */
export const gitLogTool: ToolDefinition = {
  name: 'git_log',
  description: '查看 Git 提交日志，默认显示最近 20 条记录',
  schema: z.object({
    maxCount: z.number().default(20).describe('最大返回的提交数量'),
  }),
  permission: 'safe',
  async execute(args, ctx) {
    const log = await git(ctx).log({ maxCount: args.maxCount });
    if (log.all.length === 0) {
      return '(暂无提交记录)';
    }
    return log.all
      .map((c) => `${c.hash.slice(0, 7)} ${c.date.slice(0, 10)} ${c.message}`)
      .join('\n');
  },
};

/**
 * git_commit —— 创建提交
 *
 * 权限: confirm（写操作，需要用户确认）
 * 仅支持 message 参数，不处理 add 操作（需用户手动 git add）
 */
export const gitCommitTool: ToolDefinition = {
  name: 'git_commit',
  description: '创建新的 Git 提交。注意：需要先手动添加文件到暂存区（git add）',
  schema: z.object({
    message: z.string().describe('提交信息'),
  }),
  permission: 'confirm',
  async execute(args, ctx) {
    const result = await git(ctx).commit(args.message);
    return `提交成功: ${result.commit}`;
  },
};

/**
 * git_branch —— 列出或创建分支
 *
 * 权限: confirm（创建分支会修改仓库状态）
 * 不传 name 时列出所有本地分支，传入 name 时创建新分支
 */
export const gitBranchTool: ToolDefinition = {
  name: 'git_branch',
  description:
    '列出所有本地分支，或创建新分支。传入 name 参数时创建新分支并切换过去，不传时列出所有本地分支',
  schema: z.object({
    name: z.string().optional().describe('新分支名称（传入则创建，不传则列出）'),
    checkout: z.boolean().default(false).describe('创建后是否切换到新分支'),
  }),
  permission: 'confirm',
  async execute(args, ctx) {
    const g = git(ctx);
    if (args.name) {
      await g.checkoutLocalBranch(args.name);
      return `已创建并切换到分支: ${args.name}`;
    }
    const branches = await g.branchLocal();
    const current = branches.current;
    const list = Object.keys(branches.branches);
    if (list.length === 0) {
      return '(暂无本地分支)';
    }
    return list.map((b) => (b === current ? `* ${b}` : `  ${b}`)).join('\n');
  },
};
