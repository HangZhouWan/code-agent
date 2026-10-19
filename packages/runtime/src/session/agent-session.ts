/**
 * AgentSession —— 传输无关的会话运行时
 *
 * 当前阶段使用单 Code 任务作为纵向切片；Phase 6 会替换为 LangGraph 编排。
 */

import {
  AgentExecutionEngine,
  SessionEventBus,
  SessionStateManager,
  createBuiltinTools,
  createCollaborationTools,
  createMemoryTools,
  type ChatModelLike,
  type CollaborationToolService,
  type HooksEngine,
  type MemoryExtractor,
  type MemoryService,
  type MemoryToolService,
  type SessionNode,
  type TokenCounterLike,
  type ToolDefinition,
  type RunScope,
} from "@code-agent/core";
import {
  abortError,
  agentCommandTopic,
  asCallId,
  asQuestionId,
  asRunId,
  asTaskId,
  serializeError,
  type ApprovalDecision,
  type ChatMessage,
  type EventEnvelope,
  type JsonValue,
  type RunId,
  type RunResult,
  type SessionEvent,
  type SessionId,
  type SessionSnapshot,
  type TaskId,
  type TaskRecord,
  type TaskResult,
  type UserTurnInput,
  type WorkspaceId,
} from "@code-agent/protocol";
import { ApprovalService } from "../approval/approval-service.js";
import { AgentPool } from "../agents/agent-pool.js";
import { DelegationService } from "../agents/delegation-service.js";
import { RoleRegistry } from "../agents/role-registry.js";
import { BusDispatcher } from "../dispatch/bus-dispatcher.js";
import { DirectDispatcher } from "../dispatch/direct-dispatcher.js";
import { RoutingDispatcher } from "../dispatch/routing-dispatcher.js";
import { SessionOrchestrator } from "../orchestrator/orchestrator.js";
import type { RuntimePorts } from "../ports/types.js";
import { EventChannel } from "./event-channel.js";
import { PlanState } from "./plan-state.js";
import { TitleService } from "./title-service.js";
import { UserQuestionService } from "./user-question-service.js";

export class SessionBusyError extends Error {
  constructor(public readonly sessionId: SessionId) {
    super(`Session ${sessionId} already has an active run`);
    this.name = "SessionBusyError";
  }
}

export type SessionResumeErrorCode =
  | "NOT_FOUND"
  | "INCOMPATIBLE"
  | "PENDING_INTERACTIONS"
  | "FINISHED";

export class SessionResumeError extends Error {
  constructor(
    message: string,
    public readonly code: SessionResumeErrorCode,
  ) {
    super(message);
    this.name = "SessionResumeError";
  }
}

export interface AgentSessionOptions {
  sessionId: SessionId;
  workspaceId: WorkspaceId;
  workspacePath: string;
  ports: RuntimePorts;
  model: ChatModelLike;
  tools?: ToolDefinition[];
  roles?: RoleRegistry;
  hooks?: HooksEngine;
  memory?: MemoryService;
  memoryExtractor?: MemoryExtractor;
  tokenCounter?: TokenCounterLike;
  writeLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  maxIterations?: number;
  approvalTimeoutMs?: number;
  questionTimeoutMs?: number;
  title?: string;
  /** 使用 LangGraph 编排；false 时使用单 Code 任务纵向切片 */
  orchestration?: boolean;
}

export interface RunOptions {
  signal?: AbortSignal;
}

export interface RunHandle {
  runId: RunId;
  events: AsyncIterable<EventEnvelope<SessionEvent>>;
  done: Promise<RunResult>;
  abort(reason?: string): void;
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

export class AgentSession {
  readonly id: SessionId;

  private readonly ports: RuntimePorts;
  private readonly roles: RoleRegistry;
  private readonly state: SessionStateManager;
  private readonly eventChannel: EventChannel;
  private readonly approvalService: ApprovalService;
  private readonly questionService: UserQuestionService;
  private readonly delegationService: DelegationService;
  private readonly planState = new PlanState();
  private readonly titleService: TitleService;
  private readonly pool: AgentPool;
  private readonly bus: SessionEventBus;
  private readonly routingDispatcher: RoutingDispatcher;
  private readonly orchestration: boolean;
  private readonly memory?: MemoryService;
  private readonly memoryExtractor?: MemoryExtractor;
  private readonly writeLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  private readonly maxIterations?: number;
  private activeRunId: RunId | null = null;
  private activeController: AbortController | null = null;

  private constructor(
    private readonly options: AgentSessionOptions,
    eventChannel: EventChannel,
  ) {
    this.id = options.sessionId;
    this.ports = options.ports;
    this.roles = options.roles ?? new RoleRegistry();
    this.memory = options.memory;
    this.memoryExtractor = options.memoryExtractor;
    this.writeLock = options.writeLock;
    this.maxIterations = options.maxIterations;
    this.eventChannel = eventChannel;
    this.state = new SessionStateManager(options.sessionId, () =>
      options.ports.clock.now(),
    );

    this.approvalService = new ApprovalService({
      sessionId: options.sessionId,
      clock: options.ports.clock,
      ids: options.ports.ids,
      emit: (event) => this.emitEvent(event),
      ...(options.approvalTimeoutMs
        ? { timeoutMs: options.approvalTimeoutMs }
        : {}),
    });
    this.questionService = new UserQuestionService({
      sessionId: options.sessionId,
      clock: options.ports.clock,
      ids: options.ports.ids,
      emit: (event) => this.emitEvent(event),
      ...(options.questionTimeoutMs
        ? { timeoutMs: options.questionTimeoutMs }
        : {}),
    });

    const engine = new AgentExecutionEngine(options.model, {
      checkpoints: {
        save: (checkpoint) =>
          options.ports.checkpoints.saveAgent(checkpoint),
      },
      ...(options.hooks ? { hooks: options.hooks } : {}),
      ...(options.tokenCounter ? { tokenCounter: options.tokenCounter } : {}),
      onCheckpointError: (error) => {
        console.error("[agent-session] checkpoint save failed", error);
      },
    });

    const baseTools = options.tools ?? createBuiltinTools();
    this.pool = new AgentPool({
      engine,
      roles: this.roles,
      tools: baseTools,
      workspacePath: options.workspacePath,
    });
    this.delegationService = new DelegationService({
      roles: this.roles,
      pool: this.pool,
      state: this.state,
      ids: options.ports.ids,
      clock: options.ports.clock,
    });

    const extraTools: ToolDefinition[] = [];
    if (this.memory) {
      const memoryToolService: MemoryToolService = {
        search: async (query, searchOptions) => {
          const records = await this.memory!.search({
            query,
            topK: searchOptions?.topK,
            ...(searchOptions?.scope ? { scope: searchOptions.scope } : {}),
          });
          return records.map((record) => ({
            id: record.id,
            content: record.content,
            kind: record.kind,
            scope: record.scope,
            confidence: record.confidence,
          }));
        },
        store: async (input) => {
          const stored = await this.memory!.store(input);
          return {
            id: stored.record.id,
            status:
              stored.record.status === "pending_review"
                ? "pending_review"
                : "active",
          };
        },
      };
      extraTools.push(...createMemoryTools(memoryToolService));
    }

    const collaborationService: CollaborationToolService = {
      delegate: (input, ctx) =>
        this.delegationService.delegate(input, ctx),
      updatePlan: async (tasks) => {
        const plan = this.planState.update(tasks);
        this.emitEvent({ type: "plan.updated", plan });
      },
      askUser: async (input, ctx) => {
        const runId = ctx?.runId ? asRunId(ctx.runId) : this.activeRunId;
        const taskId = ctx?.taskId ? asTaskId(ctx.taskId) : undefined;
        if (!runId || !taskId) {
          throw new Error("ask_user requires an active run/task");
        }
        return this.questionService.request({
          runId,
          taskId,
          question: input.question,
          ...(input.options ? { options: input.options } : {}),
          allowFreeText: input.allowFreeText,
        });
      },
    };
    extraTools.push(...createCollaborationTools(collaborationService));
    this.pool.registerTools(extraTools);

    this.orchestration = options.orchestration ?? true;
    this.bus = new SessionEventBus({
      sessionId: options.sessionId,
      clock: () => options.ports.clock.now(),
      idGenerator: (prefix) => options.ports.ids.next(prefix),
      onError: (error) => {
        console.error("[agent-session] bus handler failed", error);
      },
    });

    for (const role of this.roles.list()) {
      this.bus.subscribeExclusive(
        agentCommandTopic(role.id),
        role.id,
        async (envelope) => {
          const payload = envelope.payload;
          const memory = await this.retrieveMemory(
            payload.task.description,
          );
          const scope = this.buildTaskScope(
            payload.runId,
            payload.taskId,
            role.id,
          );
          return this.pool.invoke(
            role.id,
            {
              taskId: payload.taskId,
              description: payload.task.description,
              context: payload.context,
              ...(memory ? { memory } : {}),
            },
            scope,
          );
        },
      );
    }

    this.routingDispatcher = new RoutingDispatcher(
      new DirectDispatcher(this.pool),
      new BusDispatcher(this.bus),
    );

    this.titleService = new TitleService({
      sessionId: options.sessionId,
      model: options.model,
      sessions: options.ports.sessions,
      clock: options.ports.clock,
      emit: (event) => this.emitEvent(event),
    });
  }

  get busy(): boolean {
    return this.activeRunId !== null;
  }

  static async create(options: AgentSessionOptions): Promise<AgentSession> {
    const eventChannel = await EventChannel.create({
      sessionId: options.sessionId,
      events: options.ports.events,
      clock: options.ports.clock,
      ids: options.ports.ids,
    });
    const session = new AgentSession(options, eventChannel);
    await options.ports.sessions.create({
      id: options.sessionId,
      ...(options.title ? { title: options.title } : {}),
      createdAt: options.ports.clock.now(),
    });
    return session;
  }

  async run(
    input: UserTurnInput,
    options: RunOptions = {},
  ): Promise<RunHandle> {
    if (this.activeRunId) {
      throw new SessionBusyError(this.id);
    }

    const runId = asRunId(this.ports.ids.next("run"));
    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else {
        options.signal.addEventListener(
          "abort",
          () => controller.abort(options.signal!.reason),
          { once: true },
        );
      }
    }

    this.activeRunId = runId;
    this.activeController = controller;
    this.delegationService.reset();
    this.planState.clear();

    await this.ports.runs.createRun({
      id: runId,
      sessionId: this.id,
      status: "running",
      startedAt: this.ports.clock.now(),
      node: "dispatcher",
    });
    await this.appendMessage("user", input.content);
    this.emitEvent({
      type: "run.started",
      input,
      resumed: false,
    });

    const execution = this.orchestration
      ? this.executeOrchestrated(runId, input, controller)
      : this.executeDirect(runId, input, controller);
    const done = execution.finally(() => {
      if (this.activeRunId === runId) {
        this.activeRunId = null;
        this.activeController = null;
      }
    });

    return {
      runId,
      events: this.filterRun(runId, this.eventChannel.subscribe(0)),
      done,
      abort: (reason?: string) => {
        if (this.activeRunId === runId) {
          controller.abort(reason);
        }
      },
    };
  }

  async resume(
    runId?: RunId,
    options: RunOptions = {},
  ): Promise<RunHandle> {
    if (this.activeRunId) throw new SessionBusyError(this.id);

    const checkpoint =
      await this.ports.checkpoints.loadLatestSession(this.id);
    if (!checkpoint) {
      throw new SessionResumeError(
        `No checkpoint for session ${this.id}`,
        "NOT_FOUND",
      );
    }
    if (checkpoint.v !== 1) {
      throw new SessionResumeError(
        `Incompatible checkpoint version: ${String(checkpoint.v)}`,
        "INCOMPATIBLE",
      );
    }
    if (runId && checkpoint.runId !== runId) {
      throw new SessionResumeError(
        `Run ${runId} not found in checkpoint`,
        "NOT_FOUND",
      );
    }
    if (
      checkpoint.status === "completed" ||
      checkpoint.status === "aborted"
    ) {
      throw new SessionResumeError(
        `Run ${checkpoint.runId} already finished (${checkpoint.status})`,
        "FINISHED",
      );
    }
    if (
      checkpoint.pendingApprovals.length > 0 ||
      (checkpoint.pendingQuestions?.length ?? 0) > 0
    ) {
      throw new SessionResumeError(
        "Pending approvals/questions must be resolved before resuming",
        "PENDING_INTERACTIONS",
      );
    }

    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else {
        options.signal.addEventListener(
          "abort",
          () => controller.abort(options.signal!.reason),
          { once: true },
        );
      }
    }

    this.activeRunId = checkpoint.runId;
    this.activeController = controller;
    this.delegationService.reset();
    this.planState.clear();
    this.state.hydrate(checkpoint.tasks, checkpoint.artifacts);

    const results: TaskResult[] = checkpoint.tasks
      .filter((task) => task.result)
      .map((task) => task.result!);

    // 副作用策略：已开始 mutating 工具但结果未知的任务不盲目重放
    for (const task of checkpoint.tasks) {
      if (task.result) continue;
      if (
        !["assigned", "running", "awaiting_approval", "awaiting_input"].includes(
          task.status,
        )
      ) {
        continue;
      }

      let agentCheckpoint = null;
      try {
        agentCheckpoint = await this.ports.checkpoints.loadAgent(
          this.id,
          checkpoint.runId,
          task.id,
        );
      } catch (error) {
        throw new SessionResumeError(
          error instanceof Error ? error.message : String(error),
          "INCOMPATIBLE",
        );
      }

      if (agentCheckpoint?.pendingTool?.sideEffect === "mutating") {
        const uncertain: TaskResult = {
          taskId: task.id,
          role: task.role,
          status: "failed",
          summary: "Resume side effect uncertain",
          error: {
            code: "RESUME_SIDE_EFFECT_UNCERTAIN",
            message:
              "A mutating tool may have executed before interruption; manual review is required",
            retryable: false,
          },
        };
        this.state.tasks.setResult(task.id, uncertain);
        try {
          this.state.tasks.transition(task.id, "replan_needed");
        } catch {
          try {
            this.state.tasks.transition(task.id, "failed");
          } catch {
            // ignore
          }
        }
        await this.persistTask(task.id);
        results.push(uncertain);
      }
    }

    const resumeNode: SessionNode =
      checkpoint.tasks.length === 0
        ? "planner"
        : checkpoint.node === "finalizer"
          ? "finalizer"
          : checkpoint.node === "replanner"
            ? "replanner"
            : "dispatcher";

    const existingRun = await this.ports.runs.getRun(checkpoint.runId);
    if (existingRun) {
      await this.ports.runs.updateRun(checkpoint.runId, {
        status: "running",
        node: resumeNode,
      });
    } else {
      await this.ports.runs.createRun({
        id: checkpoint.runId,
        sessionId: this.id,
        status: "running",
        startedAt: this.ports.clock.now(),
        node: resumeNode,
      });
    }

    const lastUser =
      [...checkpoint.messages]
        .reverse()
        .find((message) => message.role === "user")?.content ?? "";
    const input: UserTurnInput = { content: lastUser };
    this.emitEvent({ type: "run.started", input, resumed: true });

    const execution = this.executeOrchestrated(
      checkpoint.runId,
      input,
      controller,
      {
        resumeNode,
        tasks: checkpoint.tasks,
        results,
      },
    );
    const done = execution.finally(() => {
      if (this.activeRunId === checkpoint.runId) {
        this.activeRunId = null;
        this.activeController = null;
      }
    });

    return {
      runId: checkpoint.runId,
      events: this.filterRun(
        checkpoint.runId,
        this.eventChannel.subscribe(0),
      ),
      done,
      abort: (reason?: string) => {
        if (this.activeRunId === checkpoint.runId) {
          controller.abort(reason);
        }
      },
    };
  }

  subscribe(
    options: { afterSeq?: number } = {},
  ): AsyncIterable<EventEnvelope<SessionEvent>> {
    return this.eventChannel.subscribe(options.afterSeq ?? 0);
  }

  approve(callId: string, decision: ApprovalDecision): boolean {
    return this.approvalService.resolve(asCallId(callId), decision);
  }

  answer(questionId: string, answer: string): boolean {
    return this.questionService.answer(asQuestionId(questionId), answer);
  }

  async abort(runId?: RunId, reason = "aborted by user"): Promise<void> {
    if (runId && runId !== this.activeRunId) return;
    if (!this.activeRunId) return;
    this.approvalService.cancelRun(this.activeRunId, reason);
    this.questionService.cancelRun(this.activeRunId, reason);
    this.activeController?.abort(reason);
  }

  async snapshot(): Promise<SessionSnapshot> {
    const session = await this.ports.sessions.get(this.id);
    if (!session) throw new Error(`Session not found: ${this.id}`);
    const activeRun = await this.ports.runs.getActiveRun(this.id);
    return {
      session,
      ...(activeRun ? { activeRun } : {}),
      tasks: this.state.tasks.snapshot(),
      messages: await this.ports.sessions.listMessages(this.id),
      agents: this.state.getAgentActivity(),
    };
  }

  async dispose(): Promise<void> {
    if (this.activeRunId) {
      await this.abort(this.activeRunId, "session disposed");
    }
    this.approvalService.dispose();
    this.questionService.dispose();
    this.eventChannel.close();
  }

  private makeApprovalHandler(
    runId: RunId,
    fallbackTaskId: TaskId,
  ): NonNullable<RunScope["requestApproval"]> {
    return async (request) => {
      const taskId = request.taskId
        ? asTaskId(request.taskId)
        : fallbackTaskId;
      const decision = await this.approvalService.request({
        runId,
        taskId,
        toolName: request.toolName,
        args: toJsonValue(request.args),
        ...(request.reason ? { reason: request.reason } : {}),
      });
      return decision === "approved";
    };
  }

  private buildBaseScope(runId: RunId, fallbackTaskId: TaskId): RunScope {
    return {
      sessionId: this.id,
      runId,
      taskId: fallbackTaskId,
      signal:
        this.activeController?.signal ?? new AbortController().signal,
      emit: (event) => this.emitEvent(event),
      requestApproval: this.makeApprovalHandler(runId, fallbackTaskId),
      ...(this.writeLock ? { withWriteLock: this.writeLock } : {}),
      delegation: { depth: 0, maxDepth: 2 },
    };
  }

  private buildTaskScope(
    runId: RunId,
    taskId: TaskId,
    roleId: string,
  ): RunScope {
    const role = this.roles.require(roleId);
    return {
      sessionId: this.id,
      runId,
      taskId,
      signal:
        this.activeController?.signal ?? new AbortController().signal,
      emit: (event) => this.emitEvent(event),
      requestApproval: this.makeApprovalHandler(runId, taskId),
      ...(this.writeLock ? { withWriteLock: this.writeLock } : {}),
      delegation: {
        depth: 1,
        maxDepth: 2,
        allowedRoles: role.delegatableRoles,
      },
    };
  }

  private async executeOrchestrated(
    runId: RunId,
    input: UserTurnInput,
    controller: AbortController,
    resume?: {
      resumeNode?: SessionNode;
      tasks?: TaskRecord[];
      results?: TaskResult[];
    },
  ): Promise<RunResult> {
    let runResults: TaskResult[] = resume?.results ?? [];
    try {
      const memoryText = await this.retrieveMemory(input.content);
      await this.saveSessionCheckpoint(
        runId,
        "running",
        resume?.resumeNode ?? "planner",
      );

      const baseScope = this.buildBaseScope(runId, asTaskId(runId));
      const orchestrator = new SessionOrchestrator({
        model: this.options.model,
        roles: this.roles,
        ids: this.ports.ids,
        clock: this.ports.clock,
        state: this.state,
        dispatcher: this.routingDispatcher,
        persistTask: (taskId) => this.persistTask(taskId),
        emit: (event) => this.emitEvent(event),
      });

      const outcome = await orchestrator.run({
        runId,
        sessionId: this.id,
        userMessage: input.content,
        ...(memoryText ? { memory: memoryText } : {}),
        scope: baseScope,
        ...(resume?.resumeNode ? { resumeNode: resume.resumeNode } : {}),
        ...(resume?.tasks ? { tasks: resume.tasks } : {}),
        ...(resume?.results ? { results: resume.results } : {}),
      });
      runResults = outcome.results;

      if (outcome.finalResponse) {
        const assistant = await this.appendMessage(
          "assistant",
          outcome.finalResponse,
        );
        this.emitEvent({ type: "message.completed", message: assistant });
      }

      await this.saveSessionCheckpoint(
        runId,
        "completed",
        "finalizer",
        runResults,
      );
      try {
        await this.ports.checkpoints.purgeRun(this.id, runId);
      } catch {
        // 清理失败不影响已完成 run
      }

      const result: RunResult = {
        runId,
        sessionId: this.id,
        status: "completed",
        ...(outcome.finalResponse
          ? { finalResponse: outcome.finalResponse }
          : {}),
        taskResults: runResults,
      };
      await this.ports.runs.updateRun(runId, {
        status: "completed",
        finishedAt: this.ports.clock.now(),
      });
      this.emitEvent({ type: "run.completed", result });

      void this.titleService.maybeGenerate(input.content);
      void this.extractMemoryFromResults(
        runId,
        input.content,
        runResults,
      );
      return result;
    } catch (error) {
      const aborted = controller.signal.aborted;
      const serialized = aborted
        ? abortError(String(controller.signal.reason ?? "aborted"))
        : serializeError(error, "INTERNAL");

      const result: RunResult = {
        runId,
        sessionId: this.id,
        status: aborted ? "aborted" : "failed",
        taskResults: runResults,
        error: serialized,
      };
      await this.ports.runs.updateRun(runId, {
        status: aborted ? "aborted" : "failed",
        finishedAt: this.ports.clock.now(),
      });
      if (aborted) {
        this.emitEvent({ type: "run.aborted", reason: serialized.message });
      } else {
        this.emitEvent({ type: "run.failed", error: serialized });
      }
      try {
        await this.saveSessionCheckpoint(
          runId,
          aborted ? "aborted" : "failed",
          "finalizer",
        );
      } catch {
        // 保留原错误
      }
      return result;
    } finally {
      this.approvalService.cancelRun(runId, "run finished");
      this.questionService.cancelRun(runId, "run finished");
    }
  }

  private async executeDirect(
    runId: RunId,
    input: UserTurnInput,
    controller: AbortController,
  ): Promise<RunResult> {
    let taskId: TaskId | undefined;
    let taskResult: TaskResult | undefined;

    try {
      const memoryText = await this.retrieveMemory(input.content);

      taskId = asTaskId(this.ports.ids.next("task"));
      this.state.tasks.create({
        id: taskId,
        runId,
        role: "code",
        description: input.content,
      });
      this.state.tasks.transition(taskId, "assigned");
      this.state.tasks.transition(taskId, "running");
      await this.persistTask(taskId);
      this.emitEvent({
        type: "task.status",
        taskId,
        roleId: "code",
        status: "running",
      });
      await this.saveSessionCheckpoint(runId, "running", "dispatcher");

      const scope: RunScope = {
        sessionId: this.id,
        runId,
        taskId,
        signal: controller.signal,
        emit: (event) => this.emitEvent(event),
        requestApproval: async (request) => {
          if (!taskId) return false;
          const decision = await this.approvalService.request({
            runId,
            taskId,
            toolName: request.toolName,
            args: toJsonValue(request.args),
            ...(request.reason ? { reason: request.reason } : {}),
          });
          return decision === "approved";
        },
        ...(this.writeLock ? { withWriteLock: this.writeLock } : {}),
        delegation: { depth: 0, maxDepth: 2 },
      };

      taskResult = await this.pool.invoke(
        "code",
        {
          taskId,
          description: input.content,
          ...(memoryText ? { memory: memoryText } : {}),
          ...(this.maxIterations
            ? { maxIterations: this.maxIterations }
            : {}),
        },
        scope,
      );

      this.state.tasks.setResult(taskId, taskResult);
      try {
        this.state.tasks.transition(
          taskId,
          taskResult.status === "success"
            ? "completed"
            : taskResult.status === "replan_needed"
              ? "replan_needed"
              : taskResult.status === "timeout"
                ? "timeout"
                : taskResult.status === "cancelled"
                  ? "cancelled"
                  : "failed",
        );
      } catch {
        // 状态可能已由执行流程推进
      }
      await this.persistTask(taskId);
      this.emitEvent({
        type: "task.status",
        taskId,
        roleId: "code",
        status: this.state.tasks.get(taskId)?.status ?? "failed",
      });

      if (taskResult.summary) {
        const assistant = await this.appendMessage(
          "assistant",
          taskResult.summary,
        );
        this.emitEvent({ type: "message.completed", message: assistant });
      }

      if (taskResult.status === "success") {
        const result: RunResult = {
          runId,
          sessionId: this.id,
          status: "completed",
          finalResponse: taskResult.summary,
          taskResults: [taskResult],
        };
        // Session checkpoint 是完成状态的持久化保证；失败时走 catch 标记 failed
        await this.saveSessionCheckpoint(runId, "completed", "finalizer", [
          taskResult,
        ]);
        try {
          await this.ports.checkpoints.purgeRun(this.id, runId);
        } catch {
          // 清理失败不影响已完成的 run
        }
        await this.ports.runs.updateRun(runId, {
          status: "completed",
          finishedAt: this.ports.clock.now(),
        });
        this.emitEvent({ type: "run.completed", result });

        void this.titleService.maybeGenerate(input.content);
        void this.extractMemory(runId, input.content, taskResult);
        return result;
      }

      const error =
        taskResult.error ??
        serializeError(new Error(taskResult.summary), "TOOL_FAILED");
      const result: RunResult = {
        runId,
        sessionId: this.id,
        status: taskResult.status === "cancelled" ? "aborted" : "failed",
        finalResponse: taskResult.summary,
        taskResults: [taskResult],
        error,
      };
      await this.ports.runs.updateRun(runId, {
        status: result.status === "aborted" ? "aborted" : "failed",
        finishedAt: this.ports.clock.now(),
      });
      if (result.status === "aborted") {
        this.emitEvent({ type: "run.aborted", reason: taskResult.summary });
      } else {
        this.emitEvent({ type: "run.failed", error });
      }
      await this.saveSessionCheckpoint(
        runId,
        result.status === "aborted" ? "aborted" : "failed",
        "finalizer",
        [taskResult],
      );
      return result;
    } catch (error) {
      const aborted = controller.signal.aborted;
      const serialized = aborted
        ? abortError(String(controller.signal.reason ?? "aborted"))
        : serializeError(error, "INTERNAL");

      if (taskId) {
        try {
          this.state.tasks.transition(taskId, "failed");
          await this.persistTask(taskId);
        } catch {
          // ignore
        }
      }

      const result: RunResult = {
        runId,
        sessionId: this.id,
        status: aborted ? "aborted" : "failed",
        ...(taskResult ? { taskResults: [taskResult] } : { taskResults: [] }),
        error: serialized,
      };
      await this.ports.runs.updateRun(runId, {
        status: aborted ? "aborted" : "failed",
        finishedAt: this.ports.clock.now(),
      });
      if (aborted) {
        this.emitEvent({ type: "run.aborted", reason: serialized.message });
      } else {
        this.emitEvent({ type: "run.failed", error: serialized });
      }
      try {
        await this.saveSessionCheckpoint(
          runId,
          aborted ? "aborted" : "failed",
          "finalizer",
        );
      } catch {
        // 保留原错误
      }
      return result;
    } finally {
      this.approvalService.cancelRun(runId, "run finished");
      this.questionService.cancelRun(runId, "run finished");
    }
  }

  private async retrieveMemory(content: string): Promise<string | undefined> {
    if (!this.memory) return undefined;
    try {
      const records = await this.memory.search({ query: content, topK: 5 });
      if (records.length === 0) return undefined;
      const lines = records.map(
        (record) =>
          `- [${record.scope}] ${record.content} (confidence ${record.confidence})`,
      );
      return lines.join("\n").slice(0, 4_000);
    } catch {
      return undefined;
    }
  }

  private async extractMemory(
    runId: RunId,
    userContent: string,
    result: TaskResult,
  ): Promise<void> {
    if (!this.memoryExtractor || !this.memory) return;
    try {
      await this.memory.extractAndApply({
        workspaceId: this.options.workspaceId,
        sessionId: this.id,
        runId,
        userMessages: [userContent],
        tasks: [
          {
            role: "code",
            description: userContent,
            result,
            filesChanged:
              result.artifacts?.filesChanged?.map((file) => file.path) ?? [],
          },
        ],
        commandsRun: [],
        finalResponse: result.summary,
      });
    } catch (error) {
      console.error("[agent-session] memory extraction failed", error);
    }
  }

  private async extractMemoryFromResults(
    runId: RunId,
    userContent: string,
    results: TaskResult[],
  ): Promise<void> {
    if (!this.memoryExtractor || !this.memory || results.length === 0) {
      return;
    }
    try {
      await this.memory.extractAndApply({
        workspaceId: this.options.workspaceId,
        sessionId: this.id,
        runId,
        userMessages: [userContent],
        tasks: results.map((result) => ({
          role: result.role,
          description: result.summary,
          result,
          filesChanged:
            result.artifacts?.filesChanged?.map((file) => file.path) ?? [],
        })),
        commandsRun: [],
        finalResponse: results.map((result) => result.summary).join("\n"),
      });
    } catch (error) {
      console.error("[agent-session] memory extraction failed", error);
    }
  }

  private async persistTask(taskId: TaskId): Promise<void> {
    const task = this.state.tasks.get(taskId);
    if (task) await this.ports.runs.upsertTask(task);
  }

  private async saveSessionCheckpoint(
    runId: RunId,
    status: RunResult["status"] | "running",
    node: "planner" | "dispatcher" | "replanner" | "finalizer",
    _results?: TaskResult[],
  ): Promise<void> {
    const tasks = this.state.tasks.snapshot();
    const artifacts = this.state.artifacts.snapshot();
    const messages = await this.ports.sessions.listMessages(this.id);
    const now = this.ports.clock.now();

    await this.ports.checkpoints.saveSession({
      v: 1,
      sessionId: this.id,
      runId,
      status,
      node,
      workspacePath: this.options.workspacePath,
      ...(this.planState.get() ? { plan: this.planState.get()! } : {}),
      tasks,
      completedTaskIds: tasks
        .filter((task) => task.status === "completed")
        .map((task) => task.id),
      pendingTaskIds: tasks
        .filter((task) =>
          ["pending", "assigned", "awaiting_approval", "awaiting_input"].includes(
            task.status,
          ),
        )
        .map((task) => task.id),
      inFlightTaskIds: tasks
        .filter((task) =>
          ["assigned", "running", "awaiting_approval", "awaiting_input"].includes(
            task.status,
          ),
        )
        .map((task) => task.id),
      artifacts,
      messages,
      pendingApprovals: this.approvalService.listPending(),
      pendingQuestions: this.questionService.listPending(),
      replanCount: 0,
      nextSeq: this.eventChannel.lastSeq,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async appendMessage(
    role: ChatMessage["role"],
    content: string,
  ): Promise<ChatMessage> {
    const message: ChatMessage = {
      id: this.ports.ids.next("msg"),
      sessionId: this.id,
      role,
      content,
      createdAt: this.ports.clock.now(),
    };
    await this.ports.sessions.appendMessage(message);
    return message;
  }

  private emitEvent(event: SessionEvent): void {
    const runId = this.activeRunId;
    if (!runId) return;
    this.eventChannel.emit(runId, event);
  }

  private async *filterRun(
    runId: RunId,
    source: AsyncIterable<EventEnvelope<SessionEvent>>,
  ): AsyncIterable<EventEnvelope<SessionEvent>> {
    for await (const envelope of source) {
      if (envelope.runId === runId) yield envelope;
    }
  }
}
