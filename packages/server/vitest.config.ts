/**
 * Server 测试配置
 *
 * SQLite 的 WAL 初始化在并行 worker 同时操作临时目录时偶发 disk I/O error，
 * 这里关闭测试文件级并行，保证数据库测试稳定。
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 10_000,
    exclude: ["node_modules", "dist"],
  },
});
