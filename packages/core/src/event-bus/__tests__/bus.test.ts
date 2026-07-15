/**
 * EventBus 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryEventBus } from '../bus.js';
import type { BusMessage } from '../types.js';
import { BusTimeoutError } from '../types.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** 创建一个无操作的消息处理器 */
function makeHandler(): { handler: (msg: BusMessage) => Promise<void>; calls: BusMessage[] } {
  const calls: BusMessage[] = [];
  const handler = async (msg: BusMessage) => {
    calls.push(msg);
  };
  return { handler, calls };
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe('InMemoryEventBus', () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  afterEach(() => {
    // 确保每次测试后没有残留的 timer
  });

  // ─── publish ──────────────────────────────

  describe('publish', () => {
    it('精确订阅者收到消息', async () => {
      const { handler, calls } = makeHandler();
      bus.subscribe('agent.event.code_changed', handler);

      await bus.publish('agent.event.code_changed', { file: 'index.ts' });

      expect(calls).toHaveLength(1);
      expect(calls[0].topic).toBe('agent.event.code_changed');
      expect(calls[0].payload).toEqual({ file: 'index.ts' });
    });

    it('通配订阅者收到消息', async () => {
      const { handler, calls } = makeHandler();
      bus.subscribePattern('agent.event.*', handler);

      await bus.publish('agent.event.code_changed', { file: 'index.ts' });
      await bus.publish('agent.event.test_passed', { total: 42 });

      expect(calls).toHaveLength(2);
      expect(calls[0].topic).toBe('agent.event.code_changed');
      expect(calls[1].topic).toBe('agent.event.test_passed');
    });

    it('通配模式 ** 匹配多段', async () => {
      const { handler, calls } = makeHandler();
      bus.subscribePattern('agent.event.**.changed', handler);

      await bus.publish('agent.event.code.changed', {} as any);
      await bus.publish('agent.event.sub.nested.changed', {} as any);

      expect(calls).toHaveLength(2);
      expect(calls[0].topic).toBe('agent.event.code.changed');
      expect(calls[1].topic).toBe('agent.event.sub.nested.changed');
    });

    it('无匹配订阅者不报错', async () => {
      // 不应该抛出任何异常
      await expect(
        bus.publish('agent.event.no_listener', {} as any),
      ).resolves.toBeUndefined();
    });

    it('消息包含正确的 metadata', async () => {
      const { handler, calls } = makeHandler();
      bus.subscribe('agent.command.test', handler);

      await bus.publish('agent.command.test', { data: 1 }, {
        senderId: 'test-agent',
        taskId: 'task-001',
      });

      expect(calls[0].metadata.senderId).toBe('test-agent');
      expect(calls[0].metadata.taskId).toBe('task-001');
      expect(calls[0].metadata.timestamp).toBeInstanceOf(Date);
    });

    it('多个精确订阅者都收到消息', async () => {
      const h1 = makeHandler();
      const h2 = makeHandler();
      bus.subscribe('agent.event.shared', h1.handler);
      bus.subscribe('agent.event.shared', h2.handler);

      await bus.publish('agent.event.shared', { x: 1 } as any);

      expect(h1.calls).toHaveLength(1);
      expect(h2.calls).toHaveLength(1);
    });
  });

  // ─── request-reply ────────────────────────

  describe('request / reply', () => {
    it('收到 reply 后 request 返回响应消息', async () => {
      // 模拟订阅者：收到 request 后 reply
      bus.subscribe('agent.command.echo', async (msg) => {
        await bus.reply(msg.metadata.correlationId!, { echo: msg.payload });
      });

      const response = await bus.request('agent.command.echo', 'hello', 5000);

      expect(response.payload).toEqual({ echo: 'hello' });
      expect(response.metadata.correlationId).toBeDefined();
    });

    it('超时抛出 BusTimeoutError', async () => {
      // 没有订阅者 reply，应该超时
      await expect(
        bus.request('agent.command.no_reply', 'data', 100),
      ).rejects.toThrow(BusTimeoutError);
    });

    it('reply 无匹配 request 时静默忽略', async () => {
      // 直接调用 reply 到不存在的 correlationId
      await expect(
        bus.reply('non_existent_id', 'data'),
      ).resolves.toBeUndefined();
    });
  });

  // ─── unsubscribe ──────────────────────────

  describe('unsubscribe', () => {
    it('取消订阅后不再收到消息', async () => {
      const { handler, calls } = makeHandler();
      const unsub = bus.subscribe('agent.event.test', handler);

      await bus.publish('agent.event.test', { seq: 1 } as any);
      expect(calls).toHaveLength(1);

      unsub();

      await bus.publish('agent.event.test', { seq: 2 } as any);
      expect(calls).toHaveLength(1); // 仍然是 1
    });

    it('取消通配订阅后不再收到消息', async () => {
      const { handler, calls } = makeHandler();
      const unsub = bus.subscribePattern('agent.event.*', handler);

      await bus.publish('agent.event.test', {} as any);
      expect(calls).toHaveLength(1);

      unsub();

      await bus.publish('agent.event.test', {} as any);
      expect(calls).toHaveLength(1);
    });
  });

  // ─── 错误隔离 ─────────────────────────────

  describe('错误隔离', () => {
    it('订阅者抛异常不影响其他订阅者', async () => {
      const good = makeHandler();

      bus.subscribe('agent.event.test', async () => {
        throw new Error('bad handler!');
      });
      bus.subscribe('agent.event.test', good.handler);

      await bus.publish('agent.event.test', { data: 1 } as any);

      // 好的 handler 仍然收到消息
      expect(good.calls).toHaveLength(1);
    });

    it('通配订阅者抛异常不影响其他订阅者', async () => {
      const good = makeHandler();

      bus.subscribePattern('agent.event.*', async () => {
        throw new Error('bad pattern handler!');
      });
      bus.subscribe('agent.event.test', good.handler);

      await bus.publish('agent.event.test', {} as any);

      expect(good.calls).toHaveLength(1);
    });
  });

  // ─── subscriberCount ──────────────────────

  describe('subscriberCount', () => {
    it('返回正确数量', async () => {
      expect(bus.subscriberCount('agent.event.test')).toBe(0);

      const unsub1 = bus.subscribe('agent.event.test', makeHandler().handler);
      expect(bus.subscriberCount('agent.event.test')).toBe(1);

      bus.subscribe('agent.event.test', makeHandler().handler);
      expect(bus.subscriberCount('agent.event.test')).toBe(2);

      const unsub3 = bus.subscribePattern('agent.event.*', makeHandler().handler);
      // 精确 2 + 通配 1 = 3
      expect(bus.subscriberCount('agent.event.test')).toBe(3);

      unsub1();
      expect(bus.subscriberCount('agent.event.test')).toBe(2);

      unsub3();
      expect(bus.subscriberCount('agent.event.test')).toBe(1);
    });
  });
});
