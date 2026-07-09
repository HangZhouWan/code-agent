import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite 构建配置
 *
 * - @vitejs/plugin-react：React 快速刷新与 JSX 编译
 * - @tailwindcss/vite：Tailwind CSS v4 的 Vite 集成
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 开发服务器端口
    port: 5173,
    // API 代理：将 /api 请求转发到 Fastify 后端
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});