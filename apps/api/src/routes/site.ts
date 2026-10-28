import type { FastifyPluginAsync } from "fastify";
import { API_ROUTES } from "@docs-platform/contracts";
import type { RouteDeps } from "./deps.js";

export const siteRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  // Identity is enforced by the default /api/v1 rule in app.ts.
  app.get(API_ROUTES.site, async () => deps.site.getSiteInfo());
};
