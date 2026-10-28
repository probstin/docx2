/**
 * Application factory. Tests call `buildApp(options)` and use `app.inject()`.
 *
 * Where future routes plug in
 * ---------------------------
 * Each feature is a Fastify plugin in `src/routes/` (`chat.ts`, `webhooks.ts`, `builds.ts`,
 * `releases.ts`, ...) that receives `RouteDeps` as plugin options. Register it in the
 * "routes" block below and add whatever ports it needs to `AppOptions`/`RouteDeps`.
 *
 * Auth model: every route under `/api/v1/` requires an identity by default (enforced by the
 * `onRoute` hook below, so a forgotten check cannot expose a route). The webhook route opts
 * out explicitly with `config: { auth: "webhook" }` and must verify the provider signature
 * itself. Admin routes add `preHandler: deps.requireAdmin`. Health and metrics live outside
 * `/api/v1` and are meant to be reachable only on the internal network.
 *
 * Observability: the `onRequest` and `onResponse` hooks below are the single place to attach
 * tracing (e.g. OpenTelemetry) later; `request.id` is the correlation id, echoed to the client
 * as `x-request-id` and present in every log line.
 */
import { randomUUID } from "node:crypto";
import type { DestinationStream } from "pino";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from "fastify";
import { createIdentityResolver, identityHeaderNames } from "@docs-platform/auth";
import type { ErrorCode } from "@docs-platform/contracts";
import { createRequireAdmin, requireIdentity } from "./auth.js";
import type { ApiConfig } from "./config.js";
import { HttpError, errorBody } from "./errors.js";
import { createMetrics } from "./metrics.js";
import type { ReadinessCheck, SiteService } from "./ports.js";
import { buildsRoutes } from "./routes/builds.js";
import type { RouteDeps } from "./routes/deps.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { siteRoutes } from "./routes/site.js";

export interface AppOptions {
  config: ApiConfig;
  /** Injected ports. */
  site: SiteService;
  readiness?: readonly ReadinessCheck[];
  /** Run after the HTTP server has closed (close pools, queues, ...). */
  onClose?: ReadonlyArray<() => Promise<void>>;
  readinessTimeoutMs?: number;
  /** Max request body in bytes (default 64 KiB). */
  bodyLimit?: number;
  /** Log destination; defaults to stdout. Tests capture logs here. */
  logStream?: DestinationStream;
}

export const DEFAULT_BODY_LIMIT = 64 * 1024;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

function pinoPath(header: string): string | null {
  return /^[a-z0-9-]+$/.test(header) ? `req.headers["${header}"]` : null;
}

function redactPaths(identityHeaders: readonly string[]): string[] {
  const headers = ["authorization", "cookie", "x-gitea-signature", ...identityHeaders];
  const keys = [
    "apiKey",
    "api_key",
    "apikey",
    "API_KEY",
    "CHAT_API_KEY",
    "EMBEDDINGS_API_KEY",
    "WEBHOOK_SECRET",
  ];
  return [
    ...headers.map(pinoPath).filter((p): p is string => p !== null),
    'res.headers["set-cookie"]',
    ...keys.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
  ];
}

function classify(error: unknown): { status: number; code: ErrorCode; message: string; details?: unknown } {
  if (error instanceof HttpError) {
    return { status: error.statusCode, code: error.code, message: error.message, details: error.details };
  }
  const status = (error as FastifyError | undefined)?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    if (status === 413) return { status, code: "PAYLOAD_TOO_LARGE", message: "Payload too large" };
    if (status === 415) return { status, code: "VALIDATION_FAILED", message: "Unsupported media type" };
    if (status === 404) return { status, code: "NOT_FOUND", message: "Not found" };
    return { status, code: "VALIDATION_FAILED", message: "Invalid request" };
  }
  return { status: 500, code: "INTERNAL", message: "Internal server error" };
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const identityHeaders = identityHeaderNames(config.auth);
  const resolveIdentity = createIdentityResolver(config.auth);
  const metrics = createMetrics();

  const app = Fastify({
    bodyLimit: options.bodyLimit ?? DEFAULT_BODY_LIMIT,
    // We validate the header ourselves; Fastify's own handling would accept any string.
    requestIdHeader: false,
    genReqId: (req) => {
      const candidate = req.headers["x-request-id"];
      return typeof candidate === "string" && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
    },
    logger: {
      level: config.server.LOG_LEVEL,
      redact: { paths: redactPaths(identityHeaders), censor: "[REDACTED]" },
      serializers: {
        req: (req: FastifyRequest) => ({
          method: req.method,
          url: req.url,
          headers: req.headers,
          remoteAddress: req.ip,
        }),
      },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
  });

  app.decorateRequest("identity", null);

  // ---- observability / identity hook points ------------------------------------------
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    request.identity = resolveIdentity(request.headers);
  });
  app.addHook("onResponse", async (request, reply) => {
    metrics.httpDuration
      .labels({
        method: request.method,
        route: request.routeOptions.url ?? "unmatched",
        status_code: String(reply.statusCode),
      })
      .observe(reply.elapsedTime / 1000);
  });

  // ---- protected by default ------------------------------------------------------------
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/api/v1/") && route.config?.auth !== "webhook") {
      const existing = route.onRequest;
      const list = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
      route.onRequest = [requireIdentity, ...list];
    }
  });

  // ---- error envelope ------------------------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    const { status, code, message, details } = classify(error);
    if (status >= 500) request.log.error({ err: error }, "request failed");
    else request.log.info({ code }, "request rejected");
    return reply.code(status).send(errorBody(code, message, request.id, details));
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(errorBody("NOT_FOUND", "Not found", request.id)),
  );

  // ---- routes --------------------------------------------------------------------------
  const deps: RouteDeps = {
    site: options.site,
    readiness: options.readiness ?? [],
    readinessTimeoutMs: options.readinessTimeoutMs ?? 2000,
    metrics,
    requireAdmin: createRequireAdmin(config.auth.AUTH_ADMIN_GROUPS),
  };
  await app.register(healthRoutes, deps);
  await app.register(metricsRoutes, deps);
  await app.register(siteRoutes, deps);
  await app.register(buildsRoutes, deps);

  for (const hook of options.onClose ?? []) {
    app.addHook("onClose", async () => hook());
  }

  return app;
}
