/**
 * Runtime Fastify 路由测试
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage } from "@langchain/core/messages";
import {
  InMemoryMemoryStore,
  MemoryService,
  createInMemoryPorts,
  createRuntime,
  type ChatModelLike,
  type Runtime,
} from "@code-agent/runtime";
import { asWorkspaceId } from "@code-agent/protocol";
import { SessionService } from "../../session/session-service.js";
import { WorkspaceService } from "../../workspace/workspace-service.js";
import { createRuntimeServer } from "../runtime-server.js";

const tempDirs: string[] = [];
const runtimes: Runtime[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-runtime-server-"));
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

describe("runtime server", () => {
  it("sessions / workspace / providers 路由可用", async () => {
    const workspacePath = tempDir();
    writeFileSync(join(workspacePath, "a.ts"), "export const a = 1;\n");

    const memory = new MemoryService({
      store: new InMemoryMemoryStore(),
      workspaceId: asWorkspaceId(workspacePath),
    });
    const activeMemory = await memory.store({
      content: "项目使用 pnpm",
      kind: "convention",
      confidence: 0.9,
    });
    const pendingMemory = await memory.store({
      content: "可能使用 pnpm",
      kind: "fact",
      confidence: 0.4,
    });

    const ports = createInMemoryPorts();
    const runtime = createRuntime({ model: new FakeModel() }, { ports });
    runtimes.push(runtime);
    const sessionService = new SessionService(runtime, workspacePath);
    const workspace = new WorkspaceService(workspacePath);
    const app = await createRuntimeServer({
      sessions: ports.sessions,
      sessionService,
      workspace,
      memory,
    });
    await app.ready();

    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Test" },
    });
    expect(created.statusCode).toBe(201);
    const session = created.json<{ id: string; title: string }>();
    expect(session.title).toBe("Test");

    const list = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(list.json<{ sessions: unknown[] }>().sessions).toHaveLength(1);

    const history = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/history`,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<{ messages: unknown[] }>().messages).toEqual([]);

    const tree = await app.inject({
      method: "GET",
      url: "/api/workspace/tree?path=.",
    });
    expect(tree.statusCode).toBe(200);
    expect(
      tree.json<{ entries: Array<{ path: string }> }>().entries.some(
        (entry) => entry.path === "a.ts",
      ),
    ).toBe(true);

    const file = await app.inject({
      method: "GET",
      url: "/api/workspace/file?path=a.ts",
    });
    expect(file.statusCode).toBe(200);
    expect(file.json<{ file: { content: string } }>().file.content).toContain(
      "export const a",
    );

    const providers = await app.inject({
      method: "GET",
      url: "/api/config/providers",
    });
    expect(providers.statusCode).toBe(200);
    expect(
      providers.json<{ providers: unknown[] }>().providers,
    ).toHaveLength(3);

    const memoryList = await app.inject({
      method: "GET",
      url: "/api/memory",
    });
    expect(
      memoryList.json<{ memories: unknown[] }>().memories,
    ).toHaveLength(2);

    const pendingList = await app.inject({
      method: "GET",
      url: "/api/memory?status=pending_review",
    });
    expect(
      pendingList.json<{ memories: Array<{ id: string }> }>().memories,
    ).toHaveLength(1);

    const approved = await app.inject({
      method: "PATCH",
      url: `/api/memory/${pendingMemory.record.id}`,
      payload: { status: "active" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json<{ status: string }>().status).toBe("active");

    const memoryDeleted = await app.inject({
      method: "DELETE",
      url: `/api/memory/${activeMemory.record.id}`,
    });
    expect(memoryDeleted.statusCode).toBe(200);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
    });
    expect(deleted.statusCode).toBe(200);

    await app.close();
  });

  it("workspace 路径穿越返回 400", async () => {
    const workspacePath = tempDir();
    const ports = createInMemoryPorts();
    const runtime = createRuntime({ model: new FakeModel() }, { ports });
    runtimes.push(runtime);
    const sessionService = new SessionService(runtime, workspacePath);
    const workspace = new WorkspaceService(workspacePath);
    const app = await createRuntimeServer({
      sessions: ports.sessions,
      sessionService,
      workspace,
    });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/workspace/file?path=../secret",
    });
    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
