import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * sessions 表 —— 会话元数据
 *
 * - id: UUID 主键
 * - title: 会话标题，默认 "New Chat"
 * - created_at / updated_at: ISO 8601 时间戳（TEXT 便于人工调试）
 */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New Chat"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * messages 表 —— 会话消息
 *
 * - id: 自增整数主键
 * - session_id: 外键 → sessions.id，ON DELETE CASCADE
 * - role: 消息角色（human / assistant / system / tool）
 * - content: 消息内容文本
 * - tool_name / tool_args / tool_result: tool 角色专用字段
 * - created_at: ISO 8601 时间戳
 */
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["human", "assistant", "system", "tool"] }).notNull(),
  content: text("content").notNull(),
  toolName: text("tool_name"),
  toolArgs: text("tool_args"),
  toolResult: text("tool_result"),
  createdAt: text("created_at").notNull(),
});

// ─────────────────────────────────────────────
// Step 5: Multi-Agent 表
// ─────────────────────────────────────────────

/**
 * tasks 表 —— 多 Agent 任务追踪
 *
 * 记录每个 SubTask 的完整生命周期，包括状态流转和时间线。
 * 任务按 session 隔离，支持父子任务关系。
 */
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: [
      "pending",
      "assigned",
      "running",
      "awaiting_input",
      "completed",
      "failed",
      "cancelled",
    ],
  })
    .notNull()
    .default("pending"),
  role: text("role").notNull(),
  parentTaskId: text("parent_task_id"),
  description: text("description").notNull(),
  plan: text("plan"), // JSON string
  result: text("result"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

/**
 * artifacts 表 —— 多 Agent 产物追踪
 *
 * 记录每个任务产出的文件变更、commit 和测试结果。
 * 纯追加模式，不修改已写入的记录。
 */
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["file_change", "commit", "test_result"],
  }).notNull(),
  data: text("data").notNull(), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * events 表 —— 多 Agent 事件审计日志
 *
 * 可选表，用于审计和回溯 Agent 间通信历史。
 * 记录 EventBus 上发布的每条消息。
 */
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  payload: text("payload").notNull(), // JSON string
  correlationId: text("correlation_id"),
  taskId: text("task_id"),
  senderId: text("sender_id").notNull(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * long_term_memory 表 —— 长期记忆持久化
 *
 * 存储跨会话的知识条目，供 Agent 在后续会话中检索。
 * 按 session 隔离，支持元数据扩展。
 */
export const longTermMemory = sqliteTable("long_term_memory", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
