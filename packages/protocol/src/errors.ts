/**
 * 统一错误分类
 *
 * 所有跨边界（WS / REST / bus / checkpoint）的错误都序列化为 SerializedError，
 * 由适配器决定 HTTP 状态码或 UI 展示方式。
 */

import type { JsonValue } from "./json.js";

export const ERROR_CODES = [
  "VALIDATION",
  "SESSION_BUSY",
  "RUN_NOT_FOUND",
  "APPROVAL_NOT_FOUND",
  "APPROVAL_DENIED",
  "LLM_RETRYABLE",
  "LLM_FATAL",
  "TOOL_FAILED",
  "TIMEOUT",
  "BUS_TIMEOUT",
  "ABORTED",
  "CONTEXT_OVERFLOW",
  "CHECKPOINT_INCOMPATIBLE",
  "RESUME_SIDE_EFFECT_UNCERTAIN",
  "PERSISTENCE_FAILED",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: JsonValue;
}

export interface ApiError extends SerializedError {
  requestId?: string;
}

/** 判断一个值是否已经是 SerializedError */
export function isSerializedError(value: unknown): value is SerializedError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

/** 将任意异常转换为可跨边界传输的错误 */
export function serializeError(
  error: unknown,
  code: ErrorCode = "INTERNAL",
  details?: JsonValue,
): SerializedError {
  if (isSerializedError(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code,
    message,
    retryable: false,
    ...(details === undefined ? {} : { details }),
  };
}

/** 构造取消错误 */
export function abortError(reason = "Operation aborted"): SerializedError {
  return {
    code: "ABORTED",
    message: reason,
    retryable: false,
  };
}
