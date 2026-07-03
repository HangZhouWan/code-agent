/**
 * Shell 命令执行工具
 *
 * 提供受限的命令行执行能力。
 *
 * 安全机制（双层）：
 * 1. 命令白名单：仅允许预定义的安全命令集合
 * 2. Layer 2（在 SandboxGuard 中）：高危命令模式检测（rm -rf /、sudo、curl | bash 等）
 *
 * 超时与缓冲：
 * - 执行超时：30 秒
 * - 输出缓冲：最大 10MB
 */

import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import type { ToolDefinition } from './base.js';

const execAsync = promisify(exec);

/**
 * 允许执行的命令白名单
 *
 * 仅包含常用的安全命令。危险的系统管理命令（如 rm、chmod、chown 等）
 * 不在白名单中，将由 SandboxGuard 的 DENY_PATTERNS 进一步拦截。
 */
const ALLOWED_COMMANDS = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'find',
  'grep',
  'echo',
  'mkdir',
  'touch',
  'cp',
  'mv',
  'git',
  'npm',
  'npx',
  'pnpm',
  'node',
  'tsx',
  'which',
  'pwd',
  'whoami',
  'uname',
  'env',
]);

export const shellExecTool: ToolDefinition = {
  name: 'shell.exec',
  description:
    '在工作区内执行一个 shell 命令。仅允许执行白名单中的命令（如 ls、cat、grep、git、npm 等）。' +
    '命令将在指定的工作目录（或默认工作区根目录）下执行。' +
    `允许的命令: ${[...ALLOWED_COMMANDS].join(', ')}`,
  schema: z.object({
    command: z.string().describe('要执行的 shell 命令'),
    cwd: z.string().optional().describe('相对于工作区的工作目录，默认为工作区根目录'),
  }),
  permission: 'confirm',
  async execute(args, ctx) {
    // 提取命令的基础名称（第一个空格前的部分）
    const baseCmd = args.command.trim().split(/\s+/)[0];
    if (!ALLOWED_COMMANDS.has(baseCmd)) {
      return (
        `❌ 命令 "${baseCmd}" 不在允许列表中。\n` +
        `允许的命令: ${[...ALLOWED_COMMANDS].join(', ')}`
      );
    }

    // 确定工作目录：优先使用参数指定的 cwd，否则使用工作区根目录
    const cwd = args.cwd ? path.resolve(ctx.workspacePath, args.cwd) : ctx.workspacePath;

    try {
      const { stdout, stderr } = await execAsync(args.command, {
        cwd,
        timeout: 30_000, // 30 秒超时
        maxBuffer: 10 * 1024 * 1024, // 10MB 输出缓冲
      });
      return stdout + (stderr ? `\n[stderr]\n${stderr}` : '');
    } catch (error: unknown) {
      const err = error as { code?: number; stderr?: string; message?: string };
      return `命令执行失败 (退出码 ${err.code ?? 'unknown'}): ${err.stderr || err.message}`;
    }
  },
};
