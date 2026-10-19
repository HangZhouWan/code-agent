/**
 * Runtime 配置路由
 */

import type { FastifyPluginAsync } from "fastify";
import {
  PROVIDER_DEFINITIONS,
  PROVIDER_IDS,
  llmConfigSchema,
} from "@code-agent/protocol";
import { GlobalConfigManager } from "@code-agent/runtime";

const routes: FastifyPluginAsync = async (app) => {
  const manager = new GlobalConfigManager();

  app.get("/status", async () => {
    const config = manager.load();
    return {
      setupRequired: !manager.isConfigured(),
      ...(config ? { provider: config.LLM_PROVIDER, model: config.LLM_MODEL } : {}),
    };
  });

  app.get("/providers", async () => ({
    providers: PROVIDER_IDS.map((id) => PROVIDER_DEFINITIONS[id]),
  }));

  app.get("/", async () => manager.masked());

  app.post("/", async (request, reply) => {
    const parsed = llmConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: parsed.error.issues.map((issue) => issue.message).join("; "),
      });
    }

    try {
      manager.save(parsed.data);
      return reply.status(200).send({
        success: true,
        path: manager.getConfigPath(),
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

export default routes;
