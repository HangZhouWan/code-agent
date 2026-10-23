/**
 * Runtime WebSocket 聊天适配器
 *
 * 只做协议解析与事件转发；所有执行由 AgentSession 负责。
 */

import type { FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import {
  asRunId,
  asSessionId,
  parseClientWsMessage,
  serializeError,
  type ServerWsMessage,
  type SessionEvent,
  type EventEnvelope,
} from "@code-agent/protocol";
import { SessionBusyError, type AgentSession } from "@code-agent/runtime";
import type { SessionService } from "../../session/session-service.js";

export interface RuntimeChatOptions {
  sessionService: SessionService;
}

export function createRuntimeChatWebSocket(options: RuntimeChatOptions) {
  return async (socket: WebSocket, request: FastifyRequest): Promise<void> => {
    const sessionId = asSessionId(
      (request.params as { id: string }).id,
    );
    const session: AgentSession =
      await options.sessionService.getOrCreate(sessionId);

    const send = (message: ServerWsMessage): void => {
      try {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify(message));
        }
      } catch {
        // socket closed
      }
    };

    send({
      type: "ready",
      sessionId,
      lastSeq: session.lastSeq,
      planMode: session.planMode,
    });

    let closed = false;
    let resolveClosed!: () => void;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const closeStream = () => {
      if (closed) return;
      closed = true;
      resolveClosed();
    };
    socket.on("close", closeStream);
    socket.on("error", closeStream);

    const iterator = session
      .subscribe({ afterSeq: 0 })
      [Symbol.asyncIterator]();

    void (async () => {
      try {
        while (!closed) {
          const next = await Promise.race([
            iterator.next(),
            closedPromise.then(() => ({ done: true as const })),
          ]);
          if (next.done) break;
          const envelope = next.value as EventEnvelope<SessionEvent>;
          send({ type: "event", event: envelope });
        }
      } finally {
        await iterator.return?.();
      }
    })();

    socket.on("message", (data) => {
      void (async () => {
        try {
          const raw: unknown = JSON.parse(data.toString());
          const message = parseClientWsMessage(raw);

          switch (message.type) {
            case "message":
              await session.run({ content: message.content });
              break;
            case "approval":
              session.approve(message.callId, {
                decision: message.approved ? "approved" : "denied",
                ...(message.selectedProposalIds
                  ? { selectedProposalIds: message.selectedProposalIds }
                  : {}),
                ...(message.feedback !== undefined
                  ? { feedback: message.feedback }
                  : {}),
              });
              break;
            case "plan_mode":
              session.setPlanMode(message.enabled);
              break;
            case "answer":
              session.answer(message.questionId, message.answer);
              break;
            case "abort":
              await session.abort(
                message.runId ? asRunId(message.runId) : undefined,
                message.reason,
              );
              break;
            case "resume":
              await session.resume(asRunId(message.runId));
              break;
          }
        } catch (error) {
          send({
            type: "error",
            error: serializeError(
              error,
              error instanceof SessionBusyError
                ? "SESSION_BUSY"
                : "VALIDATION",
            ),
          });
        }
      })();
    });
  };
}
