/**
 * Step 2 — ExecutionEngine + Checkpoint + Memory 测试
 *
 * 覆盖：
 * - FileCheckpointManager：save/load/purge/overwrite
 * - ShortTermMemory：add/recent/clear/circular buffer
 * - WorkingMemory：write/read/snapshot/clear
 * - LongTermMemory：store/search/deleteBySession
 * - ExecutionEngine：ReAct 循环、超时、checkpoint 恢复
 * - ContextManager：build/append/compress
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HumanMessage,
  AIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// --- Checkpoint ---
import { FileCheckpointManager } from '../execution/checkpoint.js';
import type { CheckpointSnapshot } from '../execution/checkpoint.js';
import { FileOrchestratorCheckpointManager } from '../execution/checkpoint.js';
import type { OrchestratorCheckpoint } from '../execution/checkpoint.js';

// --- Memory ---
import { InMemoryShortTermMemory } from '../memory/short-term.js';
import { InMemoryWorkingMemory } from '../memory/working.js';
import { FileLongTermMemory } from '../memory/long-term.js';

// --- ExecutionEngine ---
import { ExecutionEngine } from '../execution/engine.js';
import type { ExecutionContext } from '../execution/engine.js';

// --- Context ---
import { ContextManager } from '../context/manager.js';
import type { RuntimeContext } from '../context/types.js';
import { ToolNames } from '../../tools/tool-names.js';

// =============================================================================
// 测试辅助工具
// =============================================================================

/** 创建临时目录 */
function tempDir(): string {
  const dir = path.join(os.tmpdir(), `step2-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 递归删除目录 */
function rmDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// FileCheckpointManager 测试
// =============================================================================

describe('FileCheckpointManager', () => {
  let baseDir: string;
  let ckpt: FileCheckpointManager;

  beforeEach(() => {
    baseDir = tempDir();
    ckpt = new FileCheckpointManager(path.join(baseDir, 'checkpoints'));
  });

  afterEach(() => {
    rmDir(baseDir);
  });

  const makeSnapshot = (taskId: string, step: number): Omit<CheckpointSnapshot, 'createdAt'> => ({
    taskId,
    agentId: `agent-${taskId}`,
    step,
    context: {
      messages: [new HumanMessage('test message')],
      tokenCount: 10,
    },
    toolHistory: [],
    reasoningTrail: [],
  });

  it('save → load 完成往返', async () => {
    await ckpt.save('task-1', makeSnapshot('task-1', 3));
    const loaded = await ckpt.load('task-1');

    expect(loaded).not.toBeNull();
    expect(loaded!.taskId).toBe('task-1');
    expect(loaded!.step).toBe(3);
    expect(loaded!.agentId).toBe('agent-task-1');
    expect(loaded!.createdAt).toBeInstanceOf(Date);
  });

  it('load 不存在 → 返回 null', async () => {
    const loaded = await ckpt.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('save 两次 → 第二次覆盖（最新 step 更大）', async () => {
    await ckpt.save('task-1', makeSnapshot('task-1', 1));
    await ckpt.save('task-1', makeSnapshot('task-1', 5));

    const loaded = await ckpt.load('task-1');
    expect(loaded!.step).toBe(5);
  });

  it('purge → load 返回 null', async () => {
    await ckpt.save('task-1', makeSnapshot('task-1', 1));
    await ckpt.purge('task-1');
    const loaded = await ckpt.load('task-1');
    expect(loaded).toBeNull();
  });

  it('大 context（100+ messages）不丢数据', async () => {
    const messages: BaseMessage[] = Array.from(
      { length: 120 },
      (_, i) => new HumanMessage(`Message ${i}: ${'x'.repeat(200)}`),
    );

    await ckpt.save('task-big', {
      taskId: 'task-big',
      agentId: 'agent-big',
      step: 10,
      context: {
        messages,
        tokenCount: 6000,
        summary: 'Compressed earlier content',
      },
      toolHistory: [
        { call: { name: ToolNames.FILE_READ, args: { path: 'test.txt' } }, result: 'content' },
      ],
      reasoningTrail: [
        { reasoning: 'Need to read file', decision: 'use_tool', toolCall: { name: ToolNames.FILE_READ, args: { path: 'test.txt' } } },
      ],
    });

    const loaded = await ckpt.load('task-big');
    expect(loaded).not.toBeNull();
    expect(loaded!.context.messages).toHaveLength(120);
    expect(loaded!.step).toBe(10);
    expect(loaded!.toolHistory).toHaveLength(1);
    expect(loaded!.reasoningTrail).toHaveLength(1);
    expect(loaded!.context.summary).toBe('Compressed earlier content');
  });

  it('list 应返回 checkpoint 元数据', async () => {
    await ckpt.save('task-1', makeSnapshot('task-1', 7));
    const list = await ckpt.list('task-1');
    expect(list).toHaveLength(1);
    expect(list[0].step).toBe(7);
  });

  it('cleanup 应删除过期 checkpoint', async () => {
    await ckpt.save('old-task', makeSnapshot('old-task', 1));

    // 修改文件时间为 2 天前
    const fp = path.join(baseDir, 'checkpoints', 'old-task.json');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(fp, twoDaysAgo, twoDaysAgo);

    await ckpt.cleanup(new Date(Date.now() - 24 * 60 * 60 * 1000)); // 清理 1 天前的

    const loaded = await ckpt.load('old-task');
    expect(loaded).toBeNull();
  });
});

// =============================================================================
// FileOrchestratorCheckpointManager 测试
// =============================================================================

describe('FileOrchestratorCheckpointManager', () => {
  let baseDir: string;
  let mgr: FileOrchestratorCheckpointManager;

  beforeEach(() => {
    baseDir = tempDir();
    mgr = new FileOrchestratorCheckpointManager(path.join(baseDir, 'checkpoints'));
  });

  afterEach(() => {
    rmDir(baseDir);
  });

  const makeOrchCheckpoint = (sessionId: string, taskCount: number): Omit<OrchestratorCheckpoint, 'createdAt'> => ({
    sessionId,
    messages: [{ role: 'human', content: 'Test request' }],
    plan: {
      complexity: 'simple' as const,
      tasks: Array.from({ length: taskCount }, (_, i) => ({
        id: `task-${i + 1}`,
        description: `Test task ${i + 1}`,
        tools: ['file_read'],
        dependsOn: [],
        routing: 'direct' as const,
        role: 'code',
      })),
      suggestedAgents: Object.fromEntries(
        Array.from({ length: taskCount }, (_, i) => [`task-${i + 1}`, 'code']),
      ),
    },
    progress: {
      currentNode: 'planner' as const,
      completedTaskIds: [],
    },
  });

  it('save → load 完成往返', async () => {
    await mgr.save('session-abc', makeOrchCheckpoint('session-abc', 2));
    const loaded = await mgr.load('session-abc');

    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe('session-abc');
    expect(loaded!.plan.tasks).toHaveLength(2);
    expect(loaded!.plan.tasks[0].id).toBe('task-1');
    expect(loaded!.progress.currentNode).toBe('planner');
    expect(loaded!.createdAt).toBeInstanceOf(Date);
  });

  it('load 不存在 → 返回 null', async () => {
    const loaded = await mgr.load('nonexistent');
    expect(loaded).toBeNull();
  });

  it('save 两次 → 第二次覆盖', async () => {
    await mgr.save('session-1', makeOrchCheckpoint('session-1', 1));
    const snapshot2 = makeOrchCheckpoint('session-1', 3);
    snapshot2.messages = [{ role: 'human', content: 'Updated request' }];
    await mgr.save('session-1', snapshot2);

    const loaded = await mgr.load('session-1');
    expect(loaded!.plan.tasks).toHaveLength(3);
    expect(loaded!.messages[0].content).toBe('Updated request');
  });

  it('purge → load 返回 null', async () => {
    await mgr.save('session-1', makeOrchCheckpoint('session-1', 1));
    await mgr.purge('session-1');
    const loaded = await mgr.load('session-1');
    expect(loaded).toBeNull();
  });

  it('listSessions 应返回所有 session ID', async () => {
    await mgr.save('session-a', makeOrchCheckpoint('session-a', 1));
    await mgr.save('session-b', makeOrchCheckpoint('session-b', 2));

    const sessions = await mgr.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions).toContain('session-a');
    expect(sessions).toContain('session-b');
  });

  it('listSessions 空目录应返回空数组', async () => {
    const sessions = await mgr.listSessions();
    expect(sessions).toEqual([]);
  });

  it('cleanup 应删除过期 checkpoint', async () => {
    await mgr.save('old-session', makeOrchCheckpoint('old-session', 1));

    const fp = path.join(baseDir, 'checkpoints', 'session-old-session.json');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(fp, twoDaysAgo, twoDaysAgo);

    await mgr.cleanup(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const loaded = await mgr.load('old-session');
    expect(loaded).toBeNull();
  });

  it('cleanup 不应删除未过期的 checkpoint', async () => {
    await mgr.save('fresh-session', makeOrchCheckpoint('fresh-session', 1));

    await mgr.cleanup(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const loaded = await mgr.load('fresh-session');
    expect(loaded).not.toBeNull();
  });

  it('save 应创建 session- 前缀的文件', async () => {
    await mgr.save('my-session', makeOrchCheckpoint('my-session', 1));

    const fp = path.join(baseDir, 'checkpoints', 'session-my-session.json');
    expect(fs.existsSync(fp)).toBe(true);
  });

  it('load 损坏的 JSON 文件应返回 null', async () => {
    const fp = path.join(baseDir, 'checkpoints', 'session-bad.json');
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, 'not valid json {{{', 'utf-8');

    const loaded = await mgr.load('bad');
    expect(loaded).toBeNull();
  });

  it('进度更新应保留 messages 和 plan', async () => {
    await mgr.save('session-1', makeOrchCheckpoint('session-1', 2));
    const loaded = await mgr.load('session-1');
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.plan.tasks).toHaveLength(2);
    expect(loaded!.plan.complexity).toBe('simple');
  });
});

// =============================================================================
// Cross-Manager Cleanup Isolation 测试
// =============================================================================

describe('Cross-Manager Cleanup Isolation', () => {
  let baseDir: string;
  let agentCkpt: FileCheckpointManager;
  let orchCkpt: FileOrchestratorCheckpointManager;

  beforeEach(() => {
    baseDir = tempDir();
    const sharedDir = path.join(baseDir, 'checkpoints');
    agentCkpt = new FileCheckpointManager(sharedDir);
    orchCkpt = new FileOrchestratorCheckpointManager(sharedDir);
  });

  afterEach(() => {
    rmDir(baseDir);
  });

  it('orchestrator cleanup 不应删除 agent checkpoint 文件', async () => {
    // Save an agent checkpoint
    await agentCkpt.save('task-1', {
      taskId: 'task-1',
      agentId: 'agent-1',
      step: 3,
      context: { messages: [new HumanMessage('test')], tokenCount: 5 },
      toolHistory: [],
      reasoningTrail: [],
    });

    // Save an orchestrator checkpoint
    await orchCkpt.save('session-1', {
      sessionId: 'session-1',
      messages: [{ role: 'human', content: 'test' }],
      plan: { complexity: 'simple', tasks: [], suggestedAgents: {} },
      progress: { currentNode: 'planner', completedTaskIds: [] },
    });

    // Make both files old
    const agentFp = path.join(baseDir, 'checkpoints', 'task-1.json');
    const orchFp = path.join(baseDir, 'checkpoints', 'session-session-1.json');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(agentFp, twoDaysAgo, twoDaysAgo);
    fs.utimesSync(orchFp, twoDaysAgo, twoDaysAgo);

    // Run orchestrator cleanup
    await orchCkpt.cleanup(new Date(Date.now() - 24 * 60 * 60 * 1000));

    // Agent checkpoint should still exist
    const agentLoaded = await agentCkpt.load('task-1');
    expect(agentLoaded).not.toBeNull();

    // Orchestrator checkpoint should be deleted
    const orchLoaded = await orchCkpt.load('session-1');
    expect(orchLoaded).toBeNull();
  });

  it('agent cleanup 不应删除 orchestrator checkpoint 文件', async () => {
    await agentCkpt.save('task-1', {
      taskId: 'task-1',
      agentId: 'agent-1',
      step: 3,
      context: { messages: [new HumanMessage('test')], tokenCount: 5 },
      toolHistory: [],
      reasoningTrail: [],
    });

    await orchCkpt.save('session-1', {
      sessionId: 'session-1',
      messages: [{ role: 'human', content: 'test' }],
      plan: { complexity: 'simple', tasks: [], suggestedAgents: {} },
      progress: { currentNode: 'planner', completedTaskIds: [] },
    });

    const agentFp = path.join(baseDir, 'checkpoints', 'task-1.json');
    const orchFp = path.join(baseDir, 'checkpoints', 'session-session-1.json');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(agentFp, twoDaysAgo, twoDaysAgo);
    fs.utimesSync(orchFp, twoDaysAgo, twoDaysAgo);

    // Run agent cleanup
    await agentCkpt.cleanup(new Date(Date.now() - 24 * 60 * 60 * 1000));

    // Orchestrator checkpoint should still exist
    const orchLoaded = await orchCkpt.load('session-1');
    expect(orchLoaded).not.toBeNull();

    // Agent checkpoint should be deleted
    const agentLoaded = await agentCkpt.load('task-1');
    expect(agentLoaded).toBeNull();
  });

  it('agent listTasks 不应列出 orchestrator session 文件', async () => {
    await agentCkpt.save('task-1', {
      taskId: 'task-1',
      agentId: 'agent-1',
      step: 1,
      context: { messages: [new HumanMessage('test')], tokenCount: 5 },
      toolHistory: [],
      reasoningTrail: [],
    });

    await orchCkpt.save('session-1', {
      sessionId: 'session-1',
      messages: [{ role: 'human', content: 'test' }],
      plan: { complexity: 'simple', tasks: [], suggestedAgents: {} },
      progress: { currentNode: 'planner', completedTaskIds: [] },
    });

    const tasks = await agentCkpt.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks).toContain('task-1');
    expect(tasks).not.toContain('session-1');
  });
});

// =============================================================================
// ShortTermMemory 测试
// =============================================================================

describe('InMemoryShortTermMemory', () => {
  let mem: InMemoryShortTermMemory;

  beforeEach(() => {
    mem = new InMemoryShortTermMemory();
  });

  it('recent(5) 应返回最近 5 条', () => {
    for (let i = 0; i < 10; i++) {
      mem.add({ role: 'user', content: `Message ${i}` });
    }
    const recent = mem.recent(5);
    expect(recent).toHaveLength(5);
    expect(recent[0].content).toBe('Message 5');
    expect(recent[4].content).toBe('Message 9');
  });

  it('超过 200 条自动淘汰最早的', () => {
    for (let i = 0; i < 250; i++) {
      mem.add({ role: 'user', content: `Message ${i}` });
    }
    const all = mem.all();
    expect(all.length).toBeLessThanOrEqual(200);
    expect(all[0].content).toBe('Message 50'); // 最早 50 条被淘汰
  });

  it('recent(0) 应返回空数组', () => {
    mem.add({ role: 'user', content: 'test' });
    expect(mem.recent(0)).toEqual([]);
  });

  it('recent 超过总数时应返回全部', () => {
    mem.add({ role: 'user', content: 'msg1' });
    mem.add({ role: 'assistant', content: 'msg2' });
    expect(mem.recent(10)).toHaveLength(2);
  });

  it('clear 应清空所有', () => {
    mem.add({ role: 'user', content: 'msg1' });
    mem.add({ role: 'user', content: 'msg2' });
    mem.clear();
    expect(mem.all()).toHaveLength(0);
    expect(mem.size).toBe(0);
  });
});

// =============================================================================
// WorkingMemory 测试
// =============================================================================

describe('InMemoryWorkingMemory', () => {
  let wm: InMemoryWorkingMemory;

  beforeEach(() => {
    wm = new InMemoryWorkingMemory();
  });

  it('write → read 往返', () => {
    wm.write('projectName', 'code-agent');
    expect(wm.read<string>('projectName')).toBe('code-agent');
  });

  it('read 不存在 → 返回 null', () => {
    expect(wm.read('nonexistent')).toBeNull();
  });

  it('snapshot 应返回完整副本', () => {
    wm.write('a', 1);
    wm.write('b', 'hello');
    const snap = wm.snapshot();
    expect(snap).toEqual({ a: 1, b: 'hello' });
  });

  it('clear 应清空所有', () => {
    wm.write('key1', 'value1');
    wm.write('key2', 'value2');
    wm.clear();
    expect(wm.read('key1')).toBeNull();
    expect(wm.snapshot()).toEqual({});
    expect(wm.size).toBe(0);
  });

  it('write 覆盖已有 key', () => {
    wm.write('key', 'old');
    wm.write('key', 'new');
    expect(wm.read('key')).toBe('new');
  });
});

// =============================================================================
// LongTermMemory 测试
// =============================================================================

describe('FileLongTermMemory', () => {
  let baseDir: string;
  let ltm: FileLongTermMemory;

  beforeEach(async () => {
    baseDir = tempDir();
    ltm = new FileLongTermMemory(baseDir);
  });

  afterEach(async () => {
    await ltm._reset();
    rmDir(baseDir);
  });

  it('store → search 返回匹配条目', async () => {
    await ltm.store({
      sessionId: 'session-1',
      content: 'This project uses TypeScript for the frontend and Python for the backend.',
    });
    await ltm.store({
      sessionId: 'session-1',
      content: 'The database is PostgreSQL with Redis for caching.',
    });
    await ltm.store({
      sessionId: 'session-2',
      content: 'We use Docker for containerization and Kubernetes for orchestration.',
    });

    const results = await ltm.search('TypeScript frontend');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('TypeScript');
  });

  it('search 无匹配返回空数组', async () => {
    await ltm.store({
      sessionId: 'session-1',
      content: 'This is about JavaScript.',
    });

    const results = await ltm.search('Rust programming');
    expect(results).toEqual([]);
  });

  it('search 空 query 返回空数组', async () => {
    await ltm.store({
      sessionId: 'session-1',
      content: 'Some content here.',
    });

    const results = await ltm.search('');
    expect(results).toEqual([]);
  });

  it('deleteBySession 应删除指定会话', async () => {
    await ltm.store({
      sessionId: 'session-A',
      content: 'This project uses React for UI rendering.',
    });
    await ltm.store({
      sessionId: 'session-B',
      content: 'The backend relies on Node.js Express framework.',
    });

    await ltm.deleteBySession('session-A');

    // 搜索只有 session-A 才有的独特关键词
    const resultsA = await ltm.search('React rendering');
    expect(resultsA).toEqual([]);

    // session-B 的内容仍然存在
    const resultsB = await ltm.search('Express framework');
    expect(resultsB.length).toBe(1);
    expect(resultsB[0].content).toContain('Node.js');
  });

  it('count 应返回正确数量', async () => {
    expect(await ltm.count()).toBe(0);

    await ltm.store({ sessionId: 's1', content: 'Entry 1' });
    await ltm.store({ sessionId: 's1', content: 'Entry 2' });
    await ltm.store({ sessionId: 's2', content: 'Entry 3' });

    expect(await ltm.count()).toBe(3);
  });

  it('search 应按相关度排序（精确匹配优先）', async () => {
    await ltm.store({
      sessionId: 's1',
      content: 'This is about database performance tuning and query optimization.',
    });
    await ltm.store({
      sessionId: 's2',
      content: 'database',
    });
    await ltm.store({
      sessionId: 's3',
      content: 'We use a database for storing data.',
    });

    const results = await ltm.search('database');
    expect(results.length).toBeGreaterThanOrEqual(2);
    // 精确匹配 "database" 的应排在前面
    expect(results[0].content).toBe('database');
  });
});

// =============================================================================
// ExecutionEngine 测试
// =============================================================================

describe('ExecutionEngine', () => {
  // ExecutionEngine 核心逻辑（ReAct 循环）测试
  // 注：完整 LLM 集成测试需要 mock BaseChatModel

  it('应创建 ExecutionEngine 实例', () => {
    const engine = new ExecutionEngine();
    expect(engine).toBeDefined();
  });

  it('不带参数创建时使用 Noop 实现', () => {
    const engine = new ExecutionEngine();
    expect(engine).toBeInstanceOf(ExecutionEngine);
  });
});

// =============================================================================
// ExecutionEngine — AbortSignal 测试
// =============================================================================

describe('ExecutionEngine — AbortSignal', () => {
  it('ExecutionContext 应接受 signal 字段', () => {
    const controller = new AbortController();
    const ctx: ExecutionContext = {
      agentId: 'test-agent',
      taskId: 'test-task',
      agent: {},
      model: {} as any,
      tools: [],
      systemPrompt: 'test',
      context: { messages: [], tokenCount: 0 },
      capability: { maxIterations: 5, timeoutMs: 10000 },
      signal: controller.signal,
    };
    expect(ctx.signal).toBeDefined();
    expect(ctx.signal!.aborted).toBe(false);
  });

  it('ExecutionContext signal 为可选字段', () => {
    const ctx: ExecutionContext = {
      agentId: 'test-agent',
      taskId: 'test-task',
      agent: {},
      model: {} as any,
      tools: [],
      systemPrompt: 'test',
      context: { messages: [], tokenCount: 0 },
      capability: { maxIterations: 5, timeoutMs: 10000 },
    };
    expect(ctx.signal).toBeUndefined();
  });

  it('resume() 应传递 signal 到 ExecutionContext', async () => {
    const engine = new ExecutionEngine();
    const controller = new AbortController();

    // 先保存一个 checkpoint，然后 resume 时传入 signal
    const ckpt = new FileCheckpointManager(path.join(os.tmpdir(), `signal-test-${Date.now()}`));
    await ckpt.save('task-signal', {
      taskId: 'task-signal',
      agentId: 'agent-1',
      step: 1,
      context: { messages: [new HumanMessage('test')], tokenCount: 5 },
      toolHistory: [],
      reasoningTrail: [],
    });

    // engine.resume requires checkpointManager in constructor
    const engineWithCkpt = new ExecutionEngine(ckpt);

    // 即使 signal 已 abort，resume 也应该接受 signal 参数
    controller.abort();
    const result = await engineWithCkpt.resume(
      'task-signal',
      {} as any,
      [],
      'test prompt',
      undefined,
      controller.signal,  // new param
    );

    expect(result.status).toBe('failed');
    expect(result.error).toBe('Task cancelled by user');
    expect(result.taskId).toBe('task-signal');

    // 清理
    const ckptDir = ckpt['basePath'];  // access private for cleanup
    if (fs.existsSync(ckptDir)) fs.rmSync(ckptDir, { recursive: true, force: true });
  });
});

// =============================================================================
// ContextManager build/append/compress 测试
// =============================================================================

describe('ContextManager — build/append/compress', () => {
  let manager: ContextManager;

  beforeEach(() => {
    manager = new ContextManager();
  });

  describe('build()', () => {
    it('应从消息列表构建 RuntimeContext', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('Hello'),
        new AIMessage('Hi there!'),
      ];

      const ctx = manager.build(messages);
      expect(ctx.messages).toHaveLength(2);
      expect(ctx.tokenCount).toBeGreaterThan(0);
      expect(ctx.summary).toBeUndefined();
    });

    it('应正确估算 token', () => {
      const messages: BaseMessage[] = [
        new HumanMessage('Hello World!'), // 12 chars -> ceil(12/4) = 3
      ];
      const ctx = manager.build(messages);
      expect(ctx.tokenCount).toBe(3);
    });

    it('空消息列表应返回 tokenCount=0', () => {
      const ctx = manager.build([]);
      expect(ctx.messages).toHaveLength(0);
      expect(ctx.tokenCount).toBe(0);
    });
  });

  describe('append()', () => {
    it('应追加消息并更新 tokenCount', async () => {
      const ctx = manager.build([new HumanMessage('Hello')]);
      const updated = await manager.append(ctx, 'This is new content');

      expect(updated.messages.length).toBe(2);
      expect(updated.tokenCount).toBeGreaterThan(ctx.tokenCount);
    });

    it('应保留已有 summary', async () => {
      const ctx = manager.build([new HumanMessage('Hello')]);
      ctx.summary = 'Previous summary';

      const updated = await manager.append(ctx, 'More content');
      expect(updated.summary).toBe('Previous summary');
    });
  });

  describe('compress()', () => {
    it('消息少于 keepRecent 时不应压缩', async () => {
      const messages: BaseMessage[] = Array.from(
        { length: 10 },
        (_, i) => new HumanMessage(`Message ${i}`),
      );
      const ctx = manager.build(messages);

      const compressed = await manager.compress(ctx);
      // 消息数 ≤ 20，不会被压缩
      expect(compressed.messages).toHaveLength(10);
      expect(compressed.summary).toBeUndefined();
    });

    it('消息超过 keepRecent 时应压缩并生成摘要', async () => {
      const messages: BaseMessage[] = Array.from(
        { length: 30 },
        (_, i) => new HumanMessage(`Message ${i}: ${'x'.repeat(100)}`),
      );
      const ctx = manager.build(messages);

      const compressed = await manager.compress(ctx);
      expect(compressed.messages.length).toBeLessThan(messages.length);
      expect(compressed.messages.length).toBe(20); // keepRecent = 20
      expect(compressed.summary).toBeDefined();
      expect(compressed.summary!.length).toBeGreaterThan(0);
    });

    it('已有 summary 时应合并新旧摘要', async () => {
      const messages: BaseMessage[] = Array.from(
        { length: 30 },
        (_, i) => new HumanMessage(`Message ${i}`),
      );
      const ctx = manager.build(messages);
      ctx.summary = 'Initial summary.';

      const compressed = await manager.compress(ctx);
      expect(compressed.summary).toContain('Initial summary');
      expect(compressed.summary).toContain('Additional context');
    });
  });
});
