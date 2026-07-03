/**
 * 全局错误处理器
 *
 * 三层错误分类：
 * | 错误类型          | HTTP 状态码 | 示例                     |
 * |-------------------|-------------|--------------------------|
 * | ZodError          | 400         | 请求体校验失败           |
 * | 配置/认证错误     | 503         | API Key 无效 / 模型不可用|
 * | 其他未知错误      | 500         | 内部异常                 |
 *
 * 响应格式统一为：
 * ```json
 * { "error": "ErrorType", "message": "...", "details?": [...] }
 * ```
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 统一错误响应体 */
interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown[];
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 判断错误是否与 LLM 认证/配置相关
 *
 * 检测错误消息中的关键词来判断是否为配置错误。
 */
function isConfigurationError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const configKeywords = [
    "api key",
    "apikey",
    "api_key",
    "unauthorized",
    "authentication",
    "invalid key",
    "incorrect api key",
    "invalid_api_key",
    "401",
    "403",
  ];
  return configKeywords.some((kw) => message.includes(kw));
}

// ---------------------------------------------------------------------------
// 核心处理器
// ---------------------------------------------------------------------------

/**
 * Fastify 全局错误处理器
 *
 * 通过 app.setErrorHandler() 注册，统一格式化所有未捕获的错误。
 *
 * @param error - Fastify 或应用抛出的错误
 * @param _request - 触发错误的请求对象
 * @param reply - Fastify 响应对象
 */
export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  // ── 第一层：Zod 校验错误 → 400 ──
  if (error instanceof ZodError) {
    const body: ErrorResponse = {
      error: "ValidationError",
      message: "Request validation failed",
      details: error.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    };
    reply.status(400).send(body);
    return;
  }

  // ── 第二层：配置/认证错误 → 503 ──
  if (isConfigurationError(error)) {
    const body: ErrorResponse = {
      error: "ConfigurationError",
      message: "Service configuration error — check API keys and model settings",
    };
    reply.status(503).send(body);
    return;
  }

  // ── 第三层：未知内部错误 → 500 ──
  const body: ErrorResponse = {
    error: "InternalError",
    message:
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : error.message,
  };

  // 开发环境下附带堆栈信息
  if (process.env.NODE_ENV !== "production" && error.stack) {
    body.details = [error.stack];
  }

  reply.status(500).send(body);
}
