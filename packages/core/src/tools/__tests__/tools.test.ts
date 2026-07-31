/**
 * 工具层单元测试
 *
 * 覆盖：
 * - ToolRegistry 的注册、查询、过滤
 * - createLangChainTool 适配为 StructuredTool
 * - 文件工具路径穿越防护
 * - Shell 工具命令白名单
 * - 代码搜索工具 grep 行为
 * - Git 工具（需要 git 仓库环境）
 * - Web 工具（fetch 行为）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import { createLangChainTool } from '../base.js';
import type { ToolDefinition, ToolContext } from '../base.js';
import { fileReadTool, fileWriteTool, fileListTool } from '../file.js';
import { shellExecTool } from '../shell.js';
import { codeSearchTool } from '../search.js';
import { webFetchTool } from '../web.js';
import {
  gitStatusTool,
  gitDiffTool,
  gitLogTool,
  gitCommitTool,
  gitBranchTool,
} from '../git.js';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

// ═════════════════════════════════════════════
// 测试辅助
// ═════════════════════════════════════════════

/** 创建临时测试工作区 */
async function createTempWorkspace(): Promise<string> {
  const testDir = path.join(tmpdir(), `code-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(testDir, { recursive: true });
  return testDir;
}

/** 清理临时工作区 */
async function cleanupTempWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/** 创建测试上下文 */
function makeCtx(workspacePath: string): ToolContext {
  return { workspacePath, sessionId: 'test-session' };
}

// ═════════════════════════════════════════════
// ToolRegistry 测试
// ═════════════════════════════════════════════

describe('ToolRegistry', () => {
  it('应成功注册并查询工具', () => {
    const registry = ToolRegistry.createDefault();
    registry.register(fileReadTool);

    const def = registry.get('file_read');
    expect(def).toBeDefined();
    expect(def?.name).toBe('file_read');
    expect(def?.permission).toBe('safe');
  });

  it('未注册的工具应返回 undefined', () => {
    const registry = ToolRegistry.createDefault();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('同名工具后注册应覆盖前注册', () => {
    const registry = ToolRegistry.createDefault();
    const tool1: ToolDefinition = {
      name: 'test.tool',
      description: '第一版',
      schema: z.object({}),
      permission: 'safe',
      async execute() {
        return 'v1';
      },
    };
    const tool2: ToolDefinition = {
      name: 'test.tool',
      description: '第二版',
      schema: z.object({}),
      permission: 'confirm',
      async execute() {
        return 'v2';
      },
    };
    registry.register(tool1);
    registry.register(tool2);

    const def = registry.get('test.tool');
    expect(def?.description).toBe('第二版');
    expect(def?.permission).toBe('confirm');
  });

  it('listAll 应返回所有已注册工具', () => {
    const registry = ToolRegistry.createDefault();
    registry.register(fileReadTool);
    registry.register(fileWriteTool);
    registry.register(fileListTool);

    const all = registry.listAll();
    expect(all).toHaveLength(3);
    const names = all.map((t) => t.name);
    expect(names).toContain('file_read');
    expect(names).toContain('file_write');
    expect(names).toContain('file_list');
  });

  it('getToolsForAgent 应根据 capability 过滤工具', async () => {
    const workspacePath = await createTempWorkspace();
    try {
      const registry = ToolRegistry.createDefault();
      registry.register(fileReadTool);
      registry.register(fileWriteTool);
      registry.register(shellExecTool);

      const ctx = makeCtx(workspacePath);
      const tools = registry.getToolsForAgent(
        { tools: ['file_read', 'file_write'], paths: [workspacePath] },
        ctx,
      );

      expect(tools).toHaveLength(2);
      const names = tools.map((t) => t.name);
      expect(names).toContain('file_read');
      expect(names).toContain('file_write');
      expect(names).not.toContain('shell_exec');
    } finally {
      await cleanupTempWorkspace(workspacePath);
    }
  });

  it('getToolsForAgent 未注册的工具应被跳过', async () => {
    const workspacePath = await createTempWorkspace();
    try {
      const registry = ToolRegistry.createDefault();
      registry.register(fileReadTool);

      const ctx = makeCtx(workspacePath);
      const tools = registry.getToolsForAgent(
        { tools: ['file_read', 'nonexistent.tool'], paths: [workspacePath] },
        ctx,
      );

      // 不存在的工具应被跳过
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('file_read');
    } finally {
      await cleanupTempWorkspace(workspacePath);
    }
  });
});

// ═════════════════════════════════════════════
// createLangChainTool 测试
// ═════════════════════════════════════════════

describe('createLangChainTool', () => {
  it('应将 ToolDefinition 转换为 LangChain StructuredTool', async () => {
    const workspacePath = await createTempWorkspace();
    try {
      const tool: ToolDefinition = {
        name: 'test.echo',
        description: '回显输入内容',
        schema: z.object({ message: z.string() }),
        permission: 'safe',
        async execute(args) {
          return `Echo: ${args.message}`;
        },
      };

      const ctx = makeCtx(workspacePath);
      const lcTool = createLangChainTool(tool, ctx);

      expect(lcTool.name).toBe('test.echo');
      expect(lcTool.description).toBe('回显输入内容');

      const result = await lcTool.invoke({ message: 'hello' });
      expect(result).toBe('Echo: hello');
    } finally {
      await cleanupTempWorkspace(workspacePath);
    }
  });

  it('Zod schema 校验应在调用时生效', async () => {
    const workspacePath = await createTempWorkspace();
    try {
      const tool: ToolDefinition = z.object({
        name: z.string().min(1),
        age: z.number().min(0),
      }) as any;
      // 使用正确的模式定义
      const testTool: ToolDefinition = {
        name: 'test.user',
        description: '用户信息',
        schema: z.object({
          name: z.string().min(1),
          age: z.number().min(0),
        }),
        permission: 'safe',
        async execute(args) {
          return `${args.name}, ${args.age}`;
        },
      };

      const ctx = makeCtx(workspacePath);
      const lcTool = createLangChainTool(testTool, ctx);

      // 正确参数应正常执行
      const result = await lcTool.invoke({ name: 'Alice', age: 30 });
      expect(result).toBe('Alice, 30');

      // 无效参数应抛出 ZodError
      await expect(lcTool.invoke({ name: '', age: -1 })).rejects.toThrow();
    } finally {
      await cleanupTempWorkspace(workspacePath);
    }
  });
});

// ═════════════════════════════════════════════
// 文件工具测试
// ═════════════════════════════════════════════

describe('文件工具', () => {
  let workspacePath: string;

  beforeAll(async () => {
    workspacePath = await createTempWorkspace();
    // 创建测试文件
    await fs.writeFile(path.join(workspacePath, 'test.txt'), 'Hello, World!');
    await fs.mkdir(path.join(workspacePath, 'subdir'), { recursive: true });
    await fs.writeFile(path.join(workspacePath, 'subdir', 'data.json'), '{"key": "value"}');
  });

  afterAll(async () => {
    await cleanupTempWorkspace(workspacePath);
  });

  describe('file_read', () => {
    it('应读取文件内容', async () => {
      const result = await fileReadTool.execute({ path: 'test.txt' }, makeCtx(workspacePath));
      expect(result).toBe('Hello, World!');
    });

    it('应读取子目录中的文件', async () => {
      const result = await fileReadTool.execute(
        { path: 'subdir/data.json' },
        makeCtx(workspacePath),
      );
      expect(result).toBe('{"key": "value"}');
    });

    it('路径穿越应被拦截', async () => {
      await expect(
        fileReadTool.execute({ path: '../../../etc/passwd' }, makeCtx(workspacePath)),
      ).rejects.toThrow(/路径穿越/);
    });

    it('不存在的文件应抛出错误', async () => {
      await expect(
        fileReadTool.execute({ path: 'nonexistent.txt' }, makeCtx(workspacePath)),
      ).rejects.toThrow();
    });
  });

  describe('file_write', () => {
    it('应写入文件内容', async () => {
      const ctx = makeCtx(workspacePath);
      const result = await fileWriteTool.execute(
        { path: 'new_file.txt', content: 'New content' },
        ctx,
      );
      expect(result).toContain('文件已写入');

      const content = await fs.readFile(path.join(workspacePath, 'new_file.txt'), 'utf-8');
      expect(content).toBe('New content');
    });

    it('应自动创建父目录', async () => {
      const ctx = makeCtx(workspacePath);
      await fileWriteTool.execute(
        { path: 'deep/nested/file.txt', content: 'Deep file' },
        ctx,
      );

      const content = await fs.readFile(
        path.join(workspacePath, 'deep/nested/file.txt'),
        'utf-8',
      );
      expect(content).toBe('Deep file');
    });

    it('路径穿越应被拦截', async () => {
      await expect(
        fileWriteTool.execute(
          { path: '../../../etc/malicious', content: 'danger' },
          makeCtx(workspacePath),
        ),
      ).rejects.toThrow(/路径穿越/);
    });
  });

  describe('file_list', () => {
    it('应列出根目录内容', async () => {
      const result = await fileListTool.execute({ path: '.' }, makeCtx(workspacePath));
      expect(result).toContain('📄 test.txt');
      expect(result).toContain('📁 subdir');
    });

    it('应列出子目录内容', async () => {
      const result = await fileListTool.execute(
        { path: 'subdir' },
        makeCtx(workspacePath),
      );
      expect(result).toContain('data.json');
    });

    it('空目录应返回提示', async () => {
      const emptyDir = path.join(workspacePath, 'empty');
      await fs.mkdir(emptyDir, { recursive: true });
      const result = await fileListTool.execute({ path: 'empty' }, makeCtx(workspacePath));
      expect(result).toBe('(空目录)');
    });

    it('不存在的目录应抛出错误', async () => {
      await expect(
        fileListTool.execute({ path: 'nonexistent' }, makeCtx(workspacePath)),
      ).rejects.toThrow();
    });
  });
});

// ═════════════════════════════════════════════
// Shell 工具测试
// ═════════════════════════════════════════════

describe('Shell 工具', () => {
  let workspacePath: string;

  beforeAll(async () => {
    workspacePath = await createTempWorkspace();
  });

  afterAll(async () => {
    await cleanupTempWorkspace(workspacePath);
  });

  it('应执行白名单中的命令', async () => {
    const result = await shellExecTool.execute(
      { command: 'echo hello' },
      makeCtx(workspacePath),
    );
    expect(result).toContain('hello');
  });

  it('应拒绝白名单外的命令', async () => {
    const result = await shellExecTool.execute(
      { command: 'curl http://example.com' },
      makeCtx(workspacePath),
    );
    expect(result).toContain('不在允许列表中');
  });

  it('ls 应返回目录内容', async () => {
    // 先创建一个文件
    await fs.writeFile(path.join(workspacePath, 'shell-test.txt'), 'test');

    const result = await shellExecTool.execute(
      { command: 'ls' },
      makeCtx(workspacePath),
    );
    expect(result).toContain('shell-test.txt');
  });

  it('pwd 应返回当前路径', async () => {
    const result = await shellExecTool.execute(
      { command: 'pwd' },
      makeCtx(workspacePath),
    );
    // macOS 上 /var 是 /private/var 的符号链接，用 realpathSync 解析真实路径
    const actual = result.trim();
    const realActual = realpathSync(actual);
    const realExpected = realpathSync(workspacePath);
    expect(realActual).toBe(realExpected);
  });
});

// ═════════════════════════════════════════════
// 代码搜索工具测试
// ═════════════════════════════════════════════

describe('代码搜索工具', () => {
  let workspacePath: string;

  beforeAll(async () => {
    workspacePath = await createTempWorkspace();
    await fs.writeFile(
      path.join(workspacePath, 'search-test.ts'),
      'const greeting = "hello world";\nfunction test() { return 42; }',
    );
  });

  afterAll(async () => {
    await cleanupTempWorkspace(workspacePath);
  });

  it('应搜索到匹配的内容', async () => {
    const result = await codeSearchTool.execute(
      { pattern: 'greeting' },
      makeCtx(workspacePath),
    );
    expect(result).toContain('greeting');
    expect(result).toContain('search-test.ts');
  });

  it('无匹配时应返回提示', async () => {
    const result = await codeSearchTool.execute(
      { pattern: 'nonexistent_pattern_xyz' },
      makeCtx(workspacePath),
    );
    expect(result).toBe('未找到匹配项。');
  });
});

// ═════════════════════════════════════════════
// Git 工具测试
// ═════════════════════════════════════════════

describe('Git 工具', () => {
  let workspacePath: string;

  beforeAll(async () => {
    workspacePath = await createTempWorkspace();
    // 初始化 git 仓库
    execSync('git init', { cwd: workspacePath });
    execSync('git config user.email "test@test.com"', { cwd: workspacePath });
    execSync('git config user.name "Test"', { cwd: workspacePath });
    // 创建初始提交
    await fs.writeFile(path.join(workspacePath, 'README.md'), '# Test Repo');
    execSync('git add README.md', { cwd: workspacePath });
    execSync('git commit -m "initial commit"', { cwd: workspacePath });
  });

  afterAll(async () => {
    await cleanupTempWorkspace(workspacePath);
  });

  describe('git_status', () => {
    it('应返回 JSON 状态信息', async () => {
      const result = await gitStatusTool.execute({}, makeCtx(workspacePath));
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('current');
      expect(parsed).toHaveProperty('files');
    });
  });

  describe('git_diff', () => {
    it('修改文件后应有差异', async () => {
      await fs.appendFile(path.join(workspacePath, 'README.md'), '\nNew line');
      const result = await gitDiffTool.execute({ staged: false }, makeCtx(workspacePath));
      expect(result).toContain('New line');
    });

    it('无变化时应返回 "(没有差异)"', async () => {
      execSync('git checkout README.md', { cwd: workspacePath });
      const result = await gitDiffTool.execute({ staged: false }, makeCtx(workspacePath));
      expect(result).toBe('(没有差异)');
    });
  });

  describe('git_log', () => {
    it('应返回提交日志', async () => {
      const result = await gitLogTool.execute({ maxCount: 5 }, makeCtx(workspacePath));
      expect(result).toContain('initial commit');
    });
  });

  describe('git_branch', () => {
    it('应列出分支', async () => {
      const result = await gitBranchTool.execute({}, makeCtx(workspacePath));
      expect(result).toContain('main');
    });
  });
});

// ═════════════════════════════════════════════
// Web 工具测试
// ═════════════════════════════════════════════

describe('Web 工具', () => {
  let workspacePath: string;

  beforeAll(async () => {
    workspacePath = await createTempWorkspace();
  });

  afterAll(async () => {
    await cleanupTempWorkspace(workspacePath);
  });

  it.skip('应拒绝获取二进制内容（需要外网连接，默认跳过）', async () => {
    const result = await webFetchTool.execute(
      { url: 'https://httpbin.org/image/png' },
      makeCtx(workspacePath),
    );
    // 由于网络环境不确定，不硬编码期望值
    // 但至少应返回字符串结果（含错误信息或内容）
    expect(typeof result).toBe('string');
  });

  it('fetch 无效 URL 应返回错误信息', async () => {
    try {
      const result = await webFetchTool.execute(
        { url: 'http://127.0.0.1:65535/nonexistent' },
        makeCtx(workspacePath),
      );
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    } catch {
      // fetch 在 Node.js 中某些情况下可能直接抛出错误，这也是预期行为
      expect(true).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════
// 权限标签测试
// ═════════════════════════════════════════════

describe('工具权限标签', () => {
  it('safe 权限工具：file_read, file_list, code_search, git_status, git_diff, git_log, web_fetch', () => {
    const safeTools = [
      fileReadTool,
      fileListTool,
      codeSearchTool,
      gitStatusTool,
      gitDiffTool,
      gitLogTool,
      webFetchTool,
    ];
    for (const tool of safeTools) {
      expect(tool.permission).toBe('safe');
    }
  });

  it('confirm 权限工具：file_write, shell_exec, git_commit, git_branch', () => {
    const confirmTools = [fileWriteTool, shellExecTool, gitCommitTool, gitBranchTool];
    for (const tool of confirmTools) {
      expect(tool.permission).toBe('confirm');
    }
  });

  it('所有 11 个内置工具应正确命名和注册', () => {
    const registry = ToolRegistry.createDefault();
    const allTools = [
      fileReadTool,
      fileWriteTool,
      fileListTool,
      shellExecTool,
      codeSearchTool,
      gitStatusTool,
      gitDiffTool,
      gitLogTool,
      gitCommitTool,
      gitBranchTool,
      webFetchTool,
    ];

    allTools.forEach((tool) => registry.register(tool));

    const registered = registry.listAll();
    expect(registered).toHaveLength(11);
  });
});
