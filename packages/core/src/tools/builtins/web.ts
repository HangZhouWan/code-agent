/**
 * Web 工具（新契约）
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../base.js";
import { toolError, toolOk } from "../middleware.js";
import { ToolNames } from "../tool-names.js";

export const webFetchTool: ToolDefinition<z.ZodObject<{
  url: z.ZodString;
  maxLength: z.ZodDefault<z.ZodNumber>;
}>> = {
  name: ToolNames.WEB_FETCH,
  description:
    "HTTP GET 获取文本/JSON 内容；仅支持 http/https，拒绝二进制内容。",
  schema: z.object({
    url: z.string().url().describe("要请求的 URL"),
    maxLength: z
      .number()
      .int()
      .min(1_000)
      .max(500_000)
      .default(50_000)
      .describe("返回内容的最大字符数"),
  }),
  permission: "allow",
  sideEffect: "none",
  async execute(args, ctx): Promise<ToolResult> {
    let parsed: URL;
    try {
      parsed = new URL(args.url);
    } catch {
      return toolError(`非法 URL: ${args.url}`, "VALIDATION");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return toolError("仅支持 http/https URL", "VALIDATION");
    }

    const timeoutSignal = AbortSignal.timeout(15_000);
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await fetch(parsed, {
        headers: { "User-Agent": "code-agent/0.1" },
        signal,
        redirect: "follow",
      });

      if (!response.ok) {
        return toolError(
          `HTTP ${response.status}: ${response.statusText}`,
          "TOOL_FAILED",
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (
        !contentType.includes("text/") &&
        !contentType.includes("application/json") &&
        !contentType.includes("application/xml")
      ) {
        return toolError(
          `无法获取二进制内容 (${contentType || "unknown"})`,
          "VALIDATION",
        );
      }

      const text = await response.text();
      const truncated = text.length > args.maxLength;
      const content = truncated
        ? `${text.slice(0, args.maxLength)}\n\n[内容已截断，原始长度: ${text.length} 字符]`
        : text;

      return toolOk(content, {
        url: parsed.toString(),
        status: response.status,
        contentType,
        truncated,
        originalLength: text.length,
      });
    } catch (error) {
      if (signal.aborted) {
        return toolError("请求已取消或超时", "TIMEOUT");
      }
      return toolError(
        error instanceof Error ? error.message : String(error),
        "TOOL_FAILED",
      );
    }
  },
};
