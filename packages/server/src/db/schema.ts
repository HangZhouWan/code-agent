import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
