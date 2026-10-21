/**
 * 新内置工具测试
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext, ToolDefinition, ToolResult } from "../base.js";
import { normalizeToolResult } from "../base.js";
import {
  codeSearchTool,
  fileEditTool,
  fileGlobTool,
  fileListTool,
  fileReadTool,
  fileWriteTool,
  detectTestCommand,
  createBuiltinTools,
} from "../builtins/index.js";
import {
  createMemoryTools,
  type MemoryToolService,
} from "../builtins/memory.js";
import {
  createCollaborationTools,
  type CollaborationToolService,
} from "../builtins/collaboration.js";
import { ToolNames } from "../tool-names.js";

const tempDirs: string[] = [];

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "code-agent-builtins-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src", "a.ts"),
    "export const a = 1;\nexport const b = 2;\n",
    "utf-8",
  );
  writeFileSync(join(dir, "src", "b.test.ts"), "test('x', () => {});\n", "utf-8");
  writeFileSync(join(dir, "README.md"), "# demo\n", "utf-8");
  return dir;
}

function ctx(workspacePath: string): ToolContext {
  return { workspacePath, sessionId: "session-1" };
}

/** 按 middleware 的行为先解析默认值，再执行工具 */
async function runTool(
  tool: ToolDefinition,
  args: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const parsed = tool.schema.parse(args);
  return normalizeToolResult(
    await tool.execute(parsed as never, context),
  );
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("file tools", () => {
  it("file_read 支持行范围", async () => {
    const workspace = makeWorkspace();
    const result = await runTool(
      fileReadTool,
      { path: "src/a.ts", offset: 2, limit: 1 },
      ctx(workspace),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("export const b = 2;");
    expect(result.metadata).toMatchObject({ startLine: 2, endLine: 2 });
  });

  it("file_write / file_edit 修改文件", async () => {
    const workspace = makeWorkspace();
    await runTool(
      fileWriteTool,
      { path: "src/new.ts", content: "old\n" },
      ctx(workspace),
    );

    const edited = await runTool(
      fileEditTool,
      {
        path: "src/new.ts",
        old_string: "old",
        new_string: "new",
      },
      ctx(workspace),
    );
    expect(edited.ok).toBe(true);

    const read = await runTool(
      fileReadTool,
      { path: "src/new.ts" },
      ctx(workspace),
    );
    expect(read.content).toBe("new\n");
  });

  it("file_write 支持 append 追加", async () => {
    const workspace = makeWorkspace();
    await runTool(
      fileWriteTool,
      { path: "chunk.html", content: "part1\n" },
      ctx(workspace),
    );
    const appended = await runTool(
      fileWriteTool,
      { path: "chunk.html", content: "part2\n", append: true },
      ctx(workspace),
    );
    expect(appended.ok).toBe(true);
    expect(appended.content).toContain("追加");

    const read = await runTool(
      fileReadTool,
      { path: "chunk.html" },
      ctx(workspace),
    );
    expect(read.content).toBe("part1\npart2\n");
  });

  it("file_edit 在多次匹配时拒绝", async () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace, "dup.txt"), "x\nx\n", "utf-8");
    const result = await runTool(
      fileEditTool,
      { path: "dup.txt", old_string: "x", new_string: "y" },
      ctx(workspace),
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("2 次");
  });

  it("file_edit 找不到 old_string 时返回错误", async () => {
    const workspace = makeWorkspace();
    const result = await runTool(
      fileEditTool,
      { path: "src/a.ts", old_string: "nope", new_string: "x" },
      ctx(workspace),
    );
    expect(result.ok).toBe(false);
  });

  it("拒绝显式访问 .agent 等运行时目录", async () => {
    const workspace = makeWorkspace();
    mkdirSync(join(workspace, ".agent"), { recursive: true });
    writeFileSync(join(workspace, ".agent", "state.json"), "{}\n", "utf-8");

    const read = await runTool(
      fileReadTool,
      { path: ".agent/state.json" },
      ctx(workspace),
    );
    const list = await runTool(
      fileListTool,
      { path: ".agent", depth: 2 },
      ctx(workspace),
    );
    const search = await runTool(
      codeSearchTool,
      { pattern: "{", path: ".agent" },
      ctx(workspace),
    );
    const write = await runTool(
      fileWriteTool,
      { path: ".agent/state.json", content: "x" },
      ctx(workspace),
    );

    for (const result of [read, list, search, write]) {
      expect(result.ok).toBe(false);
      expect(result.content).toContain("禁止");
    }
  });

  it("file_glob 按模式查找文件", async () => {
    const workspace = makeWorkspace();
    const result = await runTool(
      fileGlobTool,
      { pattern: "**/*.ts" },
      ctx(workspace),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("src/a.ts");
    expect(result.content).toContain("src/b.test.ts");
    expect(result.content).not.toContain("README.md");
  });

  it("file_list 支持递归深度", async () => {
    const workspace = makeWorkspace();
    const result = await runTool(
      fileListTool,
      { path: ".", depth: 2 },
      ctx(workspace),
    );
    expect(result.content).toContain("src/");
    expect(result.content).toContain("src/a.ts");
  });

  it("code_search 按内容搜索", async () => {
    const workspace = makeWorkspace();
    const result = await runTool(
      codeSearchTool,
      { pattern: "export const b" },
      ctx(workspace),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("src/a.ts");
  });
});

describe("run_tests detection", () => {
  it("优先使用 package.json scripts.test + pnpm 锁文件", async () => {
    const workspace = makeWorkspace();
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
      "utf-8",
    );
    writeFileSync(join(workspace, "pnpm-lock.yaml"), "", "utf-8");

    await expect(detectTestCommand(workspace)).resolves.toBe("pnpm test");
    await expect(detectTestCommand(workspace, "custom test")).resolves.toBe(
      "custom test",
    );
  });

  it("无法检测时返回 null", async () => {
    const workspace = makeWorkspace();
    await expect(detectTestCommand(workspace)).resolves.toBeNull();
  });
});

describe("memory tools", () => {
  const service: MemoryToolService = {
    search: async () => [
      {
        id: "m1",
        content: "项目使用 pnpm",
        kind: "convention",
        scope: "workspace",
        confidence: 0.9,
      },
    ],
    store: async (input) => ({
      id: "m2",
      status: input.scope === "user" ? "pending_review" : "active",
    }),
  };

  const [search, store] = createMemoryTools(service);
  const workspace = makeWorkspace();

  it("memory_search 返回结果", async () => {
    const result = await runTool(search, { query: "pnpm", topK: 5 }, ctx(workspace));
    expect(result.content).toContain("项目使用 pnpm");
  });

  it("memory_store 对 user 作用域要求确认", async () => {
    expect(typeof store.permission).toBe("function");
    if (typeof store.permission !== "function") return;
    expect(
      store.permission(
        { content: "prefer pnpm", kind: "preference", scope: "user" },
        ctx(workspace),
      ),
    ).toMatchObject({ level: "confirm" });
    expect(
      store.permission(
        { content: "use pnpm", kind: "convention", scope: "workspace" },
        ctx(workspace),
      ),
    ).toMatchObject({ level: "allow" });
  });

  it("memory_store 返回 pending_review 状态", async () => {
    const result = await runTool(
      store,
      {
        content: "prefer pnpm",
        kind: "preference",
        scope: "user",
        confidence: 0.9,
      },
      ctx(workspace),
    );
    expect(result.content).toContain("审核");
  });
});

describe("collaboration tools", () => {
  const calls: string[] = [];
  const service: CollaborationToolService = {
    delegate: async (input) => {
      calls.push(`delegate:${input.role}`);
      return { taskId: "t1", status: "success", summary: "done" };
    },
    updatePlan: async (tasks) => {
      calls.push(`plan:${tasks.length}`);
    },
    submitProposals: async (input) => {
      calls.push(`propose:${input.proposals.length}`);
      return {
        status: "approved",
        selectedProposalIds: [input.proposals[0]?.id ?? "p1"],
        planMode: true,
      };
    },
    askUser: async (input) => {
      calls.push(`ask:${input.question}`);
      return "yes";
    },
  };

  const [delegate, plan, submitProposals, askUser] =
    createCollaborationTools(service);
  const workspace = makeWorkspace();

  it("三个协作工具都能执行", async () => {
    const delegated = await runTool(
      delegate,
      { role: "test", description: "run tests" },
      ctx(workspace),
    );
    expect(delegated.content).toContain("success");

    await runTool(
      plan,
      {
        tasks: [
          { id: "t1", description: "implement", status: "in_progress" },
        ],
      },
      ctx(workspace),
    );

    const answer = await runTool(
      askUser,
      { question: "继续吗？", options: ["yes", "no"] },
      ctx(workspace),
    );
    expect(answer.content).toContain("yes");
    expect(calls).toEqual(["delegate:test", "plan:1", "ask:继续吗？"]);
  });

  it("submit_proposals 提交方案并返回批准结果", async () => {
    const result = await runTool(
      submitProposals,
      {
        summary: "可以改进错误处理",
        proposals: [
          {
            id: "p1",
            title: "统一错误映射",
            summary: "集中处理 API 错误",
            files: [
              { path: "src/api.ts", changes: ["增加错误映射函数"] },
            ],
            recommended: true,
          },
        ],
      },
      ctx(makeWorkspace()),
    );
    expect(result.content).toContain('"status": "approved"');
    expect(result.content).toContain('"p1"');
    expect(calls).toContain("propose:1");
  });

  it("submit_proposals 拒绝重复 ID", async () => {
    const result = await runTool(
      submitProposals,
      {
        summary: "重复 ID",
        proposals: [
          proposal("p1"),
          proposal("p1"),
        ],
      },
      ctx(makeWorkspace()),
    );
    expect(result.errorCode).toBe("VALIDATION");
    expect(result.content).toContain("duplicate id");
  });

  it("submit_proposals 拒绝多个推荐方案", async () => {
    const result = await runTool(
      submitProposals,
      {
        summary: "多个推荐",
        proposals: [
          { ...proposal("p1"), recommended: true },
          { ...proposal("p2"), recommended: true },
        ],
      },
      ctx(makeWorkspace()),
    );
    expect(result.errorCode).toBe("VALIDATION");
    expect(result.content).toContain("recommended");
  });

  it("submit_proposals 拒绝工作区外路径", async () => {
    const result = await runTool(
      submitProposals,
      {
        summary: "越界",
        proposals: [
          {
            ...proposal("p1"),
            files: [{ path: "../outside.ts", changes: ["x"] }],
          },
        ],
      },
      ctx(makeWorkspace()),
    );
    expect(result.errorCode).toBe("VALIDATION");
    expect(result.content).toContain("path escapes workspace");
  });

  it("submit_proposals 限制 1-4 个方案", async () => {
    await expect(
      runTool(
        submitProposals,
        {
          summary: "空方案",
          proposals: [],
        },
        ctx(makeWorkspace()),
      ),
    ).rejects.toThrow();
  });
});

/** 构造一个最小方案 */
function proposal(id: string) {
  return {
    id,
    title: `方案 ${id}`,
    summary: "说明",
    files: [{ path: "src/api.ts", changes: ["修改错误处理"] }],
  };
}

describe("builtin catalog", () => {
  it("纯工具 15 个，注入服务后 21 个", () => {
    expect(createBuiltinTools()).toHaveLength(15);
    expect(
      createBuiltinTools({
        memory: {
          search: async () => [],
          store: async () => ({ id: "m", status: "active" }),
        },
        collaboration: {
          delegate: async () => ({}),
          updatePlan: async () => {},
          submitProposals: async () => ({
            status: "approved",
            selectedProposalIds: [],
            planMode: true,
          }),
          askUser: async () => "ok",
        },
      }),
    ).toHaveLength(21);
  });

  it("包含所有核心工具名", () => {
    const names = createBuiltinTools().map((tool) => tool.name);
    for (const name of [
      ToolNames.FILE_READ,
      ToolNames.FILE_WRITE,
      ToolNames.FILE_EDIT,
      ToolNames.FILE_GLOB,
      ToolNames.SHELL_EXEC,
      ToolNames.RUN_TESTS,
      ToolNames.GIT_ADD,
    ]) {
      expect(names).toContain(name);
    }
  });
});
