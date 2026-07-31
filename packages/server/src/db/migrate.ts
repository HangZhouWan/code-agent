/**
 * 数据库迁移脚本
 *
 * 使用 drizzle-kit 生成的 SQL 迁移文件，
 * 通过 better-sqlite3 直接执行。
 *
 * 用法：
 *   pnpm --filter @code-agent/server db:migrate
 *   或
 *   npx tsx src/db/migrate.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 迁移文件目录（与 drizzle.config.ts 的 out 配置对应）
const MIGRATIONS_DIR = join(__dirname, "../../drizzle");
const DB_PATH = process.env.DB_PATH || "./data/code-agent.db";

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 确保迁移记录表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);

  // 获取已应用的迁移
  const applied = new Set(
    db
      .prepare("SELECT name FROM __drizzle_migrations")
      .all()
      .map((r: unknown) => (r as { name: string }).name),
  );

  // 读取迁移文件
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`  ▶ Applying ${file}...`);

      db.transaction(() => {
        db.exec(sql);
        db.prepare(
          "INSERT INTO __drizzle_migrations (name, applied_at) VALUES (?, ?)",
        ).run(file, new Date().toISOString());
      })();

      console.log(`  ✓ ${file} applied`);
    }

    console.log("\n✅ All migrations applied successfully");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("ℹ️  No migration files found. Run 'pnpm db:generate' first.");
    } else {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    }
  } finally {
    db.close();
  }
}

main();
