import type { FastifyPluginAsync } from "fastify";
import { API_ROUTES } from "@docs-platform/contracts";
import type { RouteDeps } from "./deps.js";

export const metricsRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  app.get(API_ROUTES.metrics, async (_request, reply) => {
    const { registry } = deps.metrics;
    return reply.header("content-type", registry.contentType).send(await registry.metrics());
  });
};
