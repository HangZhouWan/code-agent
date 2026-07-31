import type { Config } from "drizzle-kit";

export default {
  // Schema 文件路径（相对于 config 所在目录）
  schema: "./src/db/schema.ts",

  // 迁移文件输出目录
  out: "./drizzle",

  // 数据库连接（SQLite 文件路径）
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/code-agent.db",
  },
} satisfies Config;
