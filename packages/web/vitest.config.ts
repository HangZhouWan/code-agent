/**
 * Vitest 配置
 *
 * - jsdom 环境：支持 React 组件和 hook 测试
 * - setup 文件：加载 @testing-library/jest-dom 扩展断言
 * - 排除 dist 和 node_modules
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules", "dist"],
  },
});
