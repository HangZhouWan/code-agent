/**
 * withRetry —— 指数退避重试机制
 *
 * 用于补充 LangChain SDK 层面的重试，覆盖协议检测、直接 fetch 等自定义场景。
 *
 * 重试策略：
 * - HTTP 429 (Rate Limit) → 重试
 * - HTTP 5xx (服务端错误) → 重试
 * - HTTP 4xx (非 429, 客户端错误) → 立即抛出
 * - 网络错误 (fetch 失败) → 重试
 * - 指数退避 + 随机抖动，避免惊群效应
 */

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** withRetry 的可选配置 */
export interface RetryOptions {
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 基础延迟（毫秒），默认 1000 */
  baseDelayMs?: number;
}

/**
 * 判断给定的 HTTP 状态码是否可重试
 *
 * 可重试：429 (Rate Limit)、5xx (服务端错误)
 * 不可重试：4xx 非 429 (客户端错误)
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ─────────────────────────────────────────────
// 核心函数
// ─────────────────────────────────────────────

/**
 * 为非重试错误创建带 HTTP 状态的 Error
 */
class HttpError extends Error {
  public status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * 带指数退避 + 随机抖动的重试包装器
 *
 * @param fn    - 返回 Promise<T> 的异步函数
 * @param options - 可选的重试配置
 * @returns fn 的成功返回值
 * @throws 当所有重试次数耗尽后，抛出最后一次的错误
 *
 * @example
 * ```ts
 * const data = await withRetry(
 *   () => fetch('https://api.example.com/v1/models'),
 *   { maxRetries: 3, baseDelayMs: 1000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // 最后一次尝试失败，不再重试
      if (attempt === maxRetries) {
        break;
      }

      // 判断是否可重试
      if (!isRetryable(error)) {
        throw error;
      }

      // 计算退避延迟：baseDelayMs × 2^attempt + random(0, 1000)ms
      const jitter = Math.floor(Math.random() * 1000);
      const delay = baseDelayMs * Math.pow(2, attempt) + jitter;

      console.warn(
        `[withRetry] 第 ${attempt + 1}/${maxRetries} 次重试，等待 ${delay}ms...`,
        error instanceof Error ? error.message : String(error),
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 检查错误是否为可重试的类型
 *
 * 可重试条件：
 * - 网络错误 (TypeError / fetch 失败)
 * - HttpError 且状态码可重试 (429 / 5xx)
 * - 通用的 Error 对象 (保守策略：网络错误通常表现为普通 Error)
 */
function isRetryable(error: unknown): boolean {
  // 检查是否为 HTTP 响应错误 (fetch 在非 2xx 时抛出)
  if (error instanceof HttpError) {
    return isRetryableStatus(error.status);
  }

  // 检查 Response 对象 (某些 fetch 实现的行为)
  if (error instanceof Response) {
    return isRetryableStatus(error.status);
  }

  // 网络错误 / fetch 本身的失败 (DNS、连接拒绝等)
  if (error instanceof TypeError) {
    return true;
  }

  // 通用 Error: 保守地视为可重试 (可能是网络层面的问题)
  if (error instanceof Error) {
    // 如果错误信息包含明确的 4xx 状态码，不重试
    const statusMatch = error.message.match(/status(?: code)? (\d+)/i);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      return isRetryableStatus(status);
    }
    return true;
  }

  // 未知错误类型，保守地视为可重试
  return true;
}

/**
 * 延迟指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 使用 fetch 进行带重试的 HTTP 请求
 *
 * 与 withRetry 配合使用：对非 2xx 响应抛出 HttpError，
 * 让 withRetry 根据状态码决定是否重试。
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retryOptions?: RetryOptions,
): Promise<Response> {
  return withRetry(async () => {
    const response = await fetch(url, init);

    if (!response.ok) {
      throw new HttpError(
        `HTTP ${response.status}: ${response.statusText} (${url})`,
        response.status,
      );
    }

    return response;
  }, retryOptions);
}