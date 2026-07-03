/**
 * Web 请求工具
 *
 * 提供 HTTP GET 请求能力，用于获取网页内容或 JSON API 数据。
 *
 * 安全与限制：
 * - 仅支持 GET 请求
 * - 15 秒超时
 * - 仅处理文本类内容（text/*、application/json）
 * - 超过 maxLength 时自动截断
 * - 可识别 User-Agent 标识
 */

import { z } from 'zod';
import type { ToolDefinition, ToolContext } from './base.js';

/**
 * web.fetch —— 获取 URL 内容
 *
 * 权限: safe（只读网络请求）
 * 仅获取文本/JSON 内容，拒绝二进制数据。
 */
export const webFetchTool: ToolDefinition = {
  name: 'web.fetch',
  description:
    '发送 HTTP GET 请求获取指定 URL 的文本内容。' +
    '适用于获取网页、API 响应、文档等。仅返回文本/JSON 类型的内容。',
  schema: z.object({
    url: z.string().describe('要请求的 URL 地址'),
    maxLength: z
      .number()
      .default(50000)
      .describe('返回内容的最大字符数，超出部分将被截断'),
  }),
  permission: 'safe',
  async execute(args, _ctx) {
    const res = await fetch(args.url, {
      headers: { 'User-Agent': 'MyAgent/1.0' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });

    if (!res.ok) {
      return `HTTP ${res.status}: ${res.statusText}`;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/') && !contentType.includes('application/json')) {
      return `无法获取二进制内容 (${contentType})。此工具仅支持文本和 JSON 类型的内容。`;
    }

    const text = await res.text();
    if (text.length > args.maxLength) {
      return text.slice(0, args.maxLength) + `\n\n[内容已截断，原始长度: ${text.length} 字符]`;
    }
    return text;
  },
};
