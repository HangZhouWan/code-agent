/**
 * Token 计量
 *
 * - OpenAI / OpenAI-compatible：js-tiktoken cl100k_base
 * - Anthropic：保守字符启发式（CJK 权重更高）
 * - 估算失败时按高估处理
 */

import { getEncoding, type Tiktoken } from "js-tiktoken";
import {
  getDefaultModelWindow,
  type ProviderId,
  type SerializedMessage,
} from "@code-agent/protocol";
import type { TokenCounterLike } from "./types.js";

export interface TokenCounter extends TokenCounterLike {
  readonly modelWindow: number;
}

let tiktoken: Tiktoken | null = null;

function getTiktoken(): Tiktoken {
  tiktoken ??= getEncoding("cl100k_base");
  return tiktoken;
}

function heuristicCount(text: string): number {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    units += code > 0x2e80 ? 1.6 : 0.35;
  }
  return Math.max(1, Math.ceil(units));
}

export class HeuristicTokenCounter implements TokenCounter {
  constructor(readonly modelWindow: number) {}

  count(text: string): number {
    return heuristicCount(text);
  }

  countValue(value: unknown): number {
    try {
      return this.count(JSON.stringify(value) ?? String(value));
    } catch {
      return this.count(String(value));
    }
  }

  countMessage(message: SerializedMessage): number {
    return (
      this.count(message.content) +
      (message.toolCalls
        ? this.countValue(message.toolCalls.map((call) => call.args))
        : 0) +
      4
    );
  }

  countMessages(messages: SerializedMessage[]): number {
    return messages.reduce((sum, message) => sum + this.countMessage(message), 0);
  }
}

export class TiktokenTokenCounter implements TokenCounter {
  constructor(readonly modelWindow: number) {}

  count(text: string): number {
    try {
      return Math.max(1, getTiktoken().encode(text).length);
    } catch {
      return heuristicCount(text);
    }
  }

  countValue(value: unknown): number {
    try {
      return this.count(JSON.stringify(value) ?? String(value));
    } catch {
      return heuristicCount(String(value));
    }
  }

  countMessage(message: SerializedMessage): number {
    return (
      this.count(message.content) +
      (message.toolCalls
        ? this.countValue(message.toolCalls.map((call) => call.args))
        : 0) +
      4
    );
  }

  countMessages(messages: SerializedMessage[]): number {
    return messages.reduce((sum, message) => sum + this.countMessage(message), 0);
  }
}

export function createTokenCounter(options: {
  provider: ProviderId;
  model?: string;
  modelWindow?: number;
}): TokenCounter {
  const modelWindow = options.modelWindow ?? getDefaultModelWindow(options.provider);
  if (options.provider === "anthropic") {
    return new HeuristicTokenCounter(modelWindow);
  }
  return new TiktokenTokenCounter(modelWindow);
}

/** 仅用于测试/无 provider 信息的场景 */
export function createHeuristicTokenCounter(modelWindow = 128_000): TokenCounter {
  return new HeuristicTokenCounter(modelWindow);
}
