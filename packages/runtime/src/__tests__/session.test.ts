/**
 * AgentSession 集成测试（直接 Code 任务纵向切片）
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import {
  InMemoryMemoryStore,
  MemoryService,
  type ChatModelLike,
} from "@code-agent/core";
import {
  asMemoryId,
  asRunId,
  asSessionId,
  asWorkspaceId,
  type ApprovalRequest,
  type MemoryRecord,
} from "@code-agent/protocol";
import { createRuntime, type Runtime } from "../factory.js";
import {
  AgentSession,
  SessionBusyError,
} from "../session/agent-session.js";
import { createInMemoryPorts } from "../ports/in-memory.js";

const tempDirs: string[] = [];
const runtimes: Runtime[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-session-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.dispose().catch(() => {});
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

class ScriptedModel implements ChatModelLike {
  readonly calls: BaseMessage[][] = [];
  readonly bound: boolean[] = [];

  constructor(private readonly responses: BaseMessage[]) {}

  bindTools(): ChatModelLike {
    this.bound.push(true);
    return this;
  }

  async invoke(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<BaseMessage> {
    this.calls.push([...messages]);
    if (options?.signal?.aborted) throw new Error("aborted");
    const response = this.responses.shift();
    if (!response) throw new Error("no scripted response left");
    return response;
  }
}

class HangingModel implements ChatModelLike {
  bindTools(): ChatModelLike {
    return this;
  }

  invoke(
    _messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<BaseMessage> {
    return new Promise<BaseMessage>((_resolve, reject) => {
      if (options?.signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      options?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    });
  }
}

async function setup(
  model: ChatModelLike,
  options: {
    memory?: MemoryService;
    extractor?: import("@code-agent/core").MemoryExtractor;
    title?: string;
    autoApprove?: boolean;
    planMode?: boolean;
    orchestration?: boolean;
  } = {},
): Promise<{
  ports: ReturnType<typeof createInMemoryPorts>;
  workspace: string;
  session: AgentSession;
  runtime: Runtime;
}> {
  const ports = createInMemoryPorts();
  const workspace = tempDir();
  const runtime = createRuntime(
    {
      model,
      ...(options.memory ? { memory: options.memory } : {}),
      ...(options.extractor
        ? { memoryExtractor: options.extractor }
        : {}),
      ...(options.autoApprove ? { autoApprove: true } : {}),
    },
    { ports, approvalTimeoutMs: 1_000, questionTimeoutMs: 1_000 },
  );
  runtimes.push(runtime);

  const session = await runtime.createSession({
    workspacePath: workspace,
    title: options.title ?? "Test Session",
    orchestration: options.orchestration ?? false,
    planMode: options.planMode ?? false,
  });
  return { ports, workspace, session, runtime };
}

function toolCall(name: string, args: Record<string, unknown>): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: `call_${name}`, name, args }],
  });
}

function text(content: string): AIMessage {
  return new AIMessage({ content });
}

async function approveNext(
  session: AgentSession,
  decision: "approved" | "denied",
): Promise<void> {
  for await (const envelope of session.subscribe()) {
    if (envelope.event.type === "approval.required") {
      session.approve(envelope.event.request.callId, decision);
      return;
    }
  }
}

async function approvePlanNext(
  session: AgentSession,
  decision: "approved" | "denied",
  options: { selectedProposalIds?: string[]; feedback?: string } = {},
): Promise<ApprovalRequest | undefined> {
  for await (const envelope of session.subscribe()) {
    const event = envelope.event;
    if (
      event.type === "approval.required" &&
      event.request.kind === "plan"
    ) {
      session.approve(event.request.callId, {
        decision,
        ...(options.selectedProposalIds
          ? { selectedProposalIds: options.selectedProposalIds }
          : {}),
        ...(options.feedback ? { feedback: options.feedback } : {}),
      });
      return event.request;
    }
  }
  return undefined;
}

async function answerNext(session: AgentSession, answer: string): Promise<void> {
  for await (const envelope of session.subscribe()) {
    if (envelope.event.type === "user.question.required") {
      session.answer(envelope.event.question.questionId, answer);
      return;
    }
  }
}

describe("AgentSession direct slice", () => {
  it("完成一次 run，持久化消息并发出事件序列", async () => {
    const model = new ScriptedModel([text("done")]);
    const { session, ports } = await setup(model);

    const handle = await session.run({ content: "hello" });
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(result.finalResponse).toBe("done");

    const messages = await ports.sessions.listMessages(session.id);
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    const events = [];
    for await (const envelope of session.subscribe()) {
      events.push(envelope);
      if (envelope.event.type === "run.completed") break;
    }
    expect(events[0].event.type).toBe("run.started");
    expect(events.at(-1)?.event.type).toBe("run.completed");
    const seqs = events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it("snapshot 返回任务、消息和 agent 活动", async () => {
    const model = new ScriptedModel([text("done")]);
    const { session } = await setup(model);

    const handle = await session.run({ content: "hello" });
    await handle.done;
    const snapshot = await session.snapshot();

    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.agents).toEqual([]);
  });

  it("同一会话并发 run 被拒绝", async () => {
    const model = new HangingModel();
    const { session } = await setup(model);

    const handle = await session.run({ content: "first" });
    await expect(session.run({ content: "second" })).rejects.toBeInstanceOf(
      SessionBusyError,
    );

    handle.abort();
    await handle.done;
  });

  it("abort 返回 aborted 并清理待审批", async () => {
    const model = new HangingModel();
    const { session } = await setup(model);

    const handle = await session.run({ content: "hang" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await session.abort();

    const result = await handle.done;
    expect(result.status).toBe("aborted");
  });

  it("失败时保留 Session checkpoint", async () => {
    const model = new ScriptedModel([]);
    const { session, ports } = await setup(model);

    const handle = await session.run({ content: "fail" });
    const result = await handle.done;
    expect(result.status).toBe("failed");

    const checkpoint = await ports.checkpoints.loadLatestSession(session.id);
    expect(checkpoint?.status).toBe("failed");
  });
});

describe("approval", () => {
  it("autoApprove 下 file_write 免审批直接执行", async () => {
    const model = new ScriptedModel([
      toolCall("file_write", { path: "auto.txt", content: "hello" }),
      text("done"),
    ]);
    const { session, workspace } = await setup(model, { autoApprove: true });

    const handle = await session.run({ content: "write a file" });
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(existsSync(join(workspace, "auto.txt"))).toBe(true);
  });

  it("批准后执行 confirm 工具", async () => {
    const model = new ScriptedModel([
      toolCall("file_write", { path: "a.txt", content: "hello" }),
      text("done"),
    ]);
    const { session, workspace } = await setup(model);

    const handle = await session.run({ content: "write a file" });
    await approveNext(session, "approved");
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(existsSync(join(workspace, "a.txt"))).toBe(true);
  });

  it("拒绝时工具不执行，但模型可以继续", async () => {
    const model = new ScriptedModel([
      toolCall("file_write", { path: "a.txt", content: "hello" }),
      text("done"),
    ]);
    const { session, workspace } = await setup(model);

    const handle = await session.run({ content: "write a file" });
    await approveNext(session, "denied");
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(existsSync(join(workspace, "a.txt"))).toBe(false);
  });
});

describe("plan mode", () => {
  const p1 = {
    id: "p1",
    title: "集中错误映射",
    summary: "在 api.ts 中统一错误处理",
    files: [{ path: "plan.txt", changes: ["写入 plan.txt"] }],
    recommended: true,
  };
  const p2 = {
    id: "p2",
    title: "只改调用方",
    summary: "在各调用点分别处理",
    files: [{ path: "plan.txt", changes: ["写入 plan.txt"] }],
  };

  it("扫描 → 提交方案 → 批准 → 同一 run 内完成写入", async () => {
    const model = new ScriptedModel([
      toolCall("submit_proposals", {
        summary: "发现两处可改进",
        proposals: [p1, p2],
      }),
      toolCall("file_write", { path: "plan.txt", content: "hello" }),
      text("done"),
    ]);
    // orchestration 为 true 也应走 direct，验证计划模式绕过编排
    const { session, workspace } = await setup(model, {
      autoApprove: true,
      planMode: true,
      orchestration: true,
    });

    const handle = await session.run({ content: "改进错误处理" });
    const request = await approvePlanNext(session, "approved", {
      selectedProposalIds: ["p1"],
    });
    const result = await handle.done;

    expect(request?.plan?.proposals).toHaveLength(2);
    expect(result.status).toBe("completed");
    expect(existsSync(join(workspace, "plan.txt"))).toBe(true);
  });

  it("拒绝后 agent 可以修订方案并重新申请", async () => {
    const model = new ScriptedModel([
      toolCall("submit_proposals", {
        summary: "方案 v1",
        proposals: [p1],
      }),
      toolCall("submit_proposals", {
        summary: "方案 v2",
        proposals: [p2],
      }),
      toolCall("file_write", { path: "plan.txt", content: "hello" }),
      text("done"),
    ]);
    const { session, workspace } = await setup(model, {
      autoApprove: true,
      planMode: true,
    });

    const decisions = [
      { decision: "denied" as const, feedback: "换一个方案" },
      { decision: "approved" as const, selectedProposalIds: ["p2"] },
    ];
    const seen: ApprovalRequest[] = [];
    const consumer = (async () => {
      let index = 0;
      for await (const envelope of session.subscribe()) {
        const event = envelope.event;
        if (
          event.type === "approval.required" &&
          event.request.kind === "plan"
        ) {
          seen.push(event.request);
          const next = decisions[index++];
          if (next) session.approve(event.request.callId, next);
        }
        if (
          event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.aborted"
        ) {
          break;
        }
      }
    })();

    const handle = await session.run({ content: "改进错误处理" });
    const result = await handle.done;
    await consumer;

    expect(seen.map((request) => request.plan?.summary)).toEqual([
      "方案 v1",
      "方案 v2",
    ]);
    expect(result.status).toBe("completed");
    expect(existsSync(join(workspace, "plan.txt"))).toBe(true);
  });
});

describe("ask_user", () => {
  it("等待用户回答后继续", async () => {
    const model = new ScriptedModel([
      toolCall("ask_user", { question: "Continue?", options: ["yes", "no"] }),
      text("done"),
    ]);
    const { session } = await setup(model);

    const handle = await session.run({ content: "ask me" });
    await answerNext(session, "yes");
    const result = await handle.done;

    expect(result.status).toBe("completed");
  });
});

describe("delegate_task", () => {
  it("按角色委派子任务并返回结果", async () => {
    const model = new ScriptedModel([
      toolCall("delegate_task", {
        role: "test",
        description: "run tests",
      }),
      text("child done"),
      text("parent done"),
    ]);
    const { session } = await setup(model);

    const handle = await session.run({ content: "implement and test" });
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(result.finalResponse).toBe("parent done");
    const snapshot = await session.snapshot();
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks.some((task) => task.role === "test")).toBe(true);
  });
});

describe("memory", () => {
  it("run 前检索记忆并注入 system prompt", async () => {
    const workspace = tempDir();
    const workspaceId = asWorkspaceId(workspace);
    const store = new InMemoryMemoryStore();
    const record: MemoryRecord = {
      id: asMemoryId("mem-1"),
      workspaceId,
      scope: "workspace",
      kind: "convention",
      content: "项目统一使用 pnpm",
      tags: ["pnpm"],
      keywords: ["pnpm"],
      confidence: 0.9,
      status: "active",
      source: {
        sessionId: asSessionId("s0"),
        runId: asRunId("r0"),
        messageIds: [],
      },
      version: 1,
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-19T00:00:00.000Z",
      useCount: 0,
    };
    await store.put(record);
    const memory = new MemoryService({ store, workspaceId });

    const model = new ScriptedModel([text("done")]);
    const ports = createInMemoryPorts();
    const runtime = createRuntime({ model, memory }, { ports });
    runtimes.push(runtime);
    const session = await runtime.createSession({
      workspacePath: workspace,
      workspaceId,
      title: "Test",
      orchestration: false,
      planMode: false,
    });

    const handle = await session.run({ content: "pnpm 怎么用" });
    await handle.done;

    const system = model.calls[0][0];
    expect(String(system.content)).toContain("项目统一使用 pnpm");
    expect(String(system.content)).toContain("<memory>");
  });
});
