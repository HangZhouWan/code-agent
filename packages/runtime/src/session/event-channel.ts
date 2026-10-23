/**
 * 每会话事件通道
 *
 * - 维护 seq 与内存历史，支持 afterSeq 回放
 * - 语义事件持久化到 EventLog；message.delta 不持久化
 * - 慢消费者只影响自己的迭代器，不阻塞 run
 */

import type {
  EventEnvelope,
  RunId,
  SessionEvent,
  SessionId,
} from "@code-agent/protocol";
import type { Clock, EventLog, IdGenerator } from "../ports/types.js";

export interface EventChannelOptions {
  sessionId: SessionId;
  events: EventLog;
  clock: Clock;
  ids: IdGenerator;
}

export class EventChannel {
  private readonly history: EventEnvelope<SessionEvent>[] = [];
  private waiters: Array<() => void> = [];
  private seq = 0;
  private closed = false;

  private constructor(private readonly options: EventChannelOptions) {}

  static async create(options: EventChannelOptions): Promise<EventChannel> {
    const channel = new EventChannel(options);
    const history = await options.events.since(options.sessionId, 0);
    channel.history.push(...history);
    channel.seq = history.reduce(
      (max, event) => Math.max(max, event.seq),
      0,
    );
    return channel;
  }

  get lastSeq(): number {
    return this.seq;
  }

  emit(runId: RunId, event: SessionEvent): void {
    if (this.closed) return;
    const envelope: EventEnvelope<SessionEvent> = {
      v: 1,
      id: this.options.ids.next("evt"),
      sessionId: this.options.sessionId,
      runId,
      seq: ++this.seq,
      ts: this.options.clock.now(),
      event,
    };
    this.history.push(envelope);

    // token delta 不入事件日志，避免 SQLite/文件膨胀
    if (event.type !== "message.delta") {
      void this.options.events.append(envelope).catch((error) => {
        console.error("[event-channel] failed to persist event", error);
      });
    }

    this.notify();
  }

  async *subscribe(
    afterSeq = 0,
  ): AsyncIterable<EventEnvelope<SessionEvent>> {
    let index = this.history.findIndex((event) => event.seq > afterSeq);
    if (index === -1) index = this.history.length;

    while (true) {
      while (index < this.history.length) {
        yield this.history[index++];
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
