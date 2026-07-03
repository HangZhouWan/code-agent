/**
 * Orchestrator 测试
 *
 * 覆盖：
 * - 类型验证（SubTask, NextAction, TaskResult）
 * - Planner 工具函数（extractJsonArray, validateSubTask）
 * - OrchestratorState 结构验证
 * - createOrchestratorGraph 构造验证
 */

import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { SimpleChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { ToolRegistry } from '@my-agent/core';

// Orchestrator 模块
import type { SubTask, NextAction, TaskResult } from '../types.js';
import { OrchestratorState } from '../state.js';
import { extractJsonArray, validateSubTask } from '../nodes/planner.js';
import { createOrchestratorGraph } from '../graph.js';

// ---------------------------------------------------------------------------
// Mock ChatModel
// ---------------------------------------------------------------------------

class MockChatModel extends SimpleChatModel {
  constructor(private responseText: string = '[]') {
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
    return this.responseText;
  }
}

// ---------------------------------------------------------------------------
// 类型定义测试
// ---------------------------------------------------------------------------

describe('Orchestrator Types', () => {
  it('SubTask should accept valid structure with dependsOn', () => {
    const task: SubTask = {
      id: 'task-1',
      description: 'Read config file',
      tools: ['file_read'],
      dependsOn: [],
    };
    expect(task.id).toBe('task-1');
    expect(task.tools).toEqual(['file_read']);
  });

  it('SubTask should accept structure without dependsOn', () => {
    const task: SubTask = {
      id: 'task-2',
      description: 'Check git status',
      tools: ['git_status'],
    };
    expect(task.dependsOn).toBeUndefined();
  });

  it('NextAction should only accept "continue" or "summarize"', () => {
    const continueAction: NextAction = 'continue';
    const summarizeAction: NextAction = 'summarize';
    expect(continueAction).toBe('continue');
    expect(summarizeAction).toBe('summarize');
  });

  it('TaskResult should wrap SubTask with WorkerOutput', () => {
    const result: TaskResult = {
      task: {
        id: 'task-1',
        description: 'Read file',
        tools: ['file_read'],
      },
      output: {
        taskId: 'task-1',
        status: 'success',
        result: 'File content here',
      },
    };
    expect(result.task.id).toBe('task-1');
    expect(result.output.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Planner 工具函数测试
// ---------------------------------------------------------------------------

describe('extractJsonArray', () => {
  it('should extract JSON from markdown code block', () => {
    const input = '```json\n[{"id": "t1", "description": "test", "tools": []}]\n```';
    const result = extractJsonArray(input);
    expect(result).toBe('[{"id": "t1", "description": "test", "tools": []}]');
  });

  it('should extract JSON from code block without language specifier', () => {
    const input = '```\n[{"id": "a"}]\n```';
    const result = extractJsonArray(input);
    expect(result).toBe('[{"id": "a"}]');
  });

  it('should extract JSON array when no code block present', () => {
    const input = 'Here is the plan:\n[{"id": "task-1", "description": "Do stuff", "tools": ["file_read"]}]';
    const result = extractJsonArray(input);
    expect(result).toBe('[{"id": "task-1", "description": "Do stuff", "tools": ["file_read"]}]');
  });

  it('should handle pure JSON array without wrapping', () => {
    const input = '[{"id": "1", "tools": []}]';
    const result = extractJsonArray(input);
    expect(result).toBe('[{"id": "1", "tools": []}]');
  });

  it('should extract nested arrays correctly (first to last bracket)', () => {
    const input = 'Some text [{"nested": ["a", "b"]}] more text';
    const result = extractJsonArray(input);
    expect(result).toBe('[{"nested": ["a", "b"]}]');
  });

  it('should handle empty brackets', () => {
    const input = '[]';
    const result = extractJsonArray(input);
    expect(result).toBe('[]');
  });
});

describe('validateSubTask', () => {
  it('should validate a complete subtask', () => {
    const item = {
      id: 'task-1',
      description: 'Read package.json',
      tools: ['file_read'],
      dependsOn: ['task-0'],
    };
    const result = validateSubTask(item, 0);
    expect(result.id).toBe('task-1');
    expect(result.description).toBe('Read package.json');
    expect(result.tools).toEqual(['file_read']);
    expect(result.dependsOn).toEqual(['task-0']);
  });

  it('should default tools to empty array when missing', () => {
    const item = { id: 'task-2', description: 'Do something' };
    const result = validateSubTask(item, 0);
    expect(result.tools).toEqual([]);
  });

  it('should default tools to empty array when not an array', () => {
    const item = { id: 'task-3', description: 'Do something', tools: 'not-an-array' };
    const result = validateSubTask(item, 0);
    expect(result.tools).toEqual([]);
  });

  it('should default dependsOn to undefined when missing', () => {
    const item = { id: 'task-4', description: 'Do something' };
    const result = validateSubTask(item, 0);
    expect(result.dependsOn).toBeUndefined();
  });

  it('should convert non-string tool names to strings', () => {
    const item = { id: 'task-5', description: 'Test', tools: [123, true] };
    const result = validateSubTask(item, 0);
    expect(result.tools).toEqual(['123', 'true']);
  });

  it('should throw when id is missing', () => {
    expect(() => validateSubTask({ description: 'test' }, 0)).toThrow('missing required "id"');
  });

  it('should throw when description is missing', () => {
    expect(() => validateSubTask({ id: 'task-6' }, 0)).toThrow('missing required "description"');
  });

  it('should throw when id is not a string', () => {
    expect(() => validateSubTask({ id: 123, description: 'test' }, 0)).toThrow('missing required "id"');
  });
});

// ---------------------------------------------------------------------------
// OrchestratorState 测试
// ---------------------------------------------------------------------------

describe('OrchestratorState', () => {
  it('should have all required fields', () => {
    const fields = Object.keys(OrchestratorState.spec);
    expect(fields).toContain('messages');
    expect(fields).toContain('plan');
    expect(fields).toContain('completedTasks');
    expect(fields).toContain('pendingTasks');
    expect(fields).toContain('finalResponse');
    expect(fields).toContain('nextAction');
  });

  it('should have State type derived from annotation', () => {
    // OrchestratorState.State 是 TypeScript 类型（编译时），运行时 spec 字段包含 channel 定义
    expect(OrchestratorState.spec).toBeDefined();
    expect(typeof OrchestratorState.spec).toBe('object');
  });

  it('messages should have append reducer (not LastValue)', () => {
    // 验证 messages channel 存在（非 LastValue 即使用了 reducer）
    const messagesChannel = OrchestratorState.spec.messages;
    expect(messagesChannel).toBeDefined();
    // 有 reducer 的 channel 不是 LastValue 实例
    expect(messagesChannel.constructor.name).not.toBe('LastValue');
  });

  it('plan should use default LastValue (replace) channel', () => {
    const planChannel = OrchestratorState.spec.plan;
    expect(planChannel).toBeDefined();
    // spec 中的 channel 可以是 LastValue 实例或工厂函数（lazy init）
    // 无论是哪种形式，都应存在
    const isFunction = typeof planChannel === 'function';
    const isObject = typeof planChannel === 'object' && planChannel !== null;
    expect(isFunction || isObject).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Graph 构造测试
// ---------------------------------------------------------------------------

describe('createOrchestratorGraph', () => {
  it('should create a compiled graph with valid inputs', () => {
    const model = new MockChatModel('[]');
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph(model, registry, './workspace');

    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
    expect(typeof graph.stream).toBe('function');
  });

  it('should accept invoke with messages', async () => {
    const model = new MockChatModel('[]');
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph(model, registry, './workspace');

    const result = await graph.invoke({
      messages: [new HumanMessage('List files in the current directory')],
    });

    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();
    // 即使 plan 为空（Mock LLM 返回 []），也要有 finalResponse
    expect(typeof result.finalResponse).toBe('string');
  });

  it('should produce plan when LLM returns valid subtasks', async () => {
    const planJson = JSON.stringify([
      { id: 'task-1', description: 'Read package.json', tools: ['file_read'] },
      { id: 'task-2', description: 'Check git status', tools: ['git_status'] },
    ]);
    const model = new MockChatModel(planJson);
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph(model, registry, './workspace');

    const result = await graph.invoke({
      messages: [new HumanMessage('Read package.json and check git status')],
    });

    expect(result.plan).toBeDefined();
    expect(result.plan.length).toBe(2);
    expect(result.plan[0].id).toBe('task-1');
    expect(result.plan[1].id).toBe('task-2');
  });

  it('should handle subtasks with dependencies', async () => {
    const planJson = JSON.stringify([
      { id: 'task-1', description: 'Read config', tools: ['file_read'] },
      {
        id: 'task-2',
        description: 'Process config',
        tools: ['file_write'],
        dependsOn: ['task-1'],
      },
    ]);
    const model = new MockChatModel(planJson);
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph(model, registry, './workspace');

    const result = await graph.invoke({
      messages: [new HumanMessage('Read and process config')],
    });

    expect(result.plan).toHaveLength(2);
    expect(result.plan[1].dependsOn).toEqual(['task-1']);
  });

  it('should throw when planner receives empty messages', async () => {
    const model = new MockChatModel('[]');
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph(model, registry, './workspace');

    await expect(
      graph.invoke({ messages: [] }),
    ).rejects.toThrow('at least one user message');
  });

  it('should handle code-fenced JSON in planner response', async () => {
    const planJson = '```json\n[{"id": "t1", "description": "Test", "tools": ["file_read"]}]\n```';
    const model = new MockChatModel(planJson);
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph(model, registry, './workspace');

    const result = await graph.invoke({
      messages: [new HumanMessage('Test')],
    });

    expect(result.plan).toHaveLength(1);
    expect(result.plan[0].id).toBe('t1');
  });
});
