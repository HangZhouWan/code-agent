/**
 * Hooks 引擎 —— HooksEngine
 *
 * 事件驱动的插件机制核心。管理 HookHandler 的注册、移除和触发。
 *
 * 核心职责：
 * - 注册/移除 handler（on / off）
 * - 触发事件并收集合并结果（trigger）
 * - 容错：单个 handler 异常不影响其他 handler
 *
 * @example
 * ```ts
 * const engine = new HooksEngine();
 * engine.on('tool:before', async (ctx) => {
 *   console.log(`Tool about to execute: ${ctx.data.toolName}`);
 * });
 *
 * const result = await engine.trigger('tool:before', {
 *   agentId: 'agent-1',
 *   data: { toolName: 'file_read', args: { path: './test.txt' } },
 * });
 * ```
 */

import type { HookEvent, HookContext, HookResult, HookHandler } from './types.js';

/**
 * Hooks 引擎
 *
 * 线程不安全 —— 应在单线程环境中使用，避免并发注册/触发。
 */
export class HooksEngine {
  /** 事件 → handler 列表映射 */
  private handlers = new Map<HookEvent, HookHandler[]>();

  /**
   * 注册事件处理器
   *
   * 可以多次调用为同一事件注册多个 handler，
   * 触发时按注册顺序依次执行。
   *
   * @param event - 事件名称
   * @param handler - 处理函数
   */
  on(event: HookEvent, handler: HookHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.push(handler);
    } else {
      this.handlers.set(event, [handler]);
    }
  }

  /**
   * 移除事件处理器
   *
   * 使用引用相等性比较（===）来匹配 handler。
   * 如果 handler 未注册，静默忽略。
   *
   * @param event - 事件名称
   * @param handler - 要移除的处理函数（必须是注册时传入的同一个引用）
   */
  off(event: HookEvent, handler: HookHandler): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * 触发事件
   *
   * 遍历该事件的所有 handler，依次执行。合并规则：
   * - 单个 handler 异常不阻塞其他 handler（异常被静默捕获）
   * - 多个 handler 的 modifiedArgs / modifiedResult 浅合并
   * - 任一 handler 返回 skip: true → 合并结果 skip = true
   *
   * @param event - 事件名称
   * @param partialCtx - 部分上下文（event、timestamp 自动填充）
   * @returns 合并后的 HookResult
   */
  async trigger(
    event: HookEvent,
    partialCtx: Omit<HookContext, 'event' | 'timestamp'>,
  ): Promise<HookResult> {
    const ctx: HookContext = {
      event,
      timestamp: new Date().toISOString(),
      ...partialCtx,
    };

    const handlers = this.handlers.get(event);
    if (!handlers || handlers.length === 0) {
      return {};
    }

    const merged: HookResult = {};

    for (const handler of handlers) {
      try {
        const result = await handler(ctx);
        if (result) {
          // 合并 modifiedArgs
          if (result.modifiedArgs) {
            merged.modifiedArgs = {
              ...(merged.modifiedArgs ?? {}),
              ...result.modifiedArgs,
            };
          }
          // 合并 modifiedResult
          if (result.modifiedResult) {
            merged.modifiedResult = {
              ...(merged.modifiedResult ?? {}),
              ...result.modifiedResult,
            };
          }
          // skip 逻辑：任一 handler 返回 true 则整体为 true
          if (result.skip) {
            merged.skip = true;
          }
        }
      } catch {
        // 单个 handler 异常不阻塞其他 handler，静默忽略
      }
    }

    return merged;
  }
}
