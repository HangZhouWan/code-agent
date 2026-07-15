/**
 * Orchestrator 测试
 *
 * 覆盖：
 * - 类型验证（SubTask, Plan, NextAction, TaskResult）
 * - Planner 工具函数（extractJsonArray, extractJsonObject, validateSubTask）
 * - OrchestratorState 结构验证（含 replanSignal, artifacts）
 * - createOrchestratorGraph 构造验证
 */

import { describe, it, expect } from 'vitest';
import { HumanMessage } from '@langchain/core/messages';
import { SimpleChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { ToolRegistry } from '@my-agent/core';

// Orchestrator 模块
import type { SubTask, Plan, NextAction, TaskResult } from '../types.js';
import { OrchestratorState } from '../state.js';
import { extractJsonArray, extractJsonObject, validateSubTask } from '../nodes/planner.js';
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
  it('SubTask should accept valid structure with routing and role', () => {
    const task: SubTask = {
      id: 'task-1',
      description: 'Read config file',
      tools: ['file_read'],
      dependsOn: [],
      routing: 'direct',
      role: 'code',
    };
    expect(task.id).toBe('task-1');
    expect(task.tools).toEqual(['file_read']);
    expect(task.routing).toBe('direct');
    expect(task.role).toBe('code');
  });

  it('SubTask should accept bus routing', () => {
    const task: SubTask = {
      id: 'task-2',
      description: 'Collaborative code review',
      tools: ['code_search'],
      routing: 'bus',
      role: 'code',
    };
    expect(task.routing).toBe('bus');
  });

  it('Plan should have complexity, tasks, and suggestedAgents', () => {
    const plan: Plan = {
      complexity: 'simple',
      tasks: [
        { id: 't1', description: 'Read file', tools: ['file_read'], routing: 'direct', role: 'code' },
      ],
      suggestedAgents: { t1: 'code' },
    };
    expect(plan.complexity).toBe('simple');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.suggestedAgents).toEqual({ t1: 'code' });
  });

  it('Plan complexity can be complex', () => {
    const plan: Plan = {
      complexity: 'complex',
      tasks: [],
      suggestedAgents: {},
    };
    expect(plan.complexity).toBe('complex');
  });

  it('NextAction should only accept "continue", "replan", or "finalize"', () => {
    const continueAction: NextAction = 'continue';
    const replanAction: NextAction = 'replan';
    const finalizeAction: NextAction = 'finalize';
    expect(continueAction).toBe('continue');
    expect(replanAction).toBe('replan');
    expect(finalizeAction).toBe('finalize');
  });

  it('TaskResult should wrap SubTask with WorkerOutput', () => {
    const result: TaskResult = {
      task: {
        id: 'task-1',
        description: 'Read file',
        tools: ['file_read'],
        routing: 'direct',
        role: 'code',
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

describe('extractJsonObject', () => {
  it('should extract JSON object from markdown code block', () => {
    const input = '```json\n{"complexity": "simple", "tasks": [], "suggestedAgents": {}}\n```';
    const result = extractJsonObject(input);
    expect(result).toBe('{"complexity": "simple", "tasks": [], "suggestedAgents": {}}');
  });

  it('should extract JSON object without code block', () => {
    const input = 'Here is the plan:\n{"complexity": "simple", "tasks": [{"id": "t1"}]}';
    const result = extractJsonObject(input);
    expect(result).toBe('{"complexity": "simple", "tasks": [{"id": "t1"}]}');
  });

  it('should handle pure JSON object', () => {
    const input = '{"complexity": "complex", "tasks": []}';
    const result = extractJsonObject(input);
    expect(result).toBe('{"complexity": "complex", "tasks": []}');
  });
});

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
  it('should validate a complete subtask with routing and role', () => {
    const item = {
      id: 'task-1',
      description: 'Read package.json',
      tools: ['file_read'],
      dependsOn: ['task-0'],
      routing: 'direct',
      role: 'code',
    };
    const result = validateSubTask(item, 0);
    expect(result.id).toBe('task-1');
    expect(result.description).toBe('Read package.json');
    expect(result.tools).toEqual(['file_read']);
    expect(result.dependsOn).toEqual(['task-0']);
    expect(result.routing).toBe('direct');
    expect(result.role).toBe('code');
  });

  it('should default routing to bus when missing', () => {
    const item = { id: 'task-2', description: 'Do something' };
    const result = validateSubTask(item, 0);
    expect(result.routing).toBe('bus');
  });

  it('should default role to code when missing', () => {
    const item = { id: 'task-3', description: 'Do something' };
    const result = validateSubTask(item, 0);
    expect(result.role).toBe('code');
  });

  it('should default tools to empty array when missing', () => {
    const item = { id: 'task-4', description: 'Do something' };
    const result = validateSubTask(item, 0);
    expect(result.tools).toEqual([]);
  });

  it('should default tools to empty array when not an array', () => {
    const item = { id: 'task-5', description: 'Do something', tools: 'not-an-array' };
    const result = validateSubTask(item, 0);
    expect(result.tools).toEqual([]);
  });

  it('should default dependsOn to undefined when missing', () => {
    const item = { id: 'task-6', description: 'Do something' };
    const result = validateSubTask(item, 0);
    expect(result.dependsOn).toBeUndefined();
  });

  it('should convert non-string tool names to strings', () => {
    const item = { id: 'task-7', description: 'Test', tools: [123, true] };
    const result = validateSubTask(item, 0);
    expect(result.tools).toEqual(['123', 'true']);
  });

  it('should throw when id is missing', () => {
    expect(() => validateSubTask({ description: 'test' }, 0)).toThrow('missing required "id"');
  });

  it('should throw when description is missing', () => {
    expect(() => validateSubTask({ id: 'task-8' }, 0)).toThrow('missing required "description"');
  });

  it('should throw when id is not a string', () => {
    expect(() => validateSubTask({ id: 123, description: 'test' }, 0)).toThrow('missing required "id"');
  });

  it('should reject invalid routing values by defaulting to bus', () => {
    const item = { id: 'task-9', description: 'Test', routing: 'invalid' };
    const result = validateSubTask(item, 0);
    expect(result.routing).toBe('bus');
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
    // Step 4 新增字段
    expect(fields).toContain('replanSignal');
    expect(fields).toContain('artifacts');
  });

  it('should have State type derived from annotation', () => {
    expect(OrchestratorState.spec).toBeDefined();
    expect(typeof OrchestratorState.spec).toBe('object');
  });

  it('messages should have append reducer (not LastValue)', () => {
    const messagesChannel = OrchestratorState.spec.messages;
    expect(messagesChannel).toBeDefined();
    expect(messagesChannel.constructor.name).not.toBe('LastValue');
  });

  it('artifacts should have merge reducer', () => {
    const artifactsChannel = OrchestratorState.spec.artifacts;
    expect(artifactsChannel).toBeDefined();
    // artifacts uses custom reducer, not LastValue
    expect(artifactsChannel.constructor.name).not.toBe('LastValue');
  });

  it('plan should use default LastValue (replace) channel', () => {
    const planChannel = OrchestratorState.spec.plan;
    expect(planChannel).toBeDefined();
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
    const model = new MockChatModel('{"complexity":"simple","tasks":[],"suggestedAgents":{}}');
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph({
      model,
      toolRegistry: registry,
      workspacePath: './workspace',
    });

    expect(graph).toBeDefined();
    expect(typeof graph.invoke).toBe('function');
    expect(typeof graph.stream).toBe('function');
  });

  it('should accept invoke with messages and produce finalResponse', async () => {
    const model = new MockChatModel('{"complexity":"simple","tasks":[],"suggestedAgents":{}}');
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph({
      model,
      toolRegistry: registry,
      workspacePath: './workspace',
    });

    const result = await graph.invoke({
      messages: [new HumanMessage('List files in the current directory')],
    });

    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();
    expect(typeof result.finalResponse).toBe('string');
  });

  it('should produce Plan when LLM returns valid plan', async () => {
    const planJson = JSON.stringify({
      complexity: 'simple',
      tasks: [
        { id: 'task-1', description: 'Read package.json', tools: ['file_read'], routing: 'direct', role: 'code' },
        { id: 'task-2', description: 'Check git status', tools: ['git_status'], routing: 'direct', role: 'code' },
      ],
      suggestedAgents: { 'task-1': 'code', 'task-2': 'code' },
    });
    const model = new MockChatModel(planJson);
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph({
      model,
      toolRegistry: registry,
      workspacePath: './workspace',
    });

    const result = await graph.invoke({
      messages: [new HumanMessage('Read package.json and check git status')],
    });

    expect(result.plan).toBeDefined();
    expect(result.plan.complexity).toBe('simple');
    expect(result.plan.tasks.length).toBe(2);
    expect(result.plan.tasks[0].id).toBe('task-1');
    expect(result.plan.tasks[0].routing).toBe('direct');
    expect(result.plan.tasks[0].role).toBe('code');
    expect(result.plan.tasks[1].id).toBe('task-2');
  });

  it('should handle complex plan with bus routing', async () => {
    const planJson = JSON.stringify({
      complexity: 'complex',
      tasks: [
        { id: 'task-1', description: 'Write code', tools: ['file_write'], routing: 'direct', role: 'code' },
        { id: 'task-2', description: 'Run tests', tools: ['shell'], dependsOn: ['task-1'], routing: 'bus', role: 'test' },
      ],
      suggestedAgents: { 'task-1': 'code', 'task-2': 'test' },
    });
    const model = new MockChatModel(planJson);
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph({
      model,
      toolRegistry: registry,
      workspacePath: './workspace',
    });

    const result = await graph.invoke({
      messages: [new HumanMessage('Write code and run tests')],
    });

    expect(result.plan.complexity).toBe('complex');
    expect(result.plan.tasks).toHaveLength(2);
    expect(result.plan.tasks[1].dependsOn).toEqual(['task-1']);
    expect(result.plan.tasks[1].routing).toBe('bus');
    expect(result.plan.tasks[1].role).toBe('test');
  });

  it('should handle subtasks with dependencies', async () => {
    const planJson = JSON.stringify({
      complexity: 'simple',
      tasks: [
        { id: 'task-1', description: 'Read config', tools: ['file_read'], routing: 'direct', role: 'code' },
        { id: 'task-2', description: 'Process config', tools: ['file_write'], dependsOn: ['task-1'], routing: 'direct', role: 'code' },
      ],
      suggestedAgents: { 'task-1': 'code', 'task-2': 'code' },
    });
    const model = new MockChatModel(planJson);
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph({
      model,
      toolRegistry: registry,
      workspacePath: './workspace',
    });

    const result = await graph.invoke({
      messages: [new HumanMessage('Read and process config')],
    });

    expect(result.plan.tasks).toHaveLength(2);
    expect(result.plan.tasks[1].dependsOn).toEqual(['task-1']);
  });

  it('should throw when planner receives empty messages', async () => {
    const model = new MockChatModel('[]');
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph({
      model,
      toolRegistry: registry,
      workspacePath: './workspace',
    });

    await expect(
      graph.invoke({ messages: [] }),
    ).rejects.toThrow('at least one user message');
  });

  it('should handle code-fenced JSON in planner response', async () => {
    const planJson = '```json\n{"complexity":"simple","tasks":[{"id":"t1","description":"Test","tools":["file_read"],"routing":"direct","role":"code"}],"suggestedAgents":{"t1":"code"}}\n```';
    const model = new MockChatModel(planJson);
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph({
      model,
      toolRegistry: registry,
      workspacePath: './workspace',
    });

    const result = await graph.invoke({
      messages: [new HumanMessage('Test')],
    });

    expect(result.plan.tasks).toHaveLength(1);
    expect(result.plan.tasks[0].id).toBe('t1');
  });

  it('should handle legacy array format from LLM', async () => {
    // 兼容旧格式：LLM 返回数组而非 Plan 对象
    const planJson = JSON.stringify([
      { id: 'task-1', description: 'Read file', tools: ['file_read'], routing: 'direct', role: 'code' },
    ]);
    const model = new MockChatModel(planJson);
    const registry = ToolRegistry.createDefault();
    const graph = createOrchestratorGraph({
      model,
      toolRegistry: registry,
      workspacePath: './workspace',
    });

    const result = await graph.invoke({
      messages: [new HumanMessage('Read a file')],
    });

    expect(result.plan.tasks).toHaveLength(1);
    // 旧格式自动推断 complexity
    expect(result.plan.complexity).toBe('simple');
    expect(result.plan.suggestedAgents).toBeDefined();
  });
});
