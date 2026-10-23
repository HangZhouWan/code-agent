/**
 * Event Bus 信封与订阅类型
 */

import type { AgentId, RunId, SessionId, TaskId } from "../ids.js";
import type { IsoTimestamp, JsonValue } from "../json.js";

export interface BusMeta {
  sessionId: SessionId;
  runId: RunId;
  taskId?: TaskId;
  senderId: AgentId;
  timestamp: IsoTimestamp;
  schemaVersion: 1;
  correlationId?: string;
}

export interface BusEnvelope<T = JsonValue> {
  id: string;
  topic: string;
  payload: T;
  meta: BusMeta;
}

export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  metadata?: Partial<BusMeta>;
}

export type Unsubscribe = () => void;

export type BusHandler<T> = (envelope: BusEnvelope<T>) => void | Promise<void>;
