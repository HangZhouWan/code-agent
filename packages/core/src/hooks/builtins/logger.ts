/**
 * 内置 Hook：日志记录
 *
 * 将所有生命周期事件以结构化格式输出到 console，
 * 用于调试和审计追踪。
 *
 * @example
 * ```ts
 * engine.on('agent:start', createLoggerHook());
 * engine.on('tool:before', createLoggerHook());
 * ```
 */

import type { HookHandler } from '../types.js';

/**
 * 创建日志记录 Hook
 *
 * 将事件以 `[ISO时间戳] [事件名] agent=xxx` 格式输出到 console.log。
 *
 * @returns HookHandler
 */
export function createLoggerHook(): HookHandler {
  return async (ctx) => {
    const { timestamp, event, agentId } = ctx;
    // 避免日志输出敏感数据，仅输出事件名和 agentId
    console.log(`[${timestamp}] [${event}] agent=${agentId}`);
  };
}
