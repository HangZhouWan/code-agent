/**
 * 模型配置 API client
 *
 * GET  /api/config —— 读取当前配置（API Key 为脱敏值）
 * POST /api/config —— 保存配置（首次配置与后续修改共用）
 */

import { isProviderId, type ProviderId } from "@code-agent/protocol";

/** 前端视图中的模型配置（Key 已脱敏） */
export interface ModelConfigView {
  provider: ProviderId;
  model: string;
  /** 服务端返回的脱敏 Key；空串表示未设置 */
  maskedApiKey: string;
  /** 自定义端点；空串表示使用 Provider 默认地址 */
  baseUrl: string;
}

/** 保存配置的输入；空 apiKey 表示沿用服务端已保存的 Key */
export interface SaveModelConfigInput {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  /** 空串表示清除自定义端点 */
  baseUrl?: string;
}

/** 将未知值收窄为普通对象 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 从后端错误响应中提取可读信息 */
function errorMessage(body: unknown, fallback: string): string {
  const record = asRecord(body);
  if (!record) return fallback;

  // POST 失败：{ success: false, error: "..." }
  if (typeof record.error === "string") return record.error;
  // 网关错误：{ error: { message: "..." } }
  const nested = asRecord(record.error);
  if (nested && typeof nested.message === "string") return nested.message;
  // 兜底：{ message: "..." }
  if (typeof record.message === "string") return record.message;
  return fallback;
}

/**
 * 读取当前模型配置。
 *
 * @returns 已配置时返回脱敏配置；未配置时返回 null
 */
export async function fetchModelConfig(): Promise<ModelConfigView | null> {
  const res = await fetch("/api/config");
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(errorMessage(data, `请求失败 (${res.status})`));
  }

  const raw = asRecord(data);
  if (!raw) return null;

  const provider = raw.LLM_PROVIDER;
  const model = raw.LLM_MODEL;
  if (typeof provider !== "string" || !isProviderId(provider)) return null;
  if (typeof model !== "string" || model.length === 0) return null;

  return {
    provider,
    model,
    maskedApiKey:
      typeof raw.LLM_API_KEY === "string" ? raw.LLM_API_KEY : "",
    baseUrl: typeof raw.LLM_BASE_URL === "string" ? raw.LLM_BASE_URL : "",
  };
}

/**
 * 保存模型配置。
 *
 * - apiKey 为空时不提交该字段，服务端沿用已保存的 Key
 * - baseUrl 为空时提交 null，服务端清除自定义端点
 *
 * @throws 保存失败时抛出带后端错误信息的 Error
 */
export async function saveModelConfig(
  input: SaveModelConfigInput,
): Promise<void> {
  const apiKey = input.apiKey?.trim() ?? "";
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      LLM_PROVIDER: input.provider,
      LLM_MODEL: input.model.trim(),
      ...(apiKey ? { LLM_API_KEY: apiKey } : {}),
      LLM_BASE_URL: input.baseUrl?.trim() || null,
    }),
  });

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(errorMessage(data, `请求失败 (${res.status})`));
  }
  const record = asRecord(data);
  if (record && record.success === false) {
    throw new Error(errorMessage(data, "保存失败"));
  }
}
