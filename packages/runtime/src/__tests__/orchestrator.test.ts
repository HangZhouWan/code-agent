/**
 * LangGraph 编排集成测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatModelLike } from "@code-agent/core";
import { createRuntime, type Runtime } from "../factory.js";
import type { AgentSession } from "../session/agent-session.js";
import { createInMemoryPorts } from "../ports/in-memory.js";

const tempDirs: string[] = [];
const runtimes: Runtime[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-orch-"));
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
  private index = 0;

  constructor(private readonly responses: Array<BaseMessage | Error>) {}

  bindTools(): ChatModelLike {
    return this;
  }

  async invoke(): Promise<BaseMessage> {
    const response = this.responses[this.index++];
    if (!response) throw new Error("no scripted response left");
    if (response instanceof Error) throw response;
    return response;
  }
}

function plan(tasks: Array<Record<string, unknown>>): AIMessage {
  return new AIMessage({
    content: JSON.stringify({ complexity: "complex", tasks }),
  });
}

function text(content: string): AIMessage {
  return new AIMessage({ content });
}

async function setup(
  responses: Array<BaseMessage | Error>,
): Promise<{
  session: AgentSession;
  workspace: string;
}> {
  const model = new ScriptedModel(responses);
  const ports = createInMemoryPorts();
  const runtime = createRuntime({ model }, { ports });
  runtimes.push(runtime);
  const workspace = tempDir();
  const session = await runtime.createSession({
    workspacePath: workspace,
    title: "Orchestrator Test",
    orchestration: true,
  });
  return { session, workspace };
}

describe("orchestrated session", () => {
  it("planner → direct dispatcher → finalizer", async () => {
    const { session } = await setup([
      plan([{ role: "code", description: "implement", routing: "direct" }]),
      text("implemented"),
      text("final answer"),
    ]);

    const handle = await session.run({ content: "build it" });
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(result.finalResponse).toBe("final answer");
    expect(result.taskResults).toHaveLength(1);

    const snapshot = await session.snapshot();
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0].status).toBe("completed");
  });

  it("planner → bus dispatcher → finalizer", async () => {
    const { session } = await setup([
      plan([{ role: "code", description: "implement", routing: "bus" }]),
      text("implemented via bus"),
      text("bus final"),
    ]);

    const handle = await session.run({ content: "bus task" });
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(result.finalResponse).toBe("bus final");
    expect(result.taskResults[0].summary).toBe("implemented via bus");
  });

  it("按 dependsOn 顺序执行任务", async () => {
    const { session } = await setup([
      plan([
        { id: "t1", role: "code", description: "implement", routing: "direct" },
        {
          id: "t2",
          role: "test",
          description: "test",
          dependsOn: ["t1"],
          routing: "direct",
        },
      ]),
      text("code done"),
      text("test done"),
      text("all done"),
    ]);

    const handle = await session.run({ content: "implement and test" });
    const result = await handle.done;

    expect(result.status).toBe("completed");
    const snapshot = await session.snapshot();
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.tasks.every((task) => task.status === "completed")).toBe(
      true,
    );
  });

  it("失败任务触发 replanner 并生成新任务", async () => {
    const { session } = await setup([
      plan([{ id: "t1", role: "code", description: "implement", routing: "direct" }]),
      new Error("llm down"),
      plan([{ id: "t2", role: "code", description: "retry implement", routing: "direct" }]),
      text("fixed"),
      text("recovered"),
    ]);

    const handle = await session.run({ content: "try" });
    const result = await handle.done;

    expect(result.status).toBe("completed");
    expect(result.finalResponse).toBe("recovered");
    const snapshot = await session.snapshot();
    expect(snapshot.tasks.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.tasks.some((task) => task.status === "failed")).toBe(true);
    expect(snapshot.tasks.some((task) => task.status === "completed")).toBe(
      true,
    );
  });

  it("发出 plan.updated / task.status / run.completed 事件", async () => {
    const { session } = await setup([
      plan([{ role: "code", description: "implement", routing: "direct" }]),
      text("implemented"),
      text("final"),
    ]);

    const handle = await session.run({ content: "build" });
    await handle.done;

    const types: string[] = [];
    for await (const envelope of session.subscribe()) {
      types.push(envelope.event.type);
      if (envelope.event.type === "run.completed") break;
    }

    expect(types).toContain("plan.updated");
    expect(types).toContain("task.status");
    expect(types).toContain("run.completed");
  });
});
