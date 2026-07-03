import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * 创建 SQLite 数据库连接 + Drizzle ORM 实例
 *
 * - 自动创建 data 目录（若不存在）
 * - 启用 WAL 模式（Write-Ahead Logging，支持并发读写，适合 WebSocket 场景）
 * - 启用外键约束（SQLite 默认关闭）
 *
 * @param path - 数据库文件路径，默认 "./data/my-agent.db"
 * @returns Drizzle ORM 数据库实例
 */
export function createDb(path: string = "./data/my-agent.db"): BetterSQLite3Database {
  // 确保数据目录存在
  mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);

  // WAL 模式：允许并发读写，提升 WebSocket 长连接场景性能
  sqlite.pragma("journal_mode = WAL");

  // 启用外键约束（SQLite 默认不检查外键）
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite);
}
