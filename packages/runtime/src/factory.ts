/**
 * createRuntime —— 应用层组合根
 */

import type {
  ChatModelLike,
  ContextBudget,
  ContextSummarizer,
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
import { RecoveryService } from "./session/recovery-service.js";

export interface RuntimeHarness {
  model: ChatModelLike;
  tools?: ToolDefinition[];
  roles?: RoleRegistry;
  hooks?: HooksEngine;
  memory?: MemoryService;
  memoryExtractor?: MemoryExtractor;
  tokenCounter?: TokenCounterLike;
  contextBudget?: ContextBudget;
  contextSummarizer?: ContextSummarizer;
  inlineToolResultLimit?: number;
  writeLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Auto mode：工作区内 confirm 级工具免审批 */
  autoApprove?: boolean;
  /** 计划模式：先提案后执行 */
  planMode?: boolean;
}

export interface RuntimeOptions {
  ports: RuntimePorts;
  maxIterations?: number;
  approvalTimeoutMs?: number;
  questionTimeoutMs?: number;
  /** 方案确认超时 */
  planApprovalTimeoutMs?: number;
  /** 计划模式任务超时 */
  planModeTimeoutMs?: number;
  /** 计划模式迭代上限 */
  planModeMaxIterations?: number;
  /** 默认是否启用 LangGraph 编排 */
  orchestration?: boolean;
}

export interface CreateSessionInput {
  sessionId?: SessionId;
  workspaceId?: WorkspaceId;
  workspacePath: string;
  title?: string;
  orchestration?: boolean;
  /** 覆盖默认计划模式设置 */
  planMode?: boolean;
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

  const runtime: Runtime = {
    async createSession(input) {
      const sessionId =
        input.sessionId ??
        asSessionId(options.ports.ids.next("session"));
      const orchestration =
        input.orchestration ?? options.orchestration;
      const planMode = input.planMode ?? harness.planMode;
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
        ...(harness.contextBudget
          ? { contextBudget: harness.contextBudget }
          : {}),
        ...(harness.contextSummarizer
          ? { contextSummarizer: harness.contextSummarizer }
          : {}),
        ...(harness.inlineToolResultLimit
          ? { inlineToolResultLimit: harness.inlineToolResultLimit }
          : {}),
        ...(harness.writeLock ? { writeLock: harness.writeLock } : {}),
        ...(harness.autoApprove ? { autoApprove: true } : {}),
        ...(options.maxIterations
          ? { maxIterations: options.maxIterations }
          : {}),
        ...(options.approvalTimeoutMs
          ? { approvalTimeoutMs: options.approvalTimeoutMs }
          : {}),
        ...(options.questionTimeoutMs
          ? { questionTimeoutMs: options.questionTimeoutMs }
          : {}),
        ...(options.planApprovalTimeoutMs
          ? { planApprovalTimeoutMs: options.planApprovalTimeoutMs }
          : {}),
        ...(options.planModeTimeoutMs
          ? { planModeTimeoutMs: options.planModeTimeoutMs }
          : {}),
        ...(options.planModeMaxIterations
          ? { planModeMaxIterations: options.planModeMaxIterations }
          : {}),
        ...(planMode !== undefined ? { planMode } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(orchestration !== undefined ? { orchestration } : {}),
      });
      sessions.add(session);
      return session;
    },

    async recoverSessions(recoveryOptions = {}) {
      const service = new RecoveryService({
        checkpoints: options.ports.checkpoints,
        createSession: (input) =>
          runtime.createSession({
            sessionId: input.sessionId,
            workspacePath: input.workspacePath,
            title: "Recovered",
            orchestration: true,
          }),
      });
      const report = await service.recoverSessions(recoveryOptions);
      return {
        recovered: report.recovered,
        skipped: report.skipped,
      };
    },

    async dispose() {
      for (const session of sessions) {
        await session.dispose();
      }
      sessions.clear();
    },
  };

  return runtime;
}
