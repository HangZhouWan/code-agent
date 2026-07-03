import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 测试环境：Node.js
    environment: 'node',
    // 测试文件匹配规则
    include: ['src/**/*.test.ts'],
    // 全局超时时间
    testTimeout: 10_000,
  },
});
