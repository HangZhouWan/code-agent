/**
 * createRuntime —— 应用层组合根
 */

import type {
  ChatModelLike,
  HooksEngine,
  MemoryExtractor,
  MemoryService,
  TokenCounterLike,
  ToolDefinition,
} from "@code-agent/core";
import {
  asSessionId,
  asWorkspaceId,
  type SessionId,
  type WorkspaceId,
} from "@code-agent/protocol";
import { RoleRegistry } from "./agents/role-registry.js";
import type { RuntimePorts } from "./ports/types.js";
import { AgentSession } from "./session/agent-session.js";

export interface RuntimeHarness {
  model: ChatModelLike;
  tools?: ToolDefinition[];
  roles?: RoleRegistry;
  hooks?: HooksEngine;
  memory?: MemoryService;
  memoryExtractor?: MemoryExtractor;
  tokenCounter?: TokenCounterLike;
  writeLock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface RuntimeOptions {
  ports: RuntimePorts;
  maxIterations?: number;
  approvalTimeoutMs?: number;
  questionTimeoutMs?: number;
  /** 默认是否启用 LangGraph 编排 */
  orchestration?: boolean;
}

export interface CreateSessionInput {
  sessionId?: SessionId;
  workspaceId?: WorkspaceId;
  workspacePath: string;
  title?: string;
  orchestration?: boolean;
}

export interface RecoveryReport {
  recovered: number;
  skipped: number;
}

export interface Runtime {
  createSession(input: CreateSessionInput): Promise<AgentSession>;
  recoverSessions(options?: {
    owner?: string;
    ttlMs?: number;
  }): Promise<RecoveryReport>;
  dispose(): Promise<void>;
}

export function createRuntime(
  harness: RuntimeHarness,
  options: RuntimeOptions,
): Runtime {
  const sessions = new Set<AgentSession>();

  return {
    async createSession(input) {
      const sessionId =
        input.sessionId ??
        asSessionId(options.ports.ids.next("session"));
      const orchestration =
        input.orchestration ?? options.orchestration;
      const session = await AgentSession.create({
        sessionId,
        workspaceId:
          input.workspaceId ?? asWorkspaceId(input.workspacePath),
        workspacePath: input.workspacePath,
        ports: options.ports,
        model: harness.model,
        ...(harness.tools ? { tools: harness.tools } : {}),
        ...(harness.roles ? { roles: harness.roles } : {}),
        ...(harness.hooks ? { hooks: harness.hooks } : {}),
        ...(harness.memory ? { memory: harness.memory } : {}),
        ...(harness.memoryExtractor
          ? { memoryExtractor: harness.memoryExtractor }
          : {}),
        ...(harness.tokenCounter
          ? { tokenCounter: harness.tokenCounter }
          : {}),
        ...(harness.writeLock ? { writeLock: harness.writeLock } : {}),
        ...(options.maxIterations
          ? { maxIterations: options.maxIterations }
          : {}),
        ...(options.approvalTimeoutMs
          ? { approvalTimeoutMs: options.approvalTimeoutMs }
          : {}),
        ...(options.questionTimeoutMs
          ? { questionTimeoutMs: options.questionTimeoutMs }
          : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(orchestration !== undefined ? { orchestration } : {}),
      });
      sessions.add(session);
      return session;
    },

    async recoverSessions() {
      // Phase 7 实现真正的恢复；当前只报告可恢复数量
      const recoverable = await options.ports.checkpoints.listRecoverable();
      return { recovered: 0, skipped: recoverable.length };
    },

    async dispose() {
      for (const session of sessions) {
        await session.dispose();
      }
      sessions.clear();
    },
  };
}
