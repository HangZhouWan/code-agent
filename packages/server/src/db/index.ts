/**
 * @my-agent/server/db —— 数据库层
 *
 * 基于 SQLite + Drizzle ORM 的持久化层，管理会话和消息数据。
 *
 * 导出：
 * - createDb() —— 创建数据库连接
 * - sessions / messages schema —— Drizzle 表定义
 * - SessionRepository —— 会话 + 消息 CRUD
 * - MessageRepository —— 消息独立查询
 */

// 连接工厂
export { createDb } from "./connection.js";

// Schema 表定义
export { sessions, messages } from "./schema.js";

// Repository
export { SessionRepository, MessageRepository } from "./repositories/index.js";
export type { MessageRole, CreateMessageInput } from "./repositories/index.js";
