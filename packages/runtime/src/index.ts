/**
 * @code-agent/runtime —— 应用层
 */

export {
  AgentSession,
  SessionBusyError,
} from "./session/agent-session.js";
export type {
  AgentSessionOptions,
  RunHandle,
  RunOptions,
} from "./session/agent-session.js";
export { EventChannel } from "./session/event-channel.js";
export type { EventChannelOptions } from "./session/event-channel.js";
export { PlanState } from "./session/plan-state.js";
export { TitleService } from "./session/title-service.js";
export type { TitleServiceOptions } from "./session/title-service.js";
export { UserQuestionService } from "./session/user-question-service.js";
export type {
  AskUserInput,
  UserQuestionServiceOptions,
} from "./session/user-question-service.js";
export { ApprovalService } from "./approval/approval-service.js";
export type {
  ApprovalRequestInput,
  ApprovalServiceOptions,
} from "./approval/approval-service.js";
export { AgentPool } from "./agents/agent-pool.js";
export type { AgentPoolOptions, PoolTaskInput } from "./agents/agent-pool.js";
export { DelegationService } from "./agents/delegation-service.js";
export type {
  DelegationInput,
  DelegationServiceOptions,
} from "./agents/delegation-service.js";
export { RoleRegistry } from "./agents/role-registry.js";
export {
  BUILTIN_ROLES,
  CODE_ROLE,
  TEST_ROLE,
  DOC_ROLE,
  REVIEW_ROLE,
} from "./agents/roles/index.js";
export { Semaphore } from "./agents/semaphore.js";
export {
  createRuntime,
} from "./factory.js";
export type {
  CreateSessionInput,
  RecoveryReport,
  Runtime,
  RuntimeHarness,
  RuntimeOptions,
} from "./factory.js";
export {
  InMemoryEventLog,
  InMemoryRunStore,
  InMemorySessionStore,
  SystemClock,
  UuidIdGenerator,
  createInMemoryPorts,
} from "./ports/in-memory.js";
export type {
  Clock,
  CreateRunInput,
  CreateSessionInput as PortCreateSessionInput,
  EventLog,
  IdGenerator,
  RunPatch,
  RunStore,
  RuntimePorts,
  SessionStore,
} from "./ports/types.js";
