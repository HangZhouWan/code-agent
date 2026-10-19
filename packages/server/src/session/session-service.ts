/**
 * SessionService —— 每 sessionId 一个活跃 AgentSession
 */

import type { AgentSession, Runtime } from "@code-agent/runtime";
import type { SessionId } from "@code-agent/protocol";

export class SessionService {
  private readonly sessions = new Map<SessionId, AgentSession>();

  constructor(
    private readonly runtime: Runtime,
    private readonly workspacePath: string,
  ) {}

  async getOrCreate(
    sessionId: SessionId,
    title?: string,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const session = await this.runtime.createSession({
      sessionId,
      workspacePath: this.workspacePath,
      ...(title ? { title } : {}),
      orchestration: true,
    });
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: SessionId): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  async disposeSession(sessionId: SessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    await session.dispose();
  }

  async disposeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.dispose()));
  }
}
