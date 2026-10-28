import type { FastifyPluginAsync } from "fastify";
import { API_ROUTES } from "@docs-platform/contracts";
import { notImplemented } from "../errors.js";
import type { RouteDeps } from "./deps.js";

/** Placeholder: proves the admin 401/403 matrix. Replaced by the real handlers in a later wave. */
export const buildsRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  app.get(API_ROUTES.builds, { preHandler: deps.requireAdmin }, async () => {
    throw notImplemented();
  });
  app.post(API_ROUTES.builds, { preHandler: deps.requireAdmin }, async () => {
    throw notImplemented();
  });
};
