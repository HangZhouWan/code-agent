/**
 * 文件系统工具（新契约）
 *
 * 统一使用 resolveWorkspacePath 做路径安全校验；
 * 写操作声明 sideEffect: 'mutating'，由 middleware 加写锁并审批。
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition, ToolResult } from "../base.js";
import { toolError, toolOk } from "../middleware.js";
import { resolveWorkspacePath } from "../../permissions/paths.js";
import { ToolNames } from "../tool-names.js";

const execFileAsync = promisify(execFile);

const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_UNRANGED_READ_BYTES = 100 * 1024;
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", ".agent", "coverage"]);

/**
 * 返回路径命中的顶层忽略目录名。
 *
 * 输入：工作区根目录、已解析的绝对路径
 * 输出：命中的目录名（如 .agent），未命中返回 undefined
 */
function ignoredTopLevelDir(
  workspacePath: string,
  fullPath: string,
): string | undefined {
  const relative = path.relative(workspacePath, fullPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  const first = relative.split(path.sep)[0];
  return IGNORED_DIRS.has(first) ? first : undefined;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export const fileReadTool: ToolDefinition<z.ZodObject<{
  path: z.ZodString;
  offset: z.ZodOptional<z.ZodNumber>;
  limit: z.ZodOptional<z.ZodNumber>;
}>> = {
  name: ToolNames.FILE_READ,
  description:
    "读取工作区内的文本文件。大文件请使用 offset/limit 按行读取；行号从 1 开始。",
  schema: z.object({
    path: z.string().describe("相对于工作区的文件路径"),
    offset: z.number().int().min(1).optional().describe("起始行号（1-based）"),
    limit: z.number().int().min(1).optional().describe("读取的最大行数"),
  }),
  permission: "allow",
  sideEffect: "none",
  async execute(args, ctx): Promise<ToolResult> {
    const fullPath = resolveWorkspacePath(ctx.workspacePath, args.path);
    const ignored = ignoredTopLevelDir(ctx.workspacePath, fullPath);
    if (ignored) {
      return toolError(`禁止访问运行时/构建目录: ${ignored}`, "VALIDATION");
    }
    const stat = await fs.stat(fullPath);

    if (
      stat.size > MAX_UNRANGED_READ_BYTES &&
      args.offset === undefined &&
      args.limit === undefined
    ) {
      return toolError(
        `文件过大 (${Math.round(stat.size / 1024)} KB)。请使用 offset/limit 分段读取。`,
        "VALIDATION",
      );
    }
    if (stat.size > MAX_READ_BYTES) {
      return toolError(
        `文件超过单次读取上限 (${MAX_READ_BYTES / 1024} KB)，请使用 offset/limit。`,
        "VALIDATION",
      );
    }

    const buffer = await fs.readFile(fullPath);
    if (isBinary(buffer)) {
      return toolError(`无法读取二进制文件: ${args.path}`, "VALIDATION");
    }

    const content = buffer.toString("utf-8");
    if (args.offset === undefined && args.limit === undefined) {
      return toolOk(content, { path: args.path, size: stat.size });
    }

    const lines = content.split("\n");
    const startIdx = Math.max(0, (args.offset ?? 1) - 1);
    const endIdx =
      args.limit !== undefined
        ? Math.min(lines.length, startIdx + args.limit)
        : lines.length;

    if (startIdx >= lines.length) {
      return toolOk(`(文件共 ${lines.length} 行，起始行 ${startIdx + 1} 超出范围)`, {
        totalLines: lines.length,
        startLine: startIdx + 1,
        endLine: endIdx,
      });
    }

    return toolOk(
      `[行 ${startIdx + 1}-${endIdx} / 共 ${lines.length} 行]\n` +
        lines.slice(startIdx, endIdx).join("\n"),
      {
        totalLines: lines.length,
        startLine: startIdx + 1,
        endLine: endIdx,
      },
    );
  },
};

export const fileWriteTool: ToolDefinition<z.ZodObject<{
  path: z.ZodString;
  content: z.ZodString;
  append: z.ZodOptional<z.ZodBoolean>;
}>> = {
  name: ToolNames.FILE_WRITE,
  description:
    "将文本内容写入工作区文件；父目录不存在时自动创建。默认覆盖已有内容。" +
    "内容较大时请分多次调用：首次 append=false 写入开头，后续 append=true 逐段追加；" +
    "每次 content 建议不超过 6000 字符，且必须提供 path。",
  schema: z.object({
    path: z.string().describe("相对于工作区的文件路径（必填）"),
    content: z.string().describe("要写入的文本内容"),
    append: z
      .boolean()
      .optional()
      .describe("true 时追加到文件末尾；默认 false（覆盖）"),
  }),
  permission: "confirm",
  sideEffect: "mutating",
  async execute(args, ctx): Promise<ToolResult> {
    const fullPath = resolveWorkspacePath(ctx.workspacePath, args.path);
    const ignored = ignoredTopLevelDir(ctx.workspacePath, fullPath);
    if (ignored) {
      return toolError(`禁止写入运行时/构建目录: ${ignored}`, "VALIDATION");
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    if (args.append) {
      await fs.appendFile(fullPath, args.content, "utf-8");
    } else {
      await fs.writeFile(fullPath, args.content, "utf-8");
    }
    return toolOk(
      `文件已${args.append ? "追加" : "写入"}: ${args.path}`,
      {
        path: args.path,
        bytes: Buffer.byteLength(args.content, "utf-8"),
        append: args.append === true,
      },
    );
  },
};

export const fileEditTool: ToolDefinition<z.ZodObject<{
  path: z.ZodString;
  old_string: z.ZodString;
  new_string: z.ZodString;
  replace_all: z.ZodOptional<z.ZodBoolean>;
}>> = {
  name: ToolNames.FILE_EDIT,
  description:
    "对已有文件执行精确字符串替换。old_string 必须唯一匹配（除非 replace_all=true）。",
  schema: z.object({
    path: z.string().describe("相对于工作区的文件路径"),
    old_string: z.string().describe("要替换的原文"),
    new_string: z.string().describe("替换后的文本"),
    replace_all: z.boolean().optional().describe("是否替换所有匹配项"),
  }),
  permission: "confirm",
  sideEffect: "mutating",
  async execute(args, ctx): Promise<ToolResult> {
    const fullPath = resolveWorkspacePath(ctx.workspacePath, args.path);
    const ignored = ignoredTopLevelDir(ctx.workspacePath, fullPath);
    if (ignored) {
      return toolError(`禁止修改运行时/构建目录: ${ignored}`, "VALIDATION");
    }
    const content = await fs.readFile(fullPath, "utf-8");

    if (!content.includes(args.old_string)) {
      return toolError(
        `在 ${args.path} 中找不到指定的 old_string`,
        "TOOL_FAILED",
      );
    }

    const occurrences = content.split(args.old_string).length - 1;
    if (occurrences > 1 && !args.replace_all) {
      return toolError(
        `old_string 在 ${args.path} 中匹配 ${occurrences} 次；请提供更多上下文或设置 replace_all=true`,
        "TOOL_FAILED",
      );
    }

    const updated = args.replace_all
      ? content.split(args.old_string).join(args.new_string)
      : content.replace(args.old_string, args.new_string);
    await fs.writeFile(fullPath, updated, "utf-8");

    return toolOk(`文件已更新: ${args.path}`, {
      path: args.path,
      occurrences: args.replace_all ? occurrences : 1,
    });
  },
};

export const fileListTool: ToolDefinition<z.ZodObject<{
  path: z.ZodDefault<z.ZodString>;
  depth: z.ZodDefault<z.ZodNumber>;
}>> = {
  name: ToolNames.FILE_LIST,
  description: "列出工作区内目录的内容；目录以 / 结尾。",
  schema: z.object({
    path: z.string().default(".").describe("相对于工作区的目录路径"),
    depth: z.number().int().min(1).max(5).default(1).describe("递归深度"),
  }),
  permission: "allow",
  sideEffect: "none",
  async execute(args, ctx): Promise<ToolResult> {
    const root = resolveWorkspacePath(ctx.workspacePath, args.path);
    const ignored = ignoredTopLevelDir(ctx.workspacePath, root);
    if (ignored) {
      return toolError(`禁止访问运行时/构建目录: ${ignored}`, "VALIDATION");
    }
    const lines: string[] = [];

    async function walk(dir: string, relative: string, remaining: number) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.name !== ".env.example") {
          continue;
        }
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          lines.push(`${rel}/`);
          if (remaining > 1 && !IGNORED_DIRS.has(entry.name)) {
            await walk(path.join(dir, entry.name), rel, remaining - 1);
          }
        } else {
          lines.push(rel);
        }
      }
    }

    await walk(root, "", args.depth);
    return toolOk(lines.length ? lines.join("\n") : "(空目录)", {
      count: lines.length,
    });
  },
};

function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${out}$`);
}

export const fileGlobTool: ToolDefinition<z.ZodObject<{
  pattern: z.ZodString;
  path: z.ZodDefault<z.ZodString>;
  maxResults: z.ZodDefault<z.ZodNumber>;
}>> = {
  name: ToolNames.FILE_GLOB,
  description:
    "按 glob 模式查找工作区文件，例如 **/*.ts、src/**/*.test.ts。",
  schema: z.object({
    pattern: z.string().min(1).describe("glob 模式"),
    path: z.string().default(".").describe("搜索起始目录"),
    maxResults: z.number().int().min(1).max(5000).default(1000),
  }),
  permission: "allow",
  sideEffect: "none",
  async execute(args, ctx): Promise<ToolResult> {
    const root = resolveWorkspacePath(ctx.workspacePath, args.path);
    const ignored = ignoredTopLevelDir(ctx.workspacePath, root);
    if (ignored) {
      return toolError(`禁止访问运行时/构建目录: ${ignored}`, "VALIDATION");
    }
    const effectivePattern = args.pattern.includes("/")
      ? args.pattern
      : `**/${args.pattern}`;
    const matcher = globToRegExp(effectivePattern);
    const results: string[] = [];
    let truncated = false;

    async function walk(dir: string, relative: string): Promise<void> {
      if (results.length >= args.maxResults) {
        truncated = true;
        return;
      }
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= args.maxResults) {
          truncated = true;
          return;
        }
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(dir, entry.name), rel);
        } else if (matcher.test(rel)) {
          results.push(rel);
        }
      }
    }

    await walk(root, "");
    results.sort();
    return toolOk(results.length ? results.join("\n") : "未找到匹配文件。", {
      count: results.length,
      truncated,
    });
  },
};

export const codeSearchTool: ToolDefinition<z.ZodObject<{
  pattern: z.ZodString;
  path: z.ZodDefault<z.ZodString>;
  glob: z.ZodOptional<z.ZodString>;
  maxResults: z.ZodDefault<z.ZodNumber>;
  contextLines: z.ZodOptional<z.ZodNumber>;
}>> = {
  name: ToolNames.CODE_SEARCH,
  description:
    "在工作区代码中按正则搜索文本，返回文件名、行号和匹配行。",
  schema: z.object({
    pattern: z.string().min(1).describe("搜索模式（正则）"),
    path: z.string().default(".").describe("搜索目录"),
    glob: z.string().optional().describe("文件过滤，例如 *.ts"),
    maxResults: z.number().int().min(1).max(500).default(50),
    contextLines: z.number().int().min(0).max(5).optional(),
  }),
  permission: "allow",
  sideEffect: "none",
  async execute(args, ctx): Promise<ToolResult> {
    const fullPath = resolveWorkspacePath(ctx.workspacePath, args.path);
    const ignored = ignoredTopLevelDir(ctx.workspacePath, fullPath);
    if (ignored) {
      return toolError(`禁止搜索运行时/构建目录: ${ignored}`, "VALIDATION");
    }
    const relativePath = path.relative(ctx.workspacePath, fullPath) || ".";
    const grepArgs = ["-rn", "--color=never", "-m", String(args.maxResults)];
    if (args.glob) grepArgs.push(`--include=${args.glob}`);
    if (args.contextLines) grepArgs.push(`-C`, String(args.contextLines));
    grepArgs.push("--", args.pattern, relativePath);

    try {
      const { stdout } = await execFileAsync("grep", grepArgs, {
        cwd: ctx.workspacePath,
        timeout: 15_000,
        maxBuffer: 5 * 1024 * 1024,
        signal: ctx.signal,
      });
      return toolOk(stdout || "未找到匹配项。");
    } catch (error) {
      const code = (error as { code?: number | string }).code;
      if (String(code) === "1") {
        return toolOk("未找到匹配项。");
      }
      if (ctx.signal?.aborted) {
        return toolError("搜索已取消", "ABORTED");
      }
      return toolError(
        error instanceof Error ? error.message : String(error),
        "TOOL_FAILED",
      );
    }
  },
};
