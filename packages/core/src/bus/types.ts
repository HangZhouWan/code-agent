/**
 * 类型化 Event Bus 契约
 */

import type {
  AgentId,
  BusEnvelope,
  BusMeta,
  CommandPayload,
  CommandTopic,
  EventPayload,
  EventTopic,
  RequestOptions,
  SerializedError,
  SessionId,
  TaskResult,
  Unsubscribe,
} from "@code-agent/protocol";

export class BusError extends Error {
  constructor(public readonly serialized: SerializedError) {
    super(serialized.message);
    this.name = "BusError";
  }
}

export type CommandHandler<K extends CommandTopic> = (
  envelope: BusEnvelope<CommandPayload<K>>,
) => TaskResult | Promise<TaskResult>;

export type EventHandler<K extends EventTopic> = (
  envelope: BusEnvelope<EventPayload<K>>,
) => void | Promise<void>;

export type PatternEventHandler = (
  envelope: BusEnvelope<unknown>,
) => void | Promise<void>;

export interface BusOptions {
  sessionId: SessionId;
  clock?: () => string;
  idGenerator?: (prefix: string) => string;
  defaultSenderId?: AgentId;
  defaultTimeoutMs?: number;
  onError?: (error: unknown, envelope?: BusEnvelope<unknown>) => void;
}

export interface EventBus {
  readonly sessionId: SessionId;

  publish<K extends EventTopic>(
    topic: K,
    payload: EventPayload<K>,
    meta?: Partial<BusMeta>,
  ): Promise<void>;

  request<K extends CommandTopic>(
    topic: K,
    payload: CommandPayload<K>,
    options?: RequestOptions,
  ): Promise<TaskResult>;

  subscribe<K extends EventTopic>(
    topic: K,
    handler: EventHandler<K>,
  ): Unsubscribe;

  subscribePattern(pattern: string, handler: PatternEventHandler): Unsubscribe;

  subscribeExclusive<K extends CommandTopic>(
    topic: K,
    group: string,
    handler: CommandHandler<K>,
  ): Unsubscribe;

  readonly pendingCount: number;

  dispose(): void;
}
