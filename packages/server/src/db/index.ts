/**
 * @code-agent/server/db —— 数据库层
 *
 * 基于 SQLite + Drizzle ORM 的持久化层，管理会话、消息、
 * 多 Agent 任务、产物和事件数据。
 *
 * 导出：
 * - createDb() —— 创建数据库连接
 * - sessions / messages / tasks / artifacts / events / longTermMemory schema
 * - SessionRepository —— 会话 + 消息 CRUD
 * - MessageRepository —— 消息独立查询
 * - TaskRepository —— 多 Agent 任务 CRUD
 * - ArtifactRepository —— 多 Agent 产物追加与查询
 * - EventRepository —— 多 Agent 事件审计日志
 */

// 连接工厂
export { createDb } from "./connection.js";

// Schema 表定义
export {
  sessions,
  messages,
  tasks,
  artifacts,
  events,
  longTermMemory,
} from "./schema.js";

// Repository
export {
  SessionRepository,
  MessageRepository,
  TaskRepository,
  ArtifactRepository,
  EventRepository,
} from "./repositories/index.js";
export type {
  MessageRole,
  CreateMessageInput,
  TaskStatus,
  CreateTaskInput,
  TaskRecord,
  ArtifactType,
  FileChangeInput,
  CommitInput,
  TestResultInput,
  ArtifactRecord,
  EventInput,
  EventRecord,
} from "./repositories/index.js";
