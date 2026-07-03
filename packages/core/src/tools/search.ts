/**
 * 代码搜索工具
 *
 * 基于 grep 的代码搜索封装，支持正则表达式和文件类型过滤。
 *
 * 设计要点：
 * - 使用 grep -rn 进行递归搜索，带行号输出
 * - grep 的 exit code 1（无匹配）视为正常，返回 "未找到匹配项"
 * - 默认限制最大结果数，避免输出爆炸
 */

import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from './base.js';

const execAsync = promisify(exec);

export const codeSearchTool: ToolDefinition = {
  name: 'code_search',
  description:
    '在工作区代码中搜索匹配的文本模式（支持正则表达式）。' +
    '可以指定搜索路径和文件类型过滤。返回匹配的行及文件名和行号。',
  schema: z.object({
    pattern: z.string().describe('搜索模式，支持正则表达式'),
    path: z.string().default('.').describe('搜索的目录路径（相对于工作区），默认搜索全部'),
    fileTypes: z
      .string()
      .optional()
      .describe('逗号分隔的文件扩展名过滤，例如 ".ts,.tsx,.json"'),
    maxResults: z.number().default(20).describe('最大返回结果数量'),
  }),
  permission: 'safe',
  async execute(args, ctx) {
    // 应用 Zod schema 默认值
    const searchPath = args.path ?? '.';
    const maxResults = args.maxResults ?? 20;

    // 构建 grep --include 参数
    let includeFlag = '';
    if (args.fileTypes) {
      const extensions = args.fileTypes.split(',').map((ext: string) => ext.trim());
      includeFlag = extensions.map((ext: string) => `--include='*${ext}'`).join(' ');
    }

    // 转义模式中的特殊字符以避免 shell 注入
    const escapedPattern = args.pattern.replace(/'/g, "'\\''");

    try {
      const { stdout } = await execAsync(
        `grep -rn --color=never ${includeFlag} -m ${maxResults} '${escapedPattern}' '${searchPath}'`,
        {
          cwd: ctx.workspacePath,
          timeout: 10_000,
          maxBuffer: 5 * 1024 * 1024, // 5MB
        },
      );
      return stdout || '未找到匹配项。';
    } catch (error: unknown) {
      // grep 返回 exit code 1 表示没有匹配项，这是正常情况
      const err = error as { code?: string | number; status?: number };
      if (String(err.code) === '1' || err.status === 1) {
        return '未找到匹配项。';
      }
      throw error;
    }
  },
};
