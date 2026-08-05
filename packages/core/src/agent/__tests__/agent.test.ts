/**
 * Agent 编排层 —— WorkerAgent 测试
 *
 * 覆盖：
 * - 类型导出验证
 * - WorkerAgent 构造
 * - WorkerAgent.run() 无工具场景
 * - WorkerInput / WorkerOutput 接口一致性
 */

import { describe, it, expect } from 'vitest';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { SimpleChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import { WorkerAgent } from '../worker.js';
import { ToolRegistry, type ToolDefinition } from '../../tools/index.js';
import { ToolNames } from '../../tools/tool-names.js';
import type { WorkerInput, WorkerOutput } from '../types.js';

// ---------------------------------------------------------------------------
// 简易 Mock ChatModel
// ---------------------------------------------------------------------------

/**
 * 模拟 BaseChatModel，返回固定的 AIMessage 响应。
 * 用于测试 WorkerAgent 的基本流程，无需真实 LLM。
 */
class MockChatModel extends SimpleChatModel {
  constructor() {
    super({});
  }

  _llmType(): string {
    return 'mock';
  }

  async _call(
    _messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: any,
  ): Promise<string> {
    return 'Mock response';
  }
}

// ---------------------------------------------------------------------------
// 类型验证（编译时 + 运行时）
// ---------------------------------------------------------------------------

describe('Agent Types', () => {
  it('WorkerInput should accept valid configuration', () => {
    const input: WorkerInput = {
      taskId: 'task-1',
      description: 'Read package.json',
      tools: [ToolNames.FILE_READ],
      context: 'Previous task completed successfully.',
      workspacePath: './workspace',
      maxIterations: 10,
      timeoutMs: 30000,
    };

    expect(input.taskId).toBe('task-1');
    expect(input.description).toBe('Read package.json');
    expect(input.tools).toEqual([ToolNames.FILE_READ]);
    expect(input.maxIterations).toBe(10);
    expect(input.timeoutMs).toBe(30000);
  });

  it('WorkerInput should use defaults when optional fields omitted', () => {
    const input: WorkerInput = {
      taskId: 'task-2',
      description: 'Check git status',
      tools: [ToolNames.GIT_STATUS],
      context: '',
      workspacePath: './workspace',
    };

    expect(input.maxIterations).toBeUndefined();
    expect(input.timeoutMs).toBeUndefined();
  });

  it('WorkerOutput should represent all states correctly', () => {
    const success: WorkerOutput = {
      taskId: 't1',
      status: 'success',
      result: 'Done',
    };
    expect(success.status).toBe('success');

    const failed: WorkerOutput = {
      taskId: 't2',
      status: 'failed',
      error: 'Something went wrong',
    };
    expect(failed.status).toBe('failed');

    const timeout: WorkerOutput = {
      taskId: 't3',
      status: 'timeout',
      error: 'Timed out after 60000ms',
    };
    expect(timeout.status).toBe('timeout');

    const awaiting: WorkerOutput = {
      taskId: 't4',
      status: 'awaiting_approval',
      error: 'Tool "file_write" requires user confirmation',
    };
    expect(awaiting.status).toBe('awaiting_approval');
  });
});

// ---------------------------------------------------------------------------
// WorkerAgent 构造测试
// ---------------------------------------------------------------------------

describe('WorkerAgent Construction', () => {
  it('should construct with valid model and registry', () => {
    const model = new MockChatModel();
    const registry = ToolRegistry.createDefault();

    const worker = new WorkerAgent(model, registry);
    expect(worker).toBeDefined();
  });

  it('should run and fail gracefully when no tools match', async () => {
    const model = new MockChatModel();
    const registry = ToolRegistry.createDefault();

    const worker = new WorkerAgent(model, registry);

    const output = await worker.run({
      taskId: 'test-no-tools',
      description: 'Do something',
      tools: ['nonexistent.tool'],
      context: '',
      workspacePath: './workspace',
    });

    expect(output.taskId).toBe('test-no-tools');
    expect(output.status).toBe('failed');
    expect(output.error).toContain('No tools available');
  });
});

// ---------------------------------------------------------------------------
// WorkerAgent 执行测试（需要真实工具注册）
// ---------------------------------------------------------------------------

describe('WorkerAgent Execution', () => {
  it('should return output with taskId even on failure', async () => {
    const model = new MockChatModel();
    const registry = ToolRegistry.createDefault();

    // 注册一个简单的 mock 工具
    const mockTool: ToolDefinition = {
      name: 'test.echo',
      description: 'Echo back the input',
      schema: {
        _type: undefined as any,
        parse: (data: unknown) => data as { message: string },
        _input: {} as any,
        _output: {} as any,
        _def: {} as any,
      } as any,
      permission: 'safe',
      execute: async (args) => `Echo: ${(args as any).message}`,
    };
    registry.register(mockTool);

    const worker = new WorkerAgent(model, registry);

    const output = await worker.run({
      taskId: 'test-exec',
      description: 'Echo a message',
      tools: ['test.echo'],
      context: '',
      workspacePath: './workspace',
      timeoutMs: 5000,
    });

    expect(output.taskId).toBe('test-exec');
    // Mock model returns plain AI message; if no tool calls, the agent finishes
    expect(['success', 'failed', 'timeout']).toContain(output.status);
  });
});
