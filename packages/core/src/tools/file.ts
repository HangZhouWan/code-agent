/**
 * 文件系统工具
 *
 * 提供文件读写和目录列表功能，所有操作限定在工作区 (workspacePath) 内。
 *
 * 安全机制：
 * - resolvePath() 函数确保所有路径解析后仍在 workspacePath 内
 * - 路径穿越检测：拒绝通过 "../" 等方式访问工作区外的文件
 *
 * 三个工具：
 * - file_read: 读取文件内容（UTF-8）
 * - file_write: 写入文件，自动创建父目录
 * - file_list: 列出目录内容
 */

import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolDefinition, ToolContext } from './base.js';
import { ToolNames } from './tool-names.js';

// ═══════════════════════════════════════════════
// 路径安全工具
// ═══════════════════════════════════════════════

/**
 * 安全路径解析 —— 将相对路径解析为工作区内的绝对路径
 *
 * 核心安全机制：通过 path.resolve 后再检查前缀，
 * 确保解析后的路径仍在 workspacePath 内，防止路径穿越攻击。
 *
 * @param relativePath - 用户提供的相对路径
 * @param ctx - 工具上下文（含 workspacePath）
 * @returns 解析后的绝对路径
 * @throws {Error} 检测到路径穿越时抛出
 */
function resolvePath(relativePath: string, ctx: ToolContext): string {
  const resolved = path.resolve(ctx.workspacePath, relativePath);
  // 规范化路径分隔符，确保前缀比较在不同平台一致
  const normalizedWorkspace = path.resolve(ctx.workspacePath);
  if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
    throw new Error(`[安全拦截] 检测到路径穿越: "${relativePath}" 试图访问工作区外的路径`);
  }
  return resolved;
}

// ═══════════════════════════════════════════════
// 工具定义
// ═══════════════════════════════════════════════

/** 单次 file_read 最大字节数（100 KB）。超过此大小建议使用 offset/limit 分段读取。 */
const MAX_READ_BYTES = 100 * 1024;

/**
 * file_read —— 读取工作区内的文件内容
 *
 * 权限: safe（只读操作，不修改文件系统）
 *
 * 支持通过 offset/limit 参数按行号范围读取大文件，
 * 避免一次性读取整个大文件导致上下文溢出。
 * 行号从 1 开始计数（与编辑器一致）。
 *
 * 单次读取上限为 100 KB，超出时需使用 offset/limit 分段读取。
 */
export const fileReadTool: ToolDefinition = {
  name: ToolNames.FILE_READ,
  description:
    '读取工作区内的文件内容（UTF-8 编码）。支持读取任意文本文件，包括代码、配置、文档等。' +
    '对于大文件，建议使用 offset 和 limit 参数按行号范围读取，避免一次性加载过多内容。' +
    '行号从 1 开始。如果不指定 offset 和 limit，则读取整个文件（上限 100KB）。',
  schema: z.object({
    path: z.string().describe('相对于工作区的文件路径'),
    offset: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('起始行号（从 1 开始）。不指定则从文件开头读取。'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('读取的最大行数。不指定则读取到文件末尾。'),
  }),
  permission: 'safe',
  async execute(args, ctx) {
    const fullPath = resolvePath(args.path, ctx);

    // 先检查文件大小，避免误读超大文件
    const stat = await fs.stat(fullPath);
    if (stat.size > MAX_READ_BYTES && args.offset === undefined && args.limit === undefined) {
      const sizeKB = Math.round(stat.size / 1024);
      return (
        `❌ 文件过大 (${sizeKB} KB)，超过单次读取上限 (100 KB)。\n` +
        `请使用 offset 和 limit 参数分段读取。例如：offset: 1, limit: 200`
      );
    }

    const content = await fs.readFile(fullPath, 'utf-8');

    // 如果未指定 offset/limit，返回完整内容（保持向后兼容）
    if (args.offset === undefined && args.limit === undefined) {
      return content;
    }

    const lines = content.split('\n');

    // 归一化 offset（从 1 开始的行号 → 0 开始的数组索引）
    const startLine = args.offset ?? 1;
    const startIdx = Math.max(0, startLine - 1);

    // 归一化 limit（默认到文件末尾）
    const endIdx = args.limit !== undefined
      ? Math.min(lines.length, startIdx + args.limit)
      : lines.length;

    // 边界检查
    if (startIdx >= lines.length) {
      return `(文件共 ${lines.length} 行，起始行 ${startLine} 超出范围)`;
    }

    const sliced = lines.slice(startIdx, endIdx);
    const header = `[行 ${startIdx + 1}-${endIdx} / 共 ${lines.length} 行]\n`;
    return header + sliced.join('\n');
  },
};

/**
 * file_write —— 写入内容到工作区文件
 *
 * 权限: confirm（写操作可能修改项目文件，需要用户确认）
 * 功能：如果父目录不存在则自动创建
 */
export const fileWriteTool: ToolDefinition = {
  name: ToolNames.FILE_WRITE,
  description:
    '将文本内容写入工作区的指定文件。如果文件所在目录不存在，会自动创建。会覆盖已存在的文件内容。',
  schema: z.object({
    path: z.string().describe('相对于工作区的文件路径'),
    content: z.string().describe('要写入的文本内容'),
  }),
  permission: 'confirm',
  async execute(args, ctx) {
    const fullPath = resolvePath(args.path, ctx);
    // 确保父目录存在
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, args.content, 'utf-8');
    return `文件已写入: ${args.path}`;
  },
};

/**
 * file_list —— 列出目录内容
 *
 * 权限: safe（只读操作）
 * 以图标区分文件和目录，便于 LLM 理解目录结构
 */
export const fileListTool: ToolDefinition = {
  name: ToolNames.FILE_LIST,
  description: '列出工作区内指定目录的内容，以图标区分文件和目录',
  schema: z.object({
    path: z.string().default('.').describe('相对于工作区的目录路径，默认为根目录'),
  }),
  permission: 'safe',
  async execute(args, ctx) {
    const fullPath = resolvePath(args.path, ctx);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    if (entries.length === 0) {
      return '(空目录)';
    }
    return entries
      .map((e) => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
      .join('\n');
  },
};