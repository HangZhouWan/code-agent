# 实现计划 07：数据库层实现

**对应技术文档**：[2026-07-02-technical-implementation.md](./2026-07-02-technical-implementation.md) 第八节

**预计工时**：2-3 天（第 4-5 周，与 API Gateway 可并行）

**前置模块**：[01-Monorepo 与基础设施](./implementation-plan-01-monorepo.md)

---

## 1. 目标

搭建基于 SQLite + Drizzle ORM 的持久化层，管理会话和消息数据。

## 2. 技术选型

| 组件 | 选择 | 原因 |
|------|------|------|
| 数据库 | SQLite (better-sqlite3) | 零配置、单文件、无需独立服务 |
| ORM | Drizzle ORM | TypeScript 原生、类型安全、轻量 |
| 迁移 | drizzle-kit | Drizzle 官方迁移工具 |

## 3. 数据模型

### sessions 表

| 列 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `title` | TEXT | NOT NULL, DEFAULT 'New Chat' | 会话标题 |
| `created_at` | TEXT | NOT NULL | ISO 8601 时间戳 |
| `updated_at` | TEXT | NOT NULL | ISO 8601 时间戳 |

### messages 表

| 列 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | INTEGER | PRIMARY KEY, AUTOINCREMENT | 自增 ID |
| `session_id` | TEXT | NOT NULL, FK → sessions.id, ON DELETE CASCADE | 所属会话 |
| `role` | TEXT | NOT NULL, ENUM('human','assistant','system','tool') | 消息角色 |
| `content` | TEXT | NOT NULL | 消息内容 |
| `tool_name` | TEXT | NULLABLE | 工具名称（tool 角色时） |
| `tool_args` | TEXT | NULLABLE | 工具参数 JSON |
| `tool_result` | TEXT | NULLABLE | 工具结果 JSON |
| `created_at` | TEXT | NOT NULL | ISO 8601 时间戳 |

## 4. 产出物清单

```
packages/server/src/db/
├── schema.ts           # Drizzle schema 定义（sessions + messages 表）
├── connection.ts       # createDb() —— 创建 SQLite 连接 + Drizzle 实例
└── repositories/
    ├── sessions.ts     # SessionRepository —— 会话 + 消息 CRUD
    └── messages.ts     # (可选) 消息独立查询
```

## 5. 依赖

```json
{
  "better-sqlite3": "^11",
  "drizzle-orm": "^0.38",
  "drizzle-kit": "^0.30"
}
```

## 6. 实现步骤

### 步骤 6.1：Schema 定义 (`db/schema.ts`)

```typescript
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New Chat"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["human", "assistant", "system", "tool"] }).notNull(),
  content: text("content").notNull(),
  toolName: text("tool_name"),
  toolArgs: text("tool_args"),
  toolResult: text("tool_result"),
  createdAt: text("created_at").notNull(),
});
```

**设计注意**：
- `created_at` / `updated_at` 使用 TEXT 存储 ISO 8601 格式（非 `INTEGER` Unix 时间戳），便于人工查看和调试
- 外键 `ON DELETE CASCADE` 确保删除会话时自动清理消息
- `tool_args` / `tool_result` 存 JSON 字符串（SQLite 无原生 JSON 列类型）

### 步骤 6.2：连接管理 (`db/connection.ts`)

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export function createDb(path: string = "./data/code-agent.db") {
  // 自动创建 data 目录
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");   // 写前日志，提升并发性能
  sqlite.pragma("foreign_keys = ON");     // 启用外键约束
  return drizzle(sqlite);
}
```

**要点**：
- WAL 模式：允许并发读写，适合 WebSocket 场景
- 外键约束：默认关闭，需手动 `PRAGMA` 开启
- data 目录自动创建

### 步骤 6.3：SessionRepository (`db/repositories/sessions.ts`)

```typescript
export class SessionRepository {
  constructor(private db: BetterSQLite3Database) {}

  create(title: string): { id, title, createdAt }
  list(): Session[]
  getMessages(sessionId: string): Message[]
  addMessage(sessionId: string, msg: {...}): void
  delete(sessionId: string): void
}
```

**各方法实现要点**：

| 方法 | 关键逻辑 |
|------|------|
| `create` | `randomUUID()` 生成 ID，时间戳用 `new Date().toISOString()` |
| `list` | `orderBy(desc(sessions.updatedAt))` 按最近活跃排序 |
| `getMessages` | `where(eq(messages.sessionId, sessionId)).orderBy(messages.createdAt)` 时间顺序 |
| `addMessage` | 插入消息 + `update sessions set updatedAt` 更新时间戳（保持 list 排序准确） |
| `delete` | 先删 messages（级联），再删 session（或依赖 ON DELETE CASCADE） |

**`addMessage` 的自动时间更新**：
```typescript
this.db.update(sessions)
  .set({ updatedAt: new Date().toISOString() })
  .where(eq(sessions.id, sessionId))
  .run();
```
这确保会话列表按最近活跃排序始终准确。

---

## 7. 数据库迁移

使用 drizzle-kit 管理 schema 变更：

```bash
# 生成迁移文件
pnpm drizzle-kit generate

# 应用迁移
pnpm drizzle-kit push
```

初始迁移包含 `sessions` 和 `messages` 两张表。

---

## 8. 模块注入

在 `packages/server/src/index.ts` 中：
```typescript
const db = createDb(cfg.DB_PATH);
app.decorate("db", db);
```

通过 Fastify 的 `decorate` 机制，所有路由中可通过 `app.db` 访问数据库实例。

---

## 9. 验收标准

- [ ] `createDb()` 成功创建 SQLite 文件（若不存在）
- [ ] `WAL` 模式和 `foreign_keys` 已启用（通过 `PRAGMA` 验证）
- [ ] `SessionRepository.create()` 返回包含 `id`、`title`、`createdAt` 的会话对象
- [ ] `SessionRepository.list()` 按 `updatedAt` 降序排列
- [ ] `SessionRepository.addMessage()` 同时更新 sessions 的 `updatedAt`
- [ ] `SessionRepository.delete()` 级联删除 messages
- [ ] 并发写入不报错（WAL 模式验证）
- [ ] drizzle-kit schema 生成与代码定义一致
- [ ] TypeScript 类型通过 drizzle 的类型推断正确关联
