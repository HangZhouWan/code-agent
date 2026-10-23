/**
 * Runtime Agent 状态路由
 */

import type { FastifyPluginAsync } from "fastify";
import { BUILTIN_ROLES } from "@code-agent/runtime";

const routes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({
    agents: BUILTIN_ROLES.map((role) => ({
      id: role.id,
      role: role.id,
      name: role.displayName,
      status: "offline",
      description: role.description,
    })),
  }));
};

export default routes;
