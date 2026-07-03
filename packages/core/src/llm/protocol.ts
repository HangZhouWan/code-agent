/**
 * detectProtocol —— API 协议自动检测
 *
 * 通过 HTTP 探测 /v1/models 端点，判断目标 API 遵循
 * OpenAI 还是 Anthropic 协议。
 *
 * 使用场景：
 * - 用户配置自定义端点 (Ollama / LM Studio / vLLM 等) 时自动识别
 * - 在不显式指定 provider 时推断协议类型
 */

import type { ProtocolType } from './types.js';
import { fetchWithRetry } from './retry.js';

// ─────────────────────────────────────────────
// 核心函数
// ─────────────────────────────────────────────

/**
 * 探测目标 baseURL 的 API 协议类型
 *
 * 探测逻辑：
 * 1. 向 `{baseURL}/v1/models` 发送 GET 请求
 * 2. 检查响应头 `anthropic-version` → 返回 `'anthropic'`
 * 3. 检查响应体格式 (含 `data` 数组 或 `object: 'list'`) → 返回 `'openai'`
 * 4. 无法确定 / 网络错误 → 返回 `'unknown'`
 *
 * @param baseURL - API 端点地址 (如 http://localhost:11434/v1)
 * @returns 检测到的协议类型
 *
 * @example
 * ```ts
 * // 检测本地 Ollama (OpenAI 兼容)
 * const protocol = await detectProtocol('http://localhost:11434/v1');
 * // → 'openai'
 *
 * // 检测 Anthropic API
 * const protocol = await detectProtocol('https://api.anthropic.com');
 * // → 'anthropic'
 * ```
 */
export async function detectProtocol(baseURL: string): Promise<ProtocolType> {
  // 规范化 baseURL：去除尾部斜杠
  const normalizedURL = baseURL.replace(/\/+$/, '');
  const modelsURL = `${normalizedURL}/models`;

  try {
    const response = await fetchWithRetry(
      modelsURL,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      },
    );

    // ── 检查 1：响应头中的 anthropic-version ──
    const anthropicVersion = response.headers.get('anthropic-version');
    if (anthropicVersion) {
      return 'anthropic';
    }

    // ── 检查 2：响应体格式 ──
    const body = await response.json();

    // OpenAI 格式: { object: "list", data: [...] }
    if (
      body.object === 'list' &&
      Array.isArray(body.data)
    ) {
      return 'openai';
    }

    // 其他可识别的 OpenAI 兼容格式：{ data: [...] }
    if (Array.isArray(body.data)) {
      return 'openai';
    }

    // 无法识别的响应体格式
    return 'unknown';
  } catch {
    // 网络错误 / 非 JSON 响应 / 非 2xx 状态码 → 无法确定
    return 'unknown';
  }
}