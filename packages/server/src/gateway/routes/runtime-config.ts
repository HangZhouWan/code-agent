/**
 * Runtime 配置路由
 *
 * GET  /status      —— 是否仍需首次配置 + 当前 provider/model
 * GET  /providers   —— 可选 Provider 定义
 * GET  /            —— 当前配置（API Key 脱敏）
 * POST /            —— 保存配置；支持在首次配置之后修改
 */

import type { FastifyPluginAsync } from "fastify";
import {
  PROVIDER_DEFINITIONS,
  PROVIDER_IDS,
  llmConfigSchema,
} from "@code-agent/protocol";
import { GlobalConfigManager } from "@code-agent/runtime";

export interface RuntimeConfigRoutesOptions {
  /** 配置管理器；测试时可注入临时文件，默认 ~/.code-agent/config.json */
  manager?: GlobalConfigManager;
}

const routes: FastifyPluginAsync<RuntimeConfigRoutesOptions> = async (
  app,
  options,
) => {
  const manager = options.manager ?? new GlobalConfigManager();

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
    const body =
      request.body !== null &&
      typeof request.body === "object" &&
      !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : null;
    if (!body) {
      return reply.status(400).send({
        success: false,
        error: "请求体必须是 JSON 对象",
      });
    }

    const existing = manager.load();
    const incomingKey =
      typeof body.LLM_API_KEY === "string" ? body.LLM_API_KEY.trim() : "";

    // 以已保存配置为底，允许 UI 只提交改动的字段。
    // 前端只能拿到脱敏 Key，因此空 Key 表示沿用旧值而不是清空。
    const merged: Record<string, unknown> = {
      ...(existing ?? {}),
      ...body,
    };
    if (existing && !incomingKey) {
      merged.LLM_API_KEY = existing.LLM_API_KEY;
    }
    // 空 baseUrl 表示清除自定义端点，回退到 Provider 默认地址
    if (merged.LLM_BASE_URL === "" || merged.LLM_BASE_URL === null) {
      delete merged.LLM_BASE_URL;
    }

    const parsed = llmConfigSchema.safeParse(merged);
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
        // 运行时在启动时加载配置，保存后需要重启才能生效
        restartRequired: true,
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
