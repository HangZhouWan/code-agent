/**
 * AgentRole —— Agent 角色定义
 *
 * 定义 Agent 的身份、能力和订阅关系。
 * 每个 Agent 实例绑定一个角色，角色决定了：
 * - 它能处理哪些 Command（commandSubscriptions）
 * - 它关心哪些 Event（eventSubscriptions）
 * - 它能使用哪些工具（defaultTools）
 * - 它能否委托子任务给其他 Agent（canDelegate）
 */

/**
 * Agent 角色定义
 *
 * 角色是 Agent 的"职位描述"——它定义了 Agent 的身份、
 * 系统提示、订阅主题和权限边界。
 */
export interface AgentRole {
  /** 角色唯一标识，如 'code'、'test'、'doc' */
  id: string;

  /** 显示名称，如 'Code Agent' */
  name: string;

  /**
   * 自然语言描述
   *
   * 对其他 Agent 可见，帮助他们决定是否将任务委托给此角色。
   * 在 Dispatcher 选择 Agent 时也会用到。
   */
  description: string;

  /** 系统提示 —— 注入到每次 LLM 调用的 System Prompt 中 */
  systemPrompt: string;

  /**
   * 订阅的 Command 主题
   *
   * 这个角色能处理的任务类型。当 EventBus 上发布匹配的
   * agent.command.* 消息时，此角色的 Agent 会尝试领取。
   */
  commandSubscriptions: string[];

  /**
   * 关注的 Event 主题
   *
   * 这个角色关心哪些事件发生（只观察，不直接响应）。
   * 例如 Test Agent 关注 code_changed 以便自动跑测试。
   */
  eventSubscriptions: string[];

  /** 默认允许的工具列表（工具名称数组） */
  defaultTools: string[];

  /** 能否派发子任务给其他 Agent */
  canDelegate: boolean;

  /** 可以委托给哪些角色（角色 ID 数组，空数组表示不可委托） */
  delegatableRoles: string[];
}

// ─────────────────────────────────────────────
// 内置角色
// ─────────────────────────────────────────────

import { CODE_AGENT_ROLE } from './roles/code.js';
import { TEST_AGENT_ROLE } from './roles/test.js';
import { DOC_AGENT_ROLE } from './roles/doc.js';

/**
 * 内置角色定义
 *
 * 系统预置三个角色：Code Agent、Test Agent、Doc Agent。
 * 具体定义见 packages/core/src/agent/roles/ 目录。
 * 可通过 AgentRegistry.registerRole() 注册自定义角色。
 */
export const BUILTIN_ROLES: AgentRole[] = [
  CODE_AGENT_ROLE,
  TEST_AGENT_ROLE,
  DOC_AGENT_ROLE,
];
