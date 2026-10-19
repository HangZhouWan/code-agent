/**
 * TitleService —— 首次成功后异步生成会话标题
 */

import { HumanMessage } from "@langchain/core/messages";
import type { ChatModelLike } from "@code-agent/core";
import { extractText } from "@code-agent/core";
import type { SessionEvent, SessionId } from "@code-agent/protocol";
import type { Clock, SessionStore } from "../ports/types.js";

export interface TitleServiceOptions {
  sessionId: SessionId;
  model: ChatModelLike;
  sessions: SessionStore;
  clock: Clock;
  emit: (event: SessionEvent) => void;
}

export class TitleService {
  constructor(private readonly options: TitleServiceOptions) {}

  async maybeGenerate(firstUserMessage: string): Promise<void> {
    try {
      const session = await this.options.sessions.get(this.options.sessionId);
      if (!session) return;
      if (session.title && session.title !== "New Chat") return;

      const response = await this.options.model.invoke([
        new HumanMessage(
          "用 5-15 个中文字生成一个简洁的对话标题，只输出标题本身：\n\n" +
            firstUserMessage.slice(0, 2_000),
        ),
      ]);
      const title = extractText(response).trim();
      if (!title || title.length < 3 || title.length > 50) return;

      await this.options.sessions.updateTitle(
        this.options.sessionId,
        title,
        this.options.clock.now(),
      );
      this.options.emit({
        type: "session.title.updated",
        sessionId: this.options.sessionId,
        title,
      });
    } catch {
      // 标题生成失败不影响 run
    }
  }
}
