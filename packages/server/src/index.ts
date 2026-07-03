/**
 * @my-agent/server —— Fastify API 服务端入口
 *
 * 此模块负责：
 * - HTTP + WebSocket API Gateway
 * - Agent 会话管理与编排
 * - 数据库操作（SQLite + Drizzle ORM）
 * - 环境变量配置加载
 */

// 服务端版本标识
export const SERVER_VERSION = '0.1.0';

// 数据库层
export { createDb } from './db/index.js';
export { sessions, messages } from './db/index.js';
export { SessionRepository, MessageRepository } from './db/index.js';
export type { MessageRole, CreateMessageInput } from './db/index.js';

// Orchestrator（Agent 编排层）
export { createOrchestratorGraph } from './orchestrator/graph.js';
export { OrchestratorState } from './orchestrator/state.js';
export type { SubTask, NextAction, TaskResult } from './orchestrator/types.js';

// 后续步骤将在此处启动 Fastify 实例
// import Fastify from 'fastify';
// import { buildServer } from './gateway/server.js';
// import { loadConfig } from './config.js';
//
// const config = loadConfig();
// const server = buildServer(config);
//
// // 数据库注入 —— 通过 Fastify decorate 在整个应用中共享 db 实例
// const db = createDb(config.DB_PATH);
// server.decorate("db", db);
//
// // Fastify 类型增强（需在 fastify 模块下 declare）：
// // declare module 'fastify' {
// //   interface FastifyInstance {
// //     db: BetterSQLite3Database;
// //   }
// // }
//
// await server.listen({ port: config.port, host: config.host });
// console.log(`Server running at http://${config.host}:${config.port}`);
