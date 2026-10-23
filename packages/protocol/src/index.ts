/**
 * @code-agent/protocol —— 跨包契约
 *
 * 此包必须浏览器安全：不能导入 node:*，不能依赖其他 workspace 包。
 */

// JSON 基础类型
export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  JsonArray,
  IsoTimestamp,
} from "./json.js";
export { isJsonValue } from "./json.js";

// ID
export type {
  SessionId,
  RunId,
  TaskId,
  CallId,
  AgentId,
  AgentRunId,
  QuestionId,
  MemoryId,
  WorkspaceId,
} from "./ids.js";
export {
  asSessionId,
  asRunId,
  asTaskId,
  asCallId,
  asAgentId,
  asAgentRunId,
  asQuestionId,
  asMemoryId,
  asWorkspaceId,
} from "./ids.js";

// 错误
export type { ErrorCode, SerializedError, ApiError } from "./errors.js";
export {
  ERROR_CODES,
  isSerializedError,
  serializeError,
  abortError,
} from "./errors.js";

// 配置
export type { ProviderId, ProviderDefinition } from "./config/providers.js";
export {
  PROVIDER_IDS,
  PROVIDER_DEFINITIONS,
  DEFAULT_PROVIDER_ID,
  isProviderId,
  getProviderDefinition,
  getDefaultModel,
  getDefaultModelWindow,
} from "./config/providers.js";
export type {
  LlmConfig,
  LlmOverrides,
  ContextConfig,
  AppConfig,
  GlobalConfig,
} from "./config/schema.js";
export {
  providerIdSchema,
  llmConfigSchema,
  globalConfigSchema,
  llmOverridesSchema,
  contextConfigSchema,
  appConfigSchema,
  parseLlmConfig,
  safeParseLlmConfig,
} from "./config/schema.js";

// Domain
export type {
  AgentRoleId,
  BuiltinAgentRoleId,
  RoleDefinition,
} from "./domain/role.js";
export { BUILTIN_AGENT_ROLE_IDS } from "./domain/role.js";

export type { TaskStatus, TaskRouting, SubTask, Plan } from "./domain/plan.js";
export { TASK_STATUSES } from "./domain/plan.js";

export type {
  FileChangeType,
  FileChange,
  CommitRecord,
  TestResult,
  ReviewSeverity,
  ReviewFinding,
  TaskArtifacts,
  TaskResultStatus,
  TaskResult,
  TaskRecord,
  ArtifactType,
  Artifact,
} from "./domain/task.js";

export type {
  MessageRole,
  ToolCallStatus,
  ToolCallRecord,
  ChatMessage,
  SerializedMessage,
} from "./domain/message.js";
export { MESSAGE_ROLES } from "./domain/message.js";

export type {
  RunStatus,
  SessionSummary,
  RunSummary,
  AgentActivity,
  SessionSnapshot,
  UserTurnInput,
  RunUsage,
  RunResult,
} from "./domain/session.js";
export { RUN_STATUSES } from "./domain/session.js";

export type {
  ApprovalDecision,
  ApprovalKind,
  ApprovalRequest,
  ApprovalResolution,
  ProposalEffort,
  ProposalChangePoint,
  CodeProposal,
  PlanProposalSet,
  UserQuestion,
  UserAnswer,
} from "./domain/interaction.js";

export type {
  WorkspaceEntryType,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceDiff,
  GitFileStatusCode,
  GitFileStatus,
} from "./domain/workspace.js";

export type {
  MemoryScope,
  MemoryKind,
  MemoryStatus,
  MemorySource,
  MemoryRecord,
  MemoryOp,
  MemoryQuery,
  RunDigest,
} from "./domain/memory.js";

// Event Bus
export type {
  AgentCommandTopic,
  AgentCommandPayload,
  CommandTopicMap,
  CommandTopic,
  CommandPayload,
  TaskStartedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskBlockedEvent,
  CheckpointSavedEvent,
  MemoryUpdatedEvent,
  EventTopicMap,
  EventTopic,
  EventPayload,
} from "./events/catalog.js";
export { agentCommandTopic } from "./events/catalog.js";

export type {
  BusMeta,
  BusEnvelope,
  RequestOptions,
  Unsubscribe,
  BusHandler,
} from "./events/bus.js";

export type {
  SessionEvent,
  SessionEventType,
  EventEnvelope,
  SessionEventSink,
} from "./events/session-events.js";
export { SESSION_EVENT_TYPES } from "./events/session-events.js";

// Wire
export {
  isoTimestampSchema,
  jsonValueSchema,
  errorCodeSchema,
  serializedErrorSchema,
  sessionEventTypeSchema,
} from "./wire/schema.js";
export type { ClientWsMessage, ServerWsMessage } from "./wire/ws.js";
export {
  clientWsMessageSchema,
  eventEnvelopeSchema,
  serverWsMessageSchema,
} from "./wire/ws.js";
export {
  parseClientWsMessage,
  safeParseClientWsMessage,
  parseServerWsMessage,
  safeParseServerWsMessage,
} from "./wire/parse.js";

export type {
  ApiErrorResponse,
  SessionListResponse,
  SessionHistoryResponse,
  CreateSessionRequest,
  UpdateSessionTitleRequest,
  ConfigStatusResponse,
  SaveConfigRequest,
  SaveConfigResponse,
  ProvidersResponse,
  AgentStatusResponse,
  RunListResponse,
  WorkspaceTreeResponse,
  WorkspaceFileResponse,
  WorkspaceDiffResponse,
  GitStatusResponse,
  MemoryListResponse,
  MemoryOpsRequest,
  MemoryOpsResponse,
} from "./wire/rest.js";
