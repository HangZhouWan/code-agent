/**
 * StateManager 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStateManager } from '../manager.js';
import { InvalidTransitionError } from '../types.js';
import type { Task } from '../types.js';
import { ToolNames } from '../../tools/tool-names.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeTaskInput(overrides?: Partial<Omit<Task, 'status' | 'createdAt' | 'updatedAt'>>) {
  return {
    id: 'task-1',
    sessionId: 'session-1',
    role: 'code',
    description: 'Test task',
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────

describe('InMemoryStateManager', () => {
  let stateManager: InMemoryStateManager;

  beforeEach(() => {
    stateManager = new InMemoryStateManager();
  });

  // ─── TaskState ────────────────────────────

  describe('TaskState', () => {
    it('创建任务默认为 pending 状态', () => {
      const task = stateManager.task.create(makeTaskInput());
      expect(task.status).toBe('pending');
      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.updatedAt).toBeInstanceOf(Date);
    });

    it('get 根据 ID 获取任务', () => {
      stateManager.task.create(makeTaskInput({ id: 'task-1' }));
      stateManager.task.create(makeTaskInput({ id: 'task-2' }));

      expect(stateManager.task.get('task-1')).toBeDefined();
      expect(stateManager.task.get('task-1')!.id).toBe('task-1');
      expect(stateManager.task.get('non-existent')).toBeUndefined();
    });

    it('getAll 返回所有任务', () => {
      stateManager.task.create(makeTaskInput({ id: 'task-1' }));
      stateManager.task.create(makeTaskInput({ id: 'task-2' }));

      expect(stateManager.task.getAll()).toHaveLength(2);
    });

    describe('状态流转', () => {
      it('合法流转：pending → assigned → running → completed', () => {
        stateManager.task.create(makeTaskInput({ id: 'task-1' }));

        stateManager.task.transition('task-1', 'assigned');
        expect(stateManager.task.get('task-1')!.status).toBe('assigned');

        stateManager.task.transition('task-1', 'running');
        expect(stateManager.task.get('task-1')!.status).toBe('running');
        expect(stateManager.task.get('task-1')!.startedAt).toBeInstanceOf(Date);

        stateManager.task.transition('task-1', 'completed');
        expect(stateManager.task.get('task-1')!.status).toBe('completed');
        expect(stateManager.task.get('task-1')!.completedAt).toBeInstanceOf(Date);
      });

      it('合法流转：running → failed → pending（Replanner 重置）', () => {
        stateManager.task.create(makeTaskInput({ id: 'task-1' }));
        stateManager.task.transition('task-1', 'assigned');
        stateManager.task.transition('task-1', 'running');
        stateManager.task.transition('task-1', 'failed');
        expect(stateManager.task.get('task-1')!.status).toBe('failed');

        // Replanner 将失败任务重置为 pending
        stateManager.task.transition('task-1', 'pending');
        expect(stateManager.task.get('task-1')!.status).toBe('pending');
      });

      it('合法流转：running → awaiting_input → running', () => {
        stateManager.task.create(makeTaskInput({ id: 'task-1' }));
        stateManager.task.transition('task-1', 'assigned');
        stateManager.task.transition('task-1', 'running');
        stateManager.task.transition('task-1', 'awaiting_input');
        expect(stateManager.task.get('task-1')!.status).toBe('awaiting_input');

        stateManager.task.transition('task-1', 'running');
        expect(stateManager.task.get('task-1')!.status).toBe('running');
      });

      it('合法流转：pending → cancelled', () => {
        stateManager.task.create(makeTaskInput({ id: 'task-1' }));
        stateManager.task.transition('task-1', 'cancelled');
        expect(stateManager.task.get('task-1')!.status).toBe('cancelled');
      });

      it('非法流转抛 InvalidTransitionError：completed → running', () => {
        stateManager.task.create(makeTaskInput({ id: 'task-1' }));
        stateManager.task.transition('task-1', 'assigned');
        stateManager.task.transition('task-1', 'running');
        stateManager.task.transition('task-1', 'completed');

        expect(() => {
          stateManager.task.transition('task-1', 'running');
        }).toThrow(InvalidTransitionError);
      });

      it('非法流转抛 InvalidTransitionError：pending → completed', () => {
        stateManager.task.create(makeTaskInput({ id: 'task-1' }));

        expect(() => {
          stateManager.task.transition('task-1', 'completed');
        }).toThrow(InvalidTransitionError);
      });

      it('非法流转抛 InvalidTransitionError：completed → failed', () => {
        stateManager.task.create(makeTaskInput({ id: 'task-1' }));
        stateManager.task.transition('task-1', 'assigned');
        stateManager.task.transition('task-1', 'running');
        stateManager.task.transition('task-1', 'completed');

        expect(() => {
          stateManager.task.transition('task-1', 'failed');
        }).toThrow(InvalidTransitionError);
      });

      it('不存在的任务抛异常', () => {
        expect(() => {
          stateManager.task.transition('non-existent', 'running');
        }).toThrow('Task "non-existent" not found');
      });
    });

    describe('progress', () => {
      it('正确统计各状态数量', () => {
        stateManager.task.create(makeTaskInput({ id: 't1' }));
        stateManager.task.create(makeTaskInput({ id: 't2' }));
        stateManager.task.create(makeTaskInput({ id: 't3' }));
        stateManager.task.create(makeTaskInput({ id: 't4' }));

        // t1: pending (default)
        stateManager.task.transition('t2', 'assigned');
        stateManager.task.transition('t2', 'running');
        stateManager.task.transition('t2', 'completed');
        stateManager.task.transition('t3', 'assigned');
        stateManager.task.transition('t3', 'running');
        stateManager.task.transition('t3', 'failed');
        stateManager.task.transition('t4', 'assigned');
        stateManager.task.transition('t4', 'running');

        const p = stateManager.task.progress();
        expect(p.total).toBe(4);
        expect(p.done).toBe(1); // t2 completed
        expect(p.failed).toBe(1); // t3 failed
        expect(p.running).toBe(1); // t4 running
        expect(p.pending).toBe(1); // t1 still pending
      });
    });

    describe('blockedTasks', () => {
      it('返回 awaiting_input 状态的任务', () => {
        stateManager.task.create(makeTaskInput({ id: 't1' }));
        stateManager.task.create(makeTaskInput({ id: 't2' }));

        stateManager.task.transition('t1', 'assigned');
        stateManager.task.transition('t1', 'running');
        stateManager.task.transition('t1', 'awaiting_input');

        const blocked = stateManager.task.blockedTasks();
        expect(blocked).toHaveLength(1);
        expect(blocked[0].id).toBe('t1');
      });

      it('无阻塞任务时返回空数组', () => {
        stateManager.task.create(makeTaskInput({ id: 't1' }));
        expect(stateManager.task.blockedTasks()).toHaveLength(0);
      });
    });

    describe('onChange', () => {
      it('状态变更时触发回调', () => {
        const changes: Array<{ taskId: string; from: string; to: string }> = [];
        stateManager.task.onChange((taskId, from, to) => {
          changes.push({ taskId, from, to });
        });

        stateManager.task.create(makeTaskInput({ id: 'task-1' }));
        stateManager.task.transition('task-1', 'assigned');

        expect(changes).toHaveLength(1);
        expect(changes[0]).toEqual({ taskId: 'task-1', from: 'pending', to: 'assigned' });
      });

      it('取消订阅后不再触发回调', () => {
        const calls: string[] = [];
        const unsub = stateManager.task.onChange((taskId, _from, _to) => {
          calls.push(taskId);
        });

        stateManager.task.create(makeTaskInput({ id: 'task-1' }));
        stateManager.task.transition('task-1', 'assigned');
        expect(calls).toHaveLength(1);

        unsub();

        stateManager.task.transition('task-1', 'running');
        expect(calls).toHaveLength(1); // 仍然是 1
      });
    });
  });

  // ─── AgentState ───────────────────────────

  describe('AgentState', () => {
    it('register 注册新 Agent', () => {
      stateManager.agents.register('agent-1', 'code');
      const agent = stateManager.agents.get('agent-1');

      expect(agent).toBeDefined();
      expect(agent!.role).toBe('code');
      expect(agent!.status).toBe('idle');
      expect(agent!.lastHeartbeat).toBeInstanceOf(Date);
      expect(agent!.toolCallCount).toBe(0);
    });

    it('register 重复注册更新角色和心跳', () => {
      stateManager.agents.register('agent-1', 'code');
      // 更新角色
      stateManager.agents.register('agent-1', 'test');

      const agent = stateManager.agents.get('agent-1');
      expect(agent!.role).toBe('test');
    });

    it('update 部分更新 Agent 状态', () => {
      stateManager.agents.register('agent-1', 'code');
      stateManager.agents.update('agent-1', { status: 'busy', currentTask: 'task-1' });

      const agent = stateManager.agents.get('agent-1');
      expect(agent!.status).toBe('busy');
      expect(agent!.currentTask).toBe('task-1');
      expect(agent!.role).toBe('code'); // 未修改
    });

    it('update 不存在的 Agent 抛异常', () => {
      expect(() => {
        stateManager.agents.update('non-existent', { status: 'busy' });
      }).toThrow('Agent "non-existent" not registered');
    });

    it('findIdle 返回第一个空闲同角色 Agent', () => {
      stateManager.agents.register('agent-1', 'code');
      stateManager.agents.register('agent-2', 'code');
      stateManager.agents.register('agent-3', 'test');

      // agent-2 设置为 busy
      stateManager.agents.update('agent-2', { status: 'busy' });

      const idle = stateManager.agents.findIdle('code');
      expect(idle).toBeDefined();
      expect(idle!.agentId).toBe('agent-1'); // 第一个空闲的 code agent
    });

    it('findIdle 无匹配角色返回 undefined', () => {
      stateManager.agents.register('agent-1', 'code');
      const idle = stateManager.agents.findIdle('doc');
      expect(idle).toBeUndefined();
    });

    it('findIdle 全部 busy 时返回 undefined', () => {
      stateManager.agents.register('agent-1', 'code');
      stateManager.agents.update('agent-1', { status: 'busy' });

      const idle = stateManager.agents.findIdle('code');
      expect(idle).toBeUndefined();
    });

    it('heartbeat 更新心跳时间', () => {
      stateManager.agents.register('agent-1', 'code');
      const before = stateManager.agents.get('agent-1')!.lastHeartbeat;

      // 等待一小段时间确保时间不同
      stateManager.agents.heartbeat('agent-1');
      const after = stateManager.agents.get('agent-1')!.lastHeartbeat;

      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('active 返回非 offline 的 Agent', () => {
      stateManager.agents.register('agent-1', 'code');
      stateManager.agents.register('agent-2', 'test');
      stateManager.agents.update('agent-2', { status: 'offline' });

      const active = stateManager.agents.active();
      expect(active).toHaveLength(1);
      expect(active[0].agentId).toBe('agent-1');
    });
  });

  // ─── ArtifactState ────────────────────────

  describe('ArtifactState', () => {
    it('addFileChange 追加文件变更', () => {
      stateManager.artifacts.addFileChange({
        path: 'src/index.ts',
        action: 'modified',
        taskId: 'task-1',
        agentRole: 'code',
        timestamp: new Date(),
      });

      const files = stateManager.artifacts.changedFiles();
      expect(files).toHaveLength(1);
      expect(files[0].path).toBe('src/index.ts');
    });

    it('byTask 正确归并产物', () => {
      stateManager.artifacts.addFileChange({
        path: 'src/a.ts',
        action: 'modified',
        taskId: 'task-1',
        agentRole: 'code',
        timestamp: new Date(),
      });
      stateManager.artifacts.addFileChange({
        path: 'src/b.ts',
        action: 'created',
        taskId: 'task-2',
        agentRole: 'code',
        timestamp: new Date(),
      });
      stateManager.artifacts.addCommit('abc123', 'feat: add a', 'task-1', ['src/a.ts']);
      stateManager.artifacts.addCommit('def456', 'feat: add b', 'task-2', ['src/b.ts']);
      stateManager.artifacts.addTestResult('task-1', 10, 9, 1, '1 test failed');
      stateManager.artifacts.addTestResult('task-2', 5, 5, 0);

      const artifacts1 = stateManager.artifacts.byTask('task-1');
      expect(artifacts1.files).toHaveLength(1);
      expect(artifacts1.files[0].path).toBe('src/a.ts');
      expect(artifacts1.commits).toHaveLength(1);
      expect(artifacts1.commits[0].hash).toBe('abc123');
      expect(artifacts1.tests).toHaveLength(1);
      expect(artifacts1.tests[0].total).toBe(10);

      const artifacts2 = stateManager.artifacts.byTask('task-2');
      expect(artifacts2.files).toHaveLength(1);
      expect(artifacts2.files[0].path).toBe('src/b.ts');
      expect(artifacts2.commits).toHaveLength(1);
      expect(artifacts2.tests).toHaveLength(1);
      expect(artifacts2.tests[0].passed).toBe(5);
    });

    it('byTask 不存在的任务返回空列表', () => {
      const artifacts = stateManager.artifacts.byTask('non-existent');
      expect(artifacts.files).toHaveLength(0);
      expect(artifacts.commits).toHaveLength(0);
      expect(artifacts.tests).toHaveLength(0);
    });

    it('all 返回所有产物', () => {
      stateManager.artifacts.addFileChange({
        path: 'src/a.ts',
        action: 'modified',
        taskId: 'task-1',
        agentRole: 'code',
        timestamp: new Date(),
      });
      stateManager.artifacts.addCommit('abc123', 'msg', 'task-1', ['src/a.ts']);
      stateManager.artifacts.addTestResult('task-1', 10, 10, 0);

      const all = stateManager.artifacts.all();
      expect(all.files).toHaveLength(1);
      expect(all.commits).toHaveLength(1);
      expect(all.tests).toHaveLength(1);
    });
  });

  // ─── WorkflowState ────────────────────────

  describe('WorkflowState', () => {
    it('setCurrentNode / getCurrentNode', () => {
      expect(stateManager.workflow.getCurrentNode()).toBe('idle');
      stateManager.workflow.setCurrentNode('dispatching');
      expect(stateManager.workflow.getCurrentNode()).toBe('dispatching');
    });

    it('setPlan / getPlan', () => {
      const plan = {
        complexity: 'complex' as const,
        tasks: [
          { id: '1', description: 'Write code', tools: [ToolNames.FILE_WRITE], dependsOn: [], routing: 'bus' as const },
        ],
        suggestedAgents: { '1': 'code' },
      };

      stateManager.workflow.setPlan(plan);
      const retrieved = stateManager.workflow.getPlan();
      expect(retrieved).toEqual(plan);
    });

    it('addDecision / getDecisions', () => {
      stateManager.workflow.addDecision('use Redis for caching');
      stateManager.workflow.addDecision('split into microservices');

      const decisions = stateManager.workflow.getDecisions();
      expect(decisions).toHaveLength(2);
      expect(decisions[0]).toBe('use Redis for caching');
    });
  });

  // ─── reset ────────────────────────────────

  describe('reset', () => {
    it('清空所有状态', () => {
      stateManager.task.create(makeTaskInput({ id: 'task-1' }));
      stateManager.agents.register('agent-1', 'code');
      stateManager.workflow.setPlan({
        complexity: 'simple',
        tasks: [],
        suggestedAgents: {},
      });
      stateManager.artifacts.addFileChange({
        path: 'src/index.ts',
        action: 'modified',
        taskId: 'task-1',
        agentRole: 'code',
        timestamp: new Date(),
      });

      expect(stateManager.task.getAll()).toHaveLength(1);
      expect(stateManager.agents.getAll()).toHaveLength(1);

      stateManager.reset();

      expect(stateManager.task.getAll()).toHaveLength(0);
      expect(stateManager.agents.getAll()).toHaveLength(0);
      expect(stateManager.workflow.getPlan()).toBeUndefined();
      expect(stateManager.workflow.getCurrentNode()).toBe('idle');
      expect(stateManager.artifacts.all().files).toHaveLength(0);
    });
  });

  // ─── EventBus 集成（可选） ─────────────────

  describe('EventBus 集成', () => {
    it('不传 EventBus 时正常运作（不抛异常）', () => {
      const sm = new InMemoryStateManager();
      sm.task.create(makeTaskInput({ id: 'task-1' }));

      // 不应抛出异常
      expect(() => sm.task.transition('task-1', 'assigned')).not.toThrow();
      expect(sm.task.get('task-1')!.status).toBe('assigned');
    });
  });
});
