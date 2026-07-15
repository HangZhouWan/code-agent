/**
 * WorkingMemory —— 共享白板实现
 *
 * 当前 task 内所有 Agent 共享的键值存储。
 * 基于内存 Map 实现，task 结束即清理，无持久化。
 */

import type { WorkingMemory } from './types.js';

/**
 * 基于 Map 的工作记忆实现
 *
 * 线程不安全 —— Agent 之间通过 EventBus 协调访问。
 */
export class InMemoryWorkingMemory implements WorkingMemory {
  private store = new Map<string, unknown>();

  /** 写入键值 */
  write(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /** 读取键值，不存在返回 null */
  read<T = unknown>(key: string): T | null {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return value as T;
  }

  /** 获取全部快照（返回副本） */
  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.store) {
      result[key] = value;
    }
    return result;
  }

  /** 清空所有键值 */
  clear(): void {
    this.store.clear();
  }

  /** 当前白板上的键数量 */
  get size(): number {
    return this.store.size;
  }
}
