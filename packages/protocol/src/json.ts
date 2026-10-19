/**
 * JSON-safe 基础类型
 *
 * protocol 的所有 DTO 必须可 JSON 序列化：
 * - 不包含 Date / class instance / Map / Set
 * - 时间统一使用 ISO 8601 字符串
 */

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export interface JsonArray extends ReadonlyArray<JsonValue> {}

/** ISO 8601 时间字符串，例如 2026-10-19T12:00:00.000Z */
export type IsoTimestamp = string;

/** 判断一个值是否为 JsonValue（用于边界校验的轻量工具） */
export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(
      (entry) => entry === undefined || isJsonValue(entry),
    );
  }

  return false;
}
