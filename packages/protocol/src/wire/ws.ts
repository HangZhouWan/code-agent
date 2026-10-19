/**
 * WebSocket 协议
 *
 * 客户端消息完整校验；服务端事件信封校验到 type 级别，
 * 具体 payload schema 在事件稳定后补齐（Phase 5/10）。
 */

import { z } from "zod";
import type { SessionId } from "../ids.js";
import type { SerializedError } from "../errors.js";
import type { EventEnvelope, SessionEvent } from "../events/session-events.js";
import {
  isoTimestampSchema,
  serializedErrorSchema,
  sessionEventTypeSchema,
} from "./schema.js";

export const clientWsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    content: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("approval"),
    callId: z.string().min(1),
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal("answer"),
    questionId: z.string().min(1),
    answer: z.string(),
  }),
  z.object({
    type: z.literal("abort"),
    runId: z.string().min(1).optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("resume"),
    runId: z.string().min(1),
  }),
]);

export type ClientWsMessage = z.infer<typeof clientWsMessageSchema>;

export const eventEnvelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: isoTimestampSchema,
  event: z.object({ type: sessionEventTypeSchema }).passthrough(),
});

export const serverWsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    sessionId: z.string().min(1),
    lastSeq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("event"),
    event: eventEnvelopeSchema,
  }),
  z.object({
    type: z.literal("error"),
    error: serializedErrorSchema,
  }),
]);

export type ServerWsMessage =
  | { type: "ready"; sessionId: SessionId; lastSeq: number }
  | { type: "event"; event: EventEnvelope<SessionEvent> }
  | { type: "error"; error: SerializedError };
