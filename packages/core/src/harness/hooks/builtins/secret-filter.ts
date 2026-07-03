/**
 * 内置 Hook：敏感信息过滤
 *
 * 在工具调用前后过滤参数和返回结果中的敏感信息，
 * 防止 API Key、Token、私钥等泄露到日志和上下文中。
 *
 * 过滤时机：
 * - tool:before → 过滤工具参数中的敏感值
 * - tool:after  → 过滤工具返回结果中的敏感值
 *
 * @example
 * ```ts
 * engine.on('tool:before', createSecretFilterHook());
 * engine.on('tool:after', createSecretFilterHook());
 * ```
 */

import type { HookHandler } from '../types.js';

/** 脱敏替换值 */
const REDACTED = '***REDACTED***';

/**
 * PEM 私钥块过滤模式
 *
 * 匹配 -----BEGIN ... PRIVATE KEY----- 到 -----END ... PRIVATE KEY----- 之间的完整块。
 * 应用于序列化后的 JSON 字符串。
 */
const PEM_PRIVATE_KEY_PATTERN =
  /-----BEGIN\s[A-Z\s]+\sPRIVATE\s+KEY-----[ \t]*[\s\S]*?-----END\s[A-Z\s]+\sPRIVATE\s+KEY-----/g;

/**
 * 敏感键名模式
 *
 * 匹配对象 key 中常见的凭据字段名（不区分大小写）。
 * 用于在脱敏时判断某个 key 对应的 value 是否需要替换。
 */
const SENSITIVE_KEY_PATTERN =
  /(?:^|[_-])(sk|api[_-]?key|token|secret|password|passwd|auth|authorization|credential|private[_-]?key|access[_-]?key)(?:$|[_-])/i;

/**
 * 判断 key 是否为敏感键名
 *
 * @param key - 对象键名
 * @returns 是否敏感
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * 对文本内容执行 PEM 私钥块脱敏
 *
 * @param content - 原始内容
 * @returns 脱敏后的内容
 */
function redactPEMBlocks(content: string): string {
  return content.replace(PEM_PRIVATE_KEY_PATTERN, REDACTED);
}

/**
 * 递归遍历对象，对敏感键名的字符串值执行脱敏
 *
 * @param obj - 待脱敏的对象
 * @returns 脱敏后的新对象
 */
function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      if (isSensitiveKey(key) && value.length >= 20) {
        result[key] = REDACTED;
      } else {
        // 仍检查字符串中是否包含 PEM 块
        result[key] = redactPEMBlocks(value);
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 创建敏感信息过滤 Hook
 *
 * - tool:before → 过滤 ctx.data.args 中的敏感值，通过 modifiedArgs 返回
 * - tool:after  → 过滤 ctx.data.result 中的敏感值，通过 modifiedResult 返回
 * - 其他事件   → 无操作
 *
 * @returns HookHandler
 */
export function createSecretFilterHook(): HookHandler {
  return async (ctx) => {
    switch (ctx.event) {
      case 'tool:before': {
        const args = ctx.data.args as Record<string, unknown> | undefined;
        if (args) {
          return { modifiedArgs: redactObject(args) };
        }
        return;
      }
      case 'tool:after': {
        const result = ctx.data.result;
        if (result && typeof result === 'object') {
          return {
            modifiedResult: redactObject(result as Record<string, unknown>),
          };
        }
        return;
      }
      default:
        // 其他事件无需过滤
        return;
    }
  };
}
