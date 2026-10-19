/**
 * Wire 消息解析入口
 *
 * 服务端和 Web 都必须经过这里，不允许裸 cast。
 */

import {
  clientWsMessageSchema,
  serverWsMessageSchema,
  type ClientWsMessage,
  type ServerWsMessage,
} from "./ws.js";

export function parseClientWsMessage(raw: unknown): ClientWsMessage {
  return clientWsMessageSchema.parse(raw);
}

export function safeParseClientWsMessage(raw: unknown) {
  return clientWsMessageSchema.safeParse(raw);
}

/**
 * 服务端消息在 schema 层校验到事件 type；
 * payload 的完整 schema 在事件稳定后补齐，因此这里做一次受控 cast。
 */
export function parseServerWsMessage(raw: unknown): ServerWsMessage {
  return serverWsMessageSchema.parse(raw) as ServerWsMessage;
}

export function safeParseServerWsMessage(raw: unknown) {
  return serverWsMessageSchema.safeParse(raw);
}
