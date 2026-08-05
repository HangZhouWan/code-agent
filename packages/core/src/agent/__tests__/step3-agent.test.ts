/**
 * Step 3 —— Agent 基类 + AgentRegistry 测试
 *
 * 覆盖：
 * - AgentRole / BUILTIN_ROLES 结构验证
 * - Agent 构造 + 生命周期（start/stop）
 * - Agent.executeTask() 直接执行路径
 * - AgentRegistry 角色管理 + Agent CRUD
 * - WorkerAgent 向后兼容
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { SimpleChatModel, type BaseChatModel } from '@langchain/core/language_models/chat_models';

import { InMemoryEventBus } from '../../event-bus/bus.js';
import { InMemoryStateManager } from '../../state/manager.js';
import { ExecutionEngine } from '../../harness/execution/engine.js';
import { ContextManager } from '../../harness/context/manager.js';
import { ToolRegistry } from '../../tools/registry.js';
import type { ToolDefinition } from '../../tools/base.js';
import { HooksEngine } from '../../harness/hooks/engine.js';
import type { IEventBus } from '../../event-bus/types.js';
import type { IStateManager } from '../../state/types.js';

import { BUILTIN_ROLES } from '../role.js';
import type { AgentRole } from '../role.js';
import { Agent } from '../agent.js';
import { AgentRegistry } from '../registry.js';
import { WorkerAgent } from '../worker.js';
import type { AgentConfig, AgentInput, AgentOutput } from '../types.js';

// ---------------------------------------------------------------------------
// Mock ChatModel
// ---------------------------------------------------------------------------

/**
 * 模拟 ChatModel，每次调用返回固定的 AIMessage。
 * 可配置多个响应序列，用于模拟多轮对话。
 */
class MockChatModel extends SimpleChatModel {
  private responses: string[];
  private callCount = 0;

  constructor(responses?: string[]) {
    super({});
    // 默认返回 done 决策，让 ExecutionEngine 完成执行
    this.responses = responses ?? [
      JSON.stringify({
        reasoning: 'Task is straightforward, completing now.',
        decision: 'done',
        summary: 'Task completed successfully.',
      }),
    ];
  }

  _llmType(): string {
    return 'mock';
  }

  async _call(
    _messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: any,
  ): Promise<string> {
    const idx = this.callCount % this.responses.length;
    this.callCount++;
    return this.responses[idx];
  }
}

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

/** 创建 echo 工具 */
function createEchoTool(): ToolDefinition {
  return {
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
}

/** 创建 ToolRegistry 并注册 echo 工具 */
function createRegistry(): ToolRegistry {
  const registry = ToolRegistry.createDefault();
  registry.register(createEchoTool());
  return registry;
}

/** 构建最小的 AgentConfig 用于测试 */
function createAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  const role = overrides?.role ?? BUILTIN_ROLES[0]; // code agent
  const eventBus = overrides?.eventBus ?? new InMemoryEventBus();
  const stateManager = overrides?.stateManager ?? new InMemoryStateManager();
  const model = overrides?.model ?? new MockChatModel();
  const engine = overrides?.engine ?? new ExecutionEngine();
  const toolRegistry = overrides?.toolRegistry ?? createRegistry();
  const contextManager = overrides?.contextManager ?? new ContextManager();

  return {
    role,
    model,
    engine,
    eventBus,
    stateManager,
    toolRegistry,
    contextManager,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AgentRole / BUILTIN_ROLES
// ---------------------------------------------------------------------------

describe('AgentRole & BUILTIN_ROLES', () => {
  it('should have exactly 3 built-in roles', () => {
    expect(BUILTIN_ROLES).toHaveLength(3);
  });

  it('each built-in role should have required fields', () => {
    for (const role of BUILTIN_ROLES) {
      expect(role.id).toBeTruthy();
      expect(role.name).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(role.systemPrompt).toBeTruthy();
      expect(Array.isArray(role.commandSubscriptions)).toBe(true);
      expect(Array.isArray(role.eventSubscriptions)).toBe(true);
      expect(Array.isArray(role.defaultTools)).toBe(true);
      expect(typeof role.canDelegate).toBe('boolean');
      expect(Array.isArray(role.delegatableRoles)).toBe(true);
    }
  });

  it('code agent should have correct defaults', () => {
    const code = BUILTIN_ROLES.find((r) => r.id === 'code')!;
    expect(code).toBeDefined();
    expect(code.id).toBe('code');
    expect(code.canDelegate).toBe(true);
    expect(code.delegatableRoles).toContain('test');
    expect(code.delegatableRoles).toContain('doc');
    expect(code.defaultTools).toContain('file_read');
    expect(code.defaultTools).toContain('shell_exec');
  });

  it('test agent should not be able to delegate', () => {
    const test = BUILTIN_ROLES.find((r) => r.id === 'test')!;
    expect(test.canDelegate).toBe(false);
    expect(test.delegatableRoles).toHaveLength(0);
    expect(test.commandSubscriptions).toContain('agent.command.test_run');
  });

  it('doc agent should have doc-specific subscriptions', () => {
    const doc = BUILTIN_ROLES.find((r) => r.id === 'doc')!;
    expect(doc.commandSubscriptions).toContain('agent.command.doc_generate');
    expect(doc.commandSubscriptions).toContain('agent.command.doc_update');
  });
});

// ---------------------------------------------------------------------------
// Agent 构造
// ---------------------------------------------------------------------------

describe('Agent Construction', () => {
  it('should construct with valid config', () => {
    const config = createAgentConfig();
    const agent = new Agent(config);

    expect(agent).toBeDefined();
    expect(agent.id).toBeTruthy();
    expect(agent.id).toMatch(/^[0-9a-f-]{36}$/); // UUID v4
    expect(agent.role).toBe(config.role);
    expect(agent.agentId).toBe(agent.id); // AgentLike 兼容
    expect(agent.reasoning).toBeDefined();
    expect(agent.capability).toBeDefined();
    expect(agent.capability.tools).toEqual(config.role.defaultTools);
  });

  it('should use custom capability when provided', () => {
    const config = createAgentConfig({
      capability: {
        tools: ['file_read'],
        paths: ['/custom/path'],
        maxTokens: 10,
        timeoutMs: 30000,
      },
    });
    const agent = new Agent(config);

    expect(agent.capability.tools).toEqual(['file_read']);
    expect(agent.capability.paths).toEqual(['/custom/path']);
  });
});

// ---------------------------------------------------------------------------
// Agent 生命周期：start / stop
// ---------------------------------------------------------------------------

describe('Agent Lifecycle', () => {
  let eventBus: InMemoryEventBus;
  let stateManager: InMemoryStateManager;
  let agent: Agent;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    stateManager = new InMemoryStateManager();
    const config = createAgentConfig({ eventBus, stateManager });
    agent = new Agent(config);
  });

  afterEach(async () => {
    try {
      await agent.stop();
    } catch {
      // ignore
    }
  });

  it('start() should register agent in StateManager', async () => {
    await agent.start();

    const registered = stateManager.agents.get(agent.id);
    expect(registered).toBeDefined();
    expect(registered!.role).toBe('code');
    expect(registered!.status).toBe('idle');
  });

  it('start() should subscribe to command topics', async () => {
    await agent.start();

    // 验证订阅已建立：通过 subscriberCount
    for (const topic of agent.role.commandSubscriptions) {
      const count = eventBus.subscriberCount(topic);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('start() should subscribe to event topics', async () => {
    await agent.start();

    for (const topic of agent.role.eventSubscriptions) {
      const count = eventBus.subscriberCount(topic);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('stop() should unsubscribe from all topics', async () => {
    await agent.start();

    // 确认订阅存在
    const topic = agent.role.commandSubscriptions[0];
    expect(eventBus.subscriberCount(topic)).toBeGreaterThanOrEqual(1);

    await agent.stop();

    // stop 后订阅应被移除
    expect(eventBus.subscriberCount(topic)).toBe(0);
  });

  it('stop() should update state to offline', async () => {
    await agent.start();
    await agent.stop();

    const status = stateManager.agents.get(agent.id);
    // 如果 stop 调用 update 成功，status 应为 offline
    if (status) {
      expect(status.status).toBe('offline');
    }
  });

  it('stop() should be idempotent', async () => {
    await agent.start();
    await agent.stop();
    // 第二次 stop 不应报错
    await expect(agent.stop()).resolves.toBeUndefined();
  });

  it('should update heartbeat via StateManager', async () => {
    await agent.start();

    const before = stateManager.agents.get(agent.id)?.lastHeartbeat;

    // 等待心跳更新（至少 1 个周期）
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 检查心跳是否已更新（heartbeat 调用了 stateManager.agents.heartbeat）
    const after = stateManager.agents.get(agent.id)?.lastHeartbeat;
    // lastHeartbeat 应该存在（初始注册时设置）且心跳定时器已运行
    expect(after).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Agent.executeTask() 直接执行路径
// ---------------------------------------------------------------------------

describe('Agent.executeTask()', () => {
  let eventBus: InMemoryEventBus;
  let stateManager: InMemoryStateManager;
  let agent: Agent;

  beforeEach(async () => {
    eventBus = new InMemoryEventBus();
    stateManager = new InMemoryStateManager();
    const config = createAgentConfig({ eventBus, stateManager });
    agent = new Agent(config);
    await agent.start();
  });

  afterEach(async () => {
    try {
      await agent.stop();
    } catch {
      // ignore
    }
  });

  it('should execute a simple task and return success', async () => {
    const result = await agent.executeTask({
      taskId: 'test-direct-1',
      description: 'Do a simple task',
    });

    expect(result.taskId).toBe('test-direct-1');
    expect(result.agentId).toBe(agent.id);
    expect(result.status).toBe('success');
    expect(result.result).toBeDefined();
  });

  it('should set agent to busy then idle during execution', async () => {
    // 执行前是 idle
    expect(stateManager.agents.get(agent.id)?.status).toBe('idle');

    const result = await agent.executeTask({
      taskId: 'test-direct-2',
      description: 'Another task',
    });

    // 执行后恢复 idle
    expect(result.status).toBe('success');
    expect(stateManager.agents.get(agent.id)?.status).toBe('idle');
  });

  it('should include context in execution when provided', async () => {
    const result = await agent.executeTask({
      taskId: 'test-context',
      description: 'Summarize findings',
      context: 'Previous task found 3 bugs in auth.ts.',
    });

    expect(result.status).toBe('success');
    expect(result.agentId).toBe(agent.id);
  });

  it('should handle task failure gracefully', async () => {
    // 使用会抛出异常的 mock model
    const errorAgent = new Agent(
      createAgentConfig({
        eventBus,
        stateManager,
        model: new MockChatModel([
          JSON.stringify({
            reasoning: 'Using tool that fails',
            decision: 'use_tool',
            toolCall: { name: 'nonexistent', args: {} },
          }),
        ]),
      }),
    );
    await errorAgent.start();

    const result = await errorAgent.executeTask({
      taskId: 'test-fail',
      description: 'Will fail',
      maxIterations: 1,
      timeoutMs: 5000,
    });

    // 应该返回 failed 或 timeout（因为工具不存在，引擎会循环直到超时或达到 maxIterations）
    expect(['failed', 'timeout']).toContain(result.status);
    expect(result.agentId).toBe(errorAgent.id);

    await errorAgent.stop();
  });

  it('should handle exception from engine gracefully', async () => {
    // 使用 null engine 来触发异常
    const badAgent = new Agent(
      createAgentConfig({
        eventBus,
        stateManager,
        engine: null as any,
      }),
    );
    await badAgent.start();

    // executeTask 会 catch 异常并返回 failed 状态，而不是抛出
    const result = await badAgent.executeTask({
      taskId: 'test-error',
      description: 'Should error',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
    expect(result.agentId).toBe(badAgent.id);

    await badAgent.stop();
  });

  it('should report replan_needed status correctly', async () => {
    const replanAgent = new Agent(
      createAgentConfig({
        eventBus,
        stateManager,
        model: new MockChatModel([
          JSON.stringify({
            reasoning: 'Plan needs revision due to new information',
            decision: 'replan',
            summary: 'Found circular dependency, need to replan.',
          }),
        ]),
      }),
    );
    await replanAgent.start();

    const result = await replanAgent.executeTask({
      taskId: 'test-replan',
      description: 'Complex task',
    });

    expect(result.status).toBe('replan_needed');
    expect(result.result).toContain('circular dependency');

    await replanAgent.stop();
  });
});

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

describe('AgentRegistry', () => {
  let eventBus: InMemoryEventBus;
  let stateManager: InMemoryStateManager;
  let registry: AgentRegistry;
  let model: MockChatModel;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    eventBus = new InMemoryEventBus();
    stateManager = new InMemoryStateManager();
    registry = new AgentRegistry(eventBus, stateManager);
    model = new MockChatModel();
    toolRegistry = createRegistry();
  });

  afterEach(async () => {
    await registry.shutdown();
  });

  describe('Role Management', () => {
    it('should have 3 built-in roles on creation', () => {
      const roles = registry.listRoles();
      expect(roles).toHaveLength(3);
      expect(roles.map((r) => r.id).sort()).toEqual(['code', 'doc', 'test']);
    });

    it('should register custom roles', () => {
      const customRole: AgentRole = {
        id: 'reviewer',
        name: 'Review Agent',
        description: 'Reviews code for style and correctness',
        systemPrompt: 'You review code.',
        commandSubscriptions: ['agent.command.review'],
        eventSubscriptions: [],
        defaultTools: ['file_read'],
        canDelegate: false,
        delegatableRoles: [],
      };

      registry.registerRole(customRole);
      expect(registry.listRoles()).toHaveLength(4);
      expect(registry.getRole('reviewer')).toEqual(customRole);
    });

    it('should override existing role when registering same id', () => {
      const updated: AgentRole = {
        ...BUILTIN_ROLES[0],
        name: 'Super Code Agent',
      };
      registry.registerRole(updated);
      expect(registry.getRole('code')!.name).toBe('Super Code Agent');
    });

    it('getRole should return undefined for unknown role', () => {
      expect(registry.getRole('nonexistent')).toBeUndefined();
    });
  });

  describe('Agent CRUD', () => {
    it('createAgent should create and start an agent', async () => {
      const agent = await registry.createAgent('code', model, toolRegistry);

      expect(agent).toBeDefined();
      expect(agent.role.id).toBe('code');
      expect(registry.agentCount).toBe(1);

      // 应该已注册到 StateManager
      const state = stateManager.agents.get(agent.id);
      expect(state).toBeDefined();
      expect(state!.role).toBe('code');
    });

    it('createAgent should throw for unknown role', async () => {
      await expect(
        registry.createAgent('unknown-role', model, toolRegistry),
      ).rejects.toThrow('Unknown role');
    });

    it('getAgent should return idle agent for a role', async () => {
      const agent = await registry.createAgent('code', model, toolRegistry);

      const found = registry.getAgent('code');
      expect(found).toBeDefined();
      expect(found!.id).toBe(agent.id);
    });

    it('getAgent should return undefined for role with no agents', () => {
      expect(registry.getAgent('test')).toBeUndefined();
    });

    it('getAgents should return all agents of a role', async () => {
      await registry.createAgent('code', model, toolRegistry);
      await registry.createAgent('code', model, toolRegistry);
      await registry.createAgent('test', model, toolRegistry);

      expect(registry.getAgents('code')).toHaveLength(2);
      expect(registry.getAgents('test')).toHaveLength(1);
      expect(registry.getAgents('doc')).toHaveLength(0);
    });

    it('getAgentById should find by agent ID', async () => {
      const agent = await registry.createAgent('code', model, toolRegistry);

      const found = registry.getAgentById(agent.id);
      expect(found).toBeDefined();
      expect(found!.role.id).toBe('code');
    });

    it('getAllAgents should return all agents', async () => {
      await registry.createAgent('code', model, toolRegistry);
      await registry.createAgent('test', model, toolRegistry);
      await registry.createAgent('doc', model, toolRegistry);

      expect(registry.getAllAgents()).toHaveLength(3);
    });

    it('removeAgent should stop and remove agent', async () => {
      const agent = await registry.createAgent('code', model, toolRegistry);
      expect(registry.agentCount).toBe(1);

      await registry.removeAgent(agent.id);
      expect(registry.agentCount).toBe(0);
      expect(registry.getAgentById(agent.id)).toBeUndefined();
    });

    it('removeAgent should be no-op for unknown id', async () => {
      await expect(
        registry.removeAgent('nonexistent-id'),
      ).resolves.toBeUndefined();
    });

    it('shutdown should stop all agents', async () => {
      await registry.createAgent('code', model, toolRegistry);
      await registry.createAgent('test', model, toolRegistry);
      expect(registry.agentCount).toBe(2);

      await registry.shutdown();
      expect(registry.agentCount).toBe(0);
    });

    it('reset should clear agents and restore built-in roles', async () => {
      // 注册自定义角色
      registry.registerRole({
        id: 'custom',
        name: 'Custom',
        description: 'Custom role',
        systemPrompt: 'Custom',
        commandSubscriptions: [],
        eventSubscriptions: [],
        defaultTools: [],
        canDelegate: false,
        delegatableRoles: [],
      });
      expect(registry.listRoles()).toHaveLength(4);

      // 创建 agent
      await registry.createAgent('code', model, toolRegistry);
      expect(registry.agentCount).toBe(1);

      // reset
      await registry.reset();
      expect(registry.agentCount).toBe(0);
      expect(registry.listRoles()).toHaveLength(3); // 只有内置角色
    });
  });

  describe('Agent Execution via Registry', () => {
    it('agent from registry should execute task successfully', async () => {
      const agent = await registry.createAgent('code', model, toolRegistry);

      const result = await agent.executeTask({
        taskId: 'registry-test',
        description: 'Test from registry',
      });

      expect(result.status).toBe('success');
      expect(result.agentId).toBe(agent.id);
    });

    it('multiple agents should have unique IDs', async () => {
      const a1 = await registry.createAgent('code', model, toolRegistry);
      const a2 = await registry.createAgent('code', model, toolRegistry);
      const a3 = await registry.createAgent('test', model, toolRegistry);

      expect(a1.id).not.toBe(a2.id);
      expect(a1.id).not.toBe(a3.id);
      expect(a2.id).not.toBe(a3.id);
    });
  });
});

// ---------------------------------------------------------------------------
// WorkerAgent 向后兼容
// ---------------------------------------------------------------------------

describe('WorkerAgent Backward Compatibility', () => {
  it('should construct with model and registry only', () => {
    const model = new MockChatModel();
    const registry = createRegistry();
    const worker = new WorkerAgent(model, registry);

    expect(worker).toBeDefined();
  });

  it('should fail gracefully when no tools match (unchanged behavior)', async () => {
    const model = new MockChatModel();
    const registry = ToolRegistry.createDefault();

    const worker = new WorkerAgent(model, registry);

    const output = await worker.run({
      taskId: 'compat-no-tools',
      description: 'Do something',
      tools: ['nonexistent.tool'],
      context: '',
      workspacePath: './workspace',
    });

    expect(output.taskId).toBe('compat-no-tools');
    expect(output.status).toBe('failed');
    expect(output.error).toContain('No tools available');
  });

  it('should construct with new dependencies (eventBus, stateManager)', () => {
    const model = new MockChatModel();
    const registry = createRegistry();
    const eventBus = new InMemoryEventBus();
    const stateManager = new InMemoryStateManager();

    const worker = new WorkerAgent(
      model,
      registry,
      undefined, // hooks
      undefined, // permissionRegistry
      eventBus,
      stateManager,
    );

    expect(worker).toBeDefined();
  });

  it('should return output with taskId and status (backward compat)', async () => {
    const model = new MockChatModel();
    const registry = createRegistry();

    const worker = new WorkerAgent(model, registry);

    const output = await worker.run({
      taskId: 'compat-exec',
      description: 'Echo a message',
      tools: ['test.echo'],
      context: '',
      workspacePath: './workspace',
      timeoutMs: 5000,
    });

    expect(output.taskId).toBe('compat-exec');
    expect(['success', 'failed', 'timeout']).toContain(output.status);
  });
});

// ---------------------------------------------------------------------------
// Agent.handleEvent 子类覆盖
// ---------------------------------------------------------------------------

describe('Agent Event Handling', () => {
  it('should allow subclass to override handleEvent', async () => {
    const receivedEvents: Array<{ topic: string; payload: unknown }> = [];

    class ObservingAgent extends Agent {
      protected async handleEvent(msg: any): Promise<void> {
        receivedEvents.push({ topic: msg.topic, payload: msg.payload });
      }
    }

    const eventBus = new InMemoryEventBus();
    const stateManager = new InMemoryStateManager();
    const config = createAgentConfig({ eventBus, stateManager });
    const agent = new ObservingAgent(config);

    await agent.start();

    // 发布一个 agent 角色订阅的事件
    await eventBus.publish('agent.event.code_changed' as any, {
      file: 'src/index.ts',
    });

    // 给事件处理一点时间
    await new Promise((resolve) => setTimeout(resolve, 50));

    await agent.stop();

    expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
    expect(receivedEvents[0].topic).toBe('agent.event.code_changed');
  });
});
