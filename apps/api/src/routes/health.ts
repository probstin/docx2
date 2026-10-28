import type { FastifyPluginAsync } from "fastify";
import { API_ROUTES } from "@docs-platform/contracts";
import type { ReadinessCheck } from "../ports.js";
import type { RouteDeps } from "./deps.js";

async function runCheck(check: ReadinessCheck, timeoutMs: number): Promise<"ok" | "fail"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    await Promise.race([check.check(), timeout]);
    return "ok";
  } catch {
    return "fail";
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  app.get(API_ROUTES.healthLive, async () => ({ status: "ok" }));

  app.get(API_ROUTES.healthReady, async (_request, reply) => {
    const results = await Promise.all(
      deps.readiness.map(async (c) => [c.name, await runCheck(c, deps.readinessTimeoutMs)] as const),
    );
    const ready = results.every(([, s]) => s === "ok");
    // Per-check status only: no error details leak.
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? "ok" : "unavailable", checks: Object.fromEntries(results) });
  });
};
