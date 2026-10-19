/**
 * LangChain 消息 <-> JSON-safe 消息转换
 */

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { JsonValue, SerializedMessage } from "@code-agent/protocol";

export interface ExtractedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type: string; text?: string } =>
          typeof block === "object" && block !== null && "type" in block,
      )
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("");
  }
  if (content === null || content === undefined) return "";
  return String(content);
}

export function extractText(message: BaseMessage): string {
  return contentToText(message.content);
}

export function extractToolCalls(message: BaseMessage): ExtractedToolCall[] {
  const direct = (message as unknown as {
    tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
  }).tool_calls;

  if (Array.isArray(direct) && direct.length > 0) {
    return direct
      .filter((call) => typeof call.name === "string")
      .map((call, index) => ({
        id: call.id ?? `call-${index}`,
        name: call.name!,
        args:
          typeof call.args === "object" && call.args !== null
            ? (call.args as Record<string, unknown>)
            : {},
      }));
  }

  // OpenAI 风格的 additional_kwargs.tool_calls
  const additional = (message as unknown as {
    additional_kwargs?: {
      tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }).additional_kwargs?.tool_calls;

  if (Array.isArray(additional)) {
    return additional
      .filter((call) => typeof call.function?.name === "string")
      .map((call, index) => {
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(call.function?.arguments ?? "{}");
          if (typeof parsed === "object" && parsed !== null) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          // 保留空 args，交由 schema 校验报错
        }
        return {
          id: call.id ?? `call-${index}`,
          name: call.function!.name!,
          args,
        };
      });
  }

  return [];
}

export function toLangChainMessages(
  messages: SerializedMessage[],
): BaseMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return new SystemMessage({ content: message.content });
      case "human":
        return new HumanMessage({ content: message.content });
      case "ai":
        return new AIMessage({
          content: message.content,
          tool_calls: (message.toolCalls ?? []).map((call) => ({
            id: call.id,
            name: call.name,
            args: call.args as Record<string, unknown>,
          })),
        });
      case "tool":
        return new ToolMessage({
          content: message.content,
          tool_call_id: message.toolCallId ?? "",
        });
    }
  });
}

export function serializeMessages(
  messages: BaseMessage[],
): SerializedMessage[] {
  return messages.map((message, index) => {
    const type = message._getType();
    const base: SerializedMessage = {
      id: message.id ?? `msg-${index}`,
      role:
        type === "system"
          ? "system"
          : type === "human"
            ? "human"
            : type === "tool"
              ? "tool"
              : "ai",
      content: extractText(message),
    };

    if (type === "ai") {
      const toolCalls = extractToolCalls(message);
      if (toolCalls.length > 0) {
        base.toolCalls = toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          args: call.args as JsonValue,
        }));
      }
    }
    if (type === "tool") {
      const toolCallId = (message as ToolMessage).tool_call_id;
      if (toolCallId) base.toolCallId = toolCallId;
    }
    return base;
  });
}
