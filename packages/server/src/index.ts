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

// 后续步骤将在此处启动 Fastify 实例
// import { buildServer } from './gateway/server.js';
// import { loadConfig } from './config.js';

// const config = loadConfig();
// const server = buildServer(config);
// await server.listen({ port: config.port, host: config.host });
// console.log(`Server running at http://${config.host}:${config.port}`);