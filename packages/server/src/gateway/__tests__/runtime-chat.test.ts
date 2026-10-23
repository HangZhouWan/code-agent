/**
 * Runtime WebSocket 聊天集成测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage } from "@langchain/core/messages";
import {
  createInMemoryPorts,
  createRuntime,
  type ChatModelLike,
  type Runtime,
} from "@code-agent/runtime";
import type { ServerWsMessage } from "@code-agent/protocol";
import { SessionService } from "../../session/session-service.js";
import { WorkspaceService } from "../../workspace/workspace-service.js";
import { createRuntimeServer } from "../runtime-server.js";

const tempDirs: string[] = [];
const runtimes: Runtime[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-ws-"));
  tempDirs.push(dir);
  return dir;
}

class FakeModel implements ChatModelLike {
  bindTools(): ChatModelLike {
    return this;
  }
  async invoke() {
    return new AIMessage({ content: "done" });
  }
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.dispose().catch(() => {});
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime chat websocket", () => {
  it("发送消息后转发事件直到 run.completed", async () => {
    const workspacePath = tempDir();
    const ports = createInMemoryPorts();
    const runtime = createRuntime({ model: new FakeModel() }, { ports });
    runtimes.push(runtime);

    const sessionService = new SessionService(runtime, workspacePath);
    const app = await createRuntimeServer({
      sessions: ports.sessions,
      sessionService,
      workspace: new WorkspaceService(workspacePath),
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(
      `${address.replace(/^http/, "ws")}/api/sessions/ws-test/chat`,
    );
    const messages: ServerWsMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket test timed out")),
        5_000,
      );

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "message", content: "hello" }));
      });
      socket.addEventListener("message", (event) => {
        const raw =
          typeof event.data === "string"
            ? event.data
            : String(event.data);
        const message = JSON.parse(raw) as ServerWsMessage;
        messages.push(message);
        if (
          message.type === "event" &&
          message.event.event.type === "run.completed"
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("WebSocket error"));
      });
    });

    expect(messages.some((message) => message.type === "ready")).toBe(
      true,
    );
    expect(
      messages.some(
        (message) =>
          message.type === "event" &&
          message.event.event.type === "run.completed",
      ),
    ).toBe(true);

    socket.close();
    await app.close();
  });

  it("ready 携带计划模式，空闲时可切换", async () => {
    const workspacePath = tempDir();
    const ports = createInMemoryPorts();
    const runtime = createRuntime({ model: new FakeModel() }, { ports });
    runtimes.push(runtime);

    const sessionService = new SessionService(runtime, workspacePath);
    const app = await createRuntimeServer({
      sessions: ports.sessions,
      sessionService,
      workspace: new WorkspaceService(workspacePath),
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(
      `${address.replace(/^http/, "ws")}/api/sessions/ws-plan/chat`,
    );
    const messages: ServerWsMessage[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket test timed out")),
        5_000,
      );

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "plan_mode", enabled: false }));
      });
      socket.addEventListener("message", (event) => {
        const raw =
          typeof event.data === "string"
            ? event.data
            : String(event.data);
        const message = JSON.parse(raw) as ServerWsMessage;
        messages.push(message);
        if (
          message.type === "event" &&
          message.event.event.type === "plan.mode.changed"
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("WebSocket error"));
      });
    });

    expect(messages[0]).toMatchObject({ type: "ready", planMode: true });
    expect(
      messages.some(
        (message) =>
          message.type === "event" &&
          message.event.event.type === "plan.mode.changed" &&
          message.event.event.enabled === false,
      ),
    ).toBe(true);

    socket.close();
    await app.close();
  });
});
