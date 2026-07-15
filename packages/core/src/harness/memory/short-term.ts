/**
 * ShortTermMemory —— 内存循环数组实现
 *
 * 单 Agent 当前对话的短期记忆，内存存储，无持久化。
 * 最多保留 200 条消息，超出上限自动淘汰最早的消息。
 */

import type { ShortTermMemory } from './types.js';

/** 最大消息条数 */
const MAX_ENTRIES = 200;

/**
 * 基于循环数组的短期记忆实现
 *
 * 线程不安全 —— 仅供单个 ExecutionEngine 使用。
 */
export class InMemoryShortTermMemory implements ShortTermMemory {
  private entries: Array<{ role: string; content: string }> = [];

  /** 追加一条消息，超出上限自动淘汰最早的消息 */
  add(entry: { role: string; content: string }): void {
    this.entries.push(entry);

    // 超出上限时移除最早的消息
    while (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  /** 获取最近 n 条消息 */
  recent(n: number): Array<{ role: string; content: string }> {
    if (n <= 0) return [];
    return this.entries.slice(-n);
  }

  /** 获取所有消息（返回副本） */
  all(): Array<{ role: string; content: string }> {
    return [...this.entries];
  }

  /** 清空所有消息 */
  clear(): void {
    this.entries = [];
  }

  /** 当前消息数量 */
  get size(): number {
    return this.entries.length;
  }
}
