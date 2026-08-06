/**
 * 全局配置管理 HTTP 路由
 *
 * 提供首次配置引导所需的 API 端点。
 *
 * | 方法 | 路径               | 说明                       |
 * |------|--------------------|----------------------------|
 * | GET  | /api/config/status | 检查配置是否已就绪         |
 * | POST | /api/config        | 保存全局配置               |
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { GlobalConfigManager } from "@code-agent/core";
import { z } from "zod";

const saveConfigSchema = z.object({
  LLM_PROVIDER: z.enum(["openai", "anthropic", "openai-compatible"]),
  LLM_MODEL: z.string().min(1, "模型名称不能为空"),
  LLM_API_KEY: z.string().min(1, "API Key 不能为空"),
  LLM_BASE_URL: z.string().optional(),
});

const configRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const configManager = new GlobalConfigManager();

  app.get("/config/status", async (_request, reply) => {
    const setupRequired = !configManager.isConfigured();
    reply.status(200).send({ setupRequired });
  });

  app.post("/config", async (request, reply) => {
    const parsed = saveConfigSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.status(400).send({
        success: false,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      });
      return;
    }

    try {
      configManager.save(parsed.data);
      reply.status(200).send({
        success: true,
        path: configManager.getConfigPath(),
      });
    } catch (err) {
      reply.status(500).send({
        success: false,
        error: err instanceof Error ? err.message : "保存配置失败",
      });
    }
  });
};

export default configRoutes;
