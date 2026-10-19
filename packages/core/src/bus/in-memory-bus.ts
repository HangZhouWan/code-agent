/**
 * 进程内类型化 Event Bus
 *
 * - Event：广播，fire-and-forget
 * - Command：按 role group 独占投递（round-robin）
 * - request 在 handler 返回 TaskResult 时 resolve；抛错/超时/abort 时 reject
 */

import {
  asAgentId,
  asRunId,
  abortError,
  serializeError,
  type BusEnvelope,
  type BusMeta,
  type CommandPayload,
  type CommandTopic,
  type EventPayload,
  type EventTopic,
  type RequestOptions,
  type SerializedError,
  type SessionId,
  type TaskResult,
  type Unsubscribe,
} from "@code-agent/protocol";
import {
  BusError,
  type BusOptions,
  type CommandHandler,
  type EventBus,
  type EventHandler,
  type PatternEventHandler,
} from "./types.js";

interface PendingRequest {
  resolve: (result: TaskResult) => void;
  reject: (error: BusError) => void;
  timer: ReturnType<typeof setTimeout>;
  abort?: () => void;
}

interface CommandGroup {
  handlers: Array<CommandHandler<CommandTopic>>;
  next: number;
}

interface PatternSubscription {
  regex: RegExp;
  handler: PatternEventHandler;
}

type AnyEventHandler = (
  envelope: BusEnvelope<unknown>,
) => void | Promise<void>;

function defaultId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function patternToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        out += ".*";
      } else {
        out += "[^.]*";
      }
    } else {
      out += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${out}$`);
}

export class SessionEventBus implements EventBus {
  readonly sessionId: SessionId;

  private readonly clock: () => string;
  private readonly idGenerator: (prefix: string) => string;
  private readonly defaultSenderId;
  private readonly defaultTimeoutMs: number;
  private readonly onError: (error: unknown, envelope?: BusEnvelope<unknown>) => void;

  private readonly eventHandlers = new Map<string, Set<AnyEventHandler>>();
  private readonly patternHandlers: PatternSubscription[] = [];
  private readonly groups = new Map<string, CommandGroup>();
  private readonly pending = new Map<string, PendingRequest>();
  private disposed = false;

  constructor(options: BusOptions) {
    this.sessionId = options.sessionId;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idGenerator = options.idGenerator ?? defaultId;
    this.defaultSenderId = options.defaultSenderId ?? asAgentId("bus");
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.onError =
      options.onError ??
      ((error) => {
        console.error("[event-bus] handler failed", error);
      });
  }

  private makeEnvelope<T>(
    topic: string,
    payload: T,
    meta?: Partial<BusMeta>,
    correlationId?: string,
  ): BusEnvelope<T> {
    if (meta?.sessionId && meta.sessionId !== this.sessionId) {
      throw new BusError(
        serializeError(
          new Error(
            `Bus session mismatch: ${meta.sessionId} !== ${this.sessionId}`,
          ),
          "VALIDATION",
        ),
      );
    }

    const id = this.idGenerator("bus");
    return {
      id,
      topic,
      payload,
      meta: {
        sessionId: this.sessionId,
        runId: meta?.runId ?? asRunId(""),
        ...(meta?.taskId ? { taskId: meta.taskId } : {}),
        senderId: meta?.senderId ?? this.defaultSenderId,
        timestamp: this.clock(),
        schemaVersion: 1,
        correlationId: meta?.correlationId ?? correlationId ?? id,
      },
    };
  }

  async publish<K extends EventTopic>(
    topic: K,
    payload: EventPayload<K>,
    meta?: Partial<BusMeta>,
  ): Promise<void> {
    if (this.disposed) {
      throw new BusError(abortError("Event bus disposed"));
    }
    const envelope = this.makeEnvelope(topic, payload, meta);
    const handlers: Array<(message: BusEnvelope<unknown>) => void | Promise<void>> = [
      ...(this.eventHandlers.get(topic) ?? []),
    ];
    for (const subscription of this.patternHandlers) {
      if (subscription.regex.test(topic)) {
        handlers.push(subscription.handler);
      }
    }

    for (const handler of handlers) {
      Promise.resolve()
        .then(() => handler(envelope))
        .catch((error) => this.onError(error, envelope));
    }
    // 不等待 handler，避免慢订阅者阻塞发布者
    return Promise.resolve();
  }

  async request<K extends CommandTopic>(
    topic: K,
    payload: CommandPayload<K>,
    options: RequestOptions = {},
  ): Promise<TaskResult> {
    if (this.disposed) {
      throw new BusError(abortError("Event bus disposed"));
    }
    if (options.signal?.aborted) {
      throw new BusError(abortError("Bus request aborted"));
    }

    const group = this.groups.get(topic);
    if (!group || group.handlers.length === 0) {
      throw new BusError(
        serializeError(
          new Error(`No subscriber for command topic: ${topic}`),
          "BUS_NO_SUBSCRIBER",
        ),
      );
    }

    const envelope = this.makeEnvelope(
      topic,
      payload,
      options.metadata,
    );
    const correlationId = envelope.meta.correlationId!;
    const handler =
      group.handlers[group.next % group.handlers.length];
    group.next = (group.next + 1) % group.handlers.length;

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<TaskResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(
          new BusError(
            serializeError(
              new Error(`Bus request timed out after ${timeoutMs}ms: ${topic}`),
              "BUS_TIMEOUT",
            ),
          ),
        );
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        reject(new BusError(abortError("Bus request aborted")));
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(correlationId, { resolve, reject, timer, abort: onAbort });

      Promise.resolve()
        .then(() => handler(envelope))
        .then((result) => this.settle(correlationId, result))
        .catch((error) =>
          this.settleError(
            correlationId,
            serializeError(
              error,
              error instanceof BusError ? error.serialized.code : "TOOL_FAILED",
            ),
          ),
        );
    });
  }

  subscribe<K extends EventTopic>(
    topic: K,
    handler: EventHandler<K>,
  ): Unsubscribe {
    const eventHandler = handler as unknown as AnyEventHandler;
    let set = this.eventHandlers.get(topic);
    if (!set) {
      set = new Set();
      this.eventHandlers.set(topic, set);
    }
    set.add(eventHandler);
    return () => {
      set?.delete(eventHandler);
    };
  }

  subscribePattern(pattern: string, handler: PatternEventHandler): Unsubscribe {
    const subscription: PatternSubscription = {
      regex: patternToRegExp(pattern),
      handler,
    };
    this.patternHandlers.push(subscription);
    return () => {
      const index = this.patternHandlers.indexOf(subscription);
      if (index !== -1) this.patternHandlers.splice(index, 1);
    };
  }

  subscribeExclusive<K extends CommandTopic>(
    topic: K,
    _group: string,
    handler: CommandHandler<K>,
  ): Unsubscribe {
    const key = topic;
    let group = this.groups.get(key);
    if (!group) {
      group = { handlers: [], next: 0 };
      this.groups.set(key, group);
    }
    const commandHandler = handler as unknown as CommandHandler<CommandTopic>;
    group.handlers.push(commandHandler);

    return () => {
      const index = group!.handlers.indexOf(commandHandler);
      if (index !== -1) group!.handlers.splice(index, 1);
      if (group!.handlers.length === 0) this.groups.delete(key);
    };
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const [correlationId, request] of this.pending) {
      clearTimeout(request.timer);
      if (request.abort) {
        request.abort();
      }
      request.reject(new BusError(abortError("Event bus disposed")));
      this.pending.delete(correlationId);
    }
  }

  private settle(correlationId: string, result: TaskResult): void {
    const request = this.pending.get(correlationId);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(correlationId);
    request.resolve(result);
  }

  private settleError(
    correlationId: string,
    error: SerializedError,
  ): void {
    const request = this.pending.get(correlationId);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(correlationId);
    request.reject(new BusError(error));
  }
}
