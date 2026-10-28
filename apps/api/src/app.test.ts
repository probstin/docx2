import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorBodySchema, SiteInfoSchema } from "@docs-platform/contracts";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppOptions } from "./app.js";
import { loadConfig } from "./config.js";
import { HttpError } from "./errors.js";
import { z } from "zod";
import { parseBody } from "./validate.js";
import { failingCheck, hangingCheck, InMemorySiteService, okCheck } from "./testing/fakes.js";

const baseEnv = {
  PLATFORM_PUBLIC_URL: "https://docs.example.com",
  AUTH_ADMIN_GROUPS: "admins",
  LOG_LEVEL: "info",
};

const apps: FastifyInstance[] = [];
async function make(over: Partial<AppOptions> = {}, env: Record<string, string> = {}) {
  const app = await buildApp({
    config: loadConfig({ ...baseEnv, ...env }),
    site: new InMemorySiteService(),
    logStream: new Writable({ write: (_c, _e, cb) => cb() }),
    ...over,
  });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const user = { "x-auth-request-user": "alice" };
const admin = { ...user, "x-auth-request-groups": "staff, admins" };

describe("route/auth matrix", () => {
  it("GET /api/v1/site without subject -> 401 envelope", async () => {
    const app = await make();
    const res = await app.inject("/api/v1/site");
    expect(res.statusCode).toBe(401);
    const body = ErrorBodySchema.parse(res.json());
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each(["", "   ", " \t "])("blank subject %j -> 401", async (v) => {
    const app = await make();
    const res = await app.inject({ url: "/api/v1/site", headers: { "x-auth-request-user": v } });
    expect(res.statusCode).toBe(401);
  });

  it("ambiguous (comma) subject -> 401", async () => {
    const app = await make();
    const res = await app.inject({ url: "/api/v1/site", headers: { "x-auth-request-user": "a, b" } });
    expect(res.statusCode).toBe(401);
  });

  it("authenticated user gets site info", async () => {
    const app = await make();
    const res = await app.inject({ url: "/api/v1/site", headers: user });
    expect(res.statusCode).toBe(200);
    expect(SiteInfoSchema.parse(res.json()).title).toBe("Test Docs");
  });

  it.each([
    ["GET", "/api/v1/builds"],
    ["POST", "/api/v1/builds"],
  ] as const)("%s %s: 401 / 403 / admin reaches handler", async (method, url) => {
    const app = await make();
    expect((await app.inject({ method, url })).statusCode).toBe(401);
    expect((await app.inject({ method, url, headers: user })).statusCode).toBe(403);
    const forbidden = ErrorBodySchema.parse((await app.inject({ method, url, headers: user })).json());
    expect(forbidden.error.code).toBe("FORBIDDEN");
    const res = await app.inject({ method, url, headers: admin });
    expect(res.statusCode).toBe(501);
    expect(ErrorBodySchema.parse(res.json()).error.message).toBe("not implemented");
  });

  it("empty admin group list means nobody is admin", async () => {
    const app = await make({}, { AUTH_ADMIN_GROUPS: "" });
    const res = await app.inject({
      url: "/api/v1/builds",
      headers: { ...user, "x-auth-request-groups": "admins" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("AUTH_MODE=none yields the dev identity", async () => {
    const app = await make({}, { AUTH_MODE: "none", AUTH_ALLOW_INSECURE_NONE: "true" });
    expect((await app.inject("/api/v1/site")).statusCode).toBe(200);
  });

  it("every /api/v1 route is protected by default; webhook may opt out", async () => {
    const app = await make();
    // Routes added later without any auth config are still protected.
    app.get("/api/v1/forgot", async () => ({ leaked: true }));
    app.post("/api/v1/webhooks/git", { config: { auth: "webhook" } }, async () => ({ ok: true }));
    expect((await app.inject("/api/v1/forgot")).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/forgot", headers: user })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/v1/webhooks/git" })).statusCode).toBe(200);
  });

  it("health and metrics are not behind identity", async () => {
    const app = await make();
    expect((await app.inject("/health/live")).statusCode).toBe(200);
    expect((await app.inject("/metrics")).statusCode).toBe(200);
  });
});

describe("health", () => {
  it("live", async () => {
    const app = await make();
    const res = await app.inject("/health/live");
    expect(res.json()).toEqual({ status: "ok" });
  });
  it("ready 200 when all checks pass", async () => {
    const app = await make({ readiness: [okCheck("db"), okCheck("storage")] });
    const res = await app.inject("/health/ready");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: { db: "ok", storage: "ok" } });
  });
  it("ready 503 when a check fails, without leaking details", async () => {
    const app = await make({ readiness: [okCheck("storage"), failingCheck("db")] });
    const res = await app.inject("/health/ready");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable", checks: { storage: "ok", db: "fail" } });
    expect(res.body).not.toContain("hunter2");
  });
  it("ready 503 when a check times out", async () => {
    const app = await make({ readiness: [hangingCheck("slow")], readinessTimeoutMs: 20 });
    const res = await app.inject("/health/ready");
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.slow).toBe("fail");
  });
});

describe("metrics", () => {
  it("exposes default metrics and the request histogram labelled by route pattern", async () => {
    const app = await make();
    await app.inject({ url: "/api/v1/site", headers: user });
    await app.inject("/nope/123");
    const res = await app.inject("/metrics");
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("process_cpu_user_seconds_total");
    expect(res.body).toMatch(
      /http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/site",status_code="200"\} 1/,
    );
    expect(res.body).toContain('route="unmatched"');
    expect(res.body).not.toContain("/nope/123");
  });
});

describe("error envelope", () => {
  it("404", async () => {
    const app = await make();
    const res = await app.inject("/nothing");
    expect(res.statusCode).toBe(404);
    const body = ErrorBodySchema.parse(res.json());
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(res.headers["x-request-id"]);
  });
  it("bad JSON -> 400 VALIDATION_FAILED", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/builds",
      headers: { ...admin, "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("VALIDATION_FAILED");
  });
  it("oversized body -> 413 PAYLOAD_TOO_LARGE", async () => {
    const app = await make({ bodyLimit: 64 });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/builds",
      headers: { ...admin, "content-type": "application/json" },
      payload: JSON.stringify({ pad: "x".repeat(200) }),
    });
    expect(res.statusCode).toBe(413);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
  });
  it("default body limit is 64 KiB", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/builds",
      headers: { ...admin, "content-type": "application/json" },
      payload: JSON.stringify({ pad: "x".repeat(70 * 1024) }),
    });
    expect(res.statusCode).toBe(413);
  });
  it("unsupported media type -> 415 envelope", async () => {
    const app = await make();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/builds",
      headers: { ...admin, "content-type": "application/xml" },
      payload: "<a/>",
    });
    expect(res.statusCode).toBe(415);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("VALIDATION_FAILED");
  });
  it("5xx never leaks internal messages or stacks", async () => {
    const app = await make({
      site: { getSiteInfo: () => Promise.reject(new Error("secret connection string at /srv/app.js:12")) },
    });
    const res = await app.inject({ url: "/api/v1/site", headers: user });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatchObject({ code: "INTERNAL", message: "Internal server error" });
    expect(res.body).not.toContain("secret");
    expect(res.body).not.toContain("app.js");
  });
  it("HttpError from a port is passed through with its code", async () => {
    const app = await make({
      site: { getSiteInfo: () => Promise.reject(new HttpError(503, "UPSTREAM_UNAVAILABLE", "try later")) },
    });
    const res = await app.inject({ url: "/api/v1/site", headers: user });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("validation helper", () => {
  it("throws VALIDATION_FAILED with details that omit input values", async () => {
    const app = await make();
    app.post("/probe", async (request) => parseBody(request, z.strictObject({ n: z.number() })));
    const res = await app.inject({ method: "POST", url: "/probe", payload: { n: "super-secret" } });
    expect(res.statusCode).toBe(400);
    const body = ErrorBodySchema.parse(res.json());
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(body.error.details)).toContain("n");
    expect(res.body).not.toContain("super-secret");
  });
});

describe("request id", () => {
  it("echoes a safe x-request-id", async () => {
    const app = await make();
    const res = await app.inject({ url: "/health/live", headers: { "x-request-id": "abc-123_X.y" } });
    expect(res.headers["x-request-id"]).toBe("abc-123_X.y");
  });
  it("replaces unsafe ids with a generated one", async () => {
    const app = await make();
    const res = await app.inject({ url: "/health/live", headers: { "x-request-id": 'bad id"{}' } });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("is generated when absent and appears on error bodies", async () => {
    const app = await make();
    const res = await app.inject("/api/v1/site");
    expect(res.headers["x-request-id"]).toBe(res.json().error.requestId);
  });
});

describe("log redaction", () => {
  it("never writes secrets or identity header values", async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const app = await make({ logStream });
    await app.inject({
      url: "/api/v1/site",
      headers: {
        ...admin,
        "x-auth-request-email": "alice@corp.example",
        authorization: "Bearer tok-SECRET",
        cookie: "session=cookie-SECRET",
        "x-gitea-signature": "sig-SECRET",
      },
    });
    await app.inject({ url: "/api/v1/site", headers: { "x-auth-request-user": "mallory" } });
    app.log.info({ apiKey: "key-SECRET", cfg: { CHAT_API_KEY: "key2-SECRET" } }, "probe");
    const out = lines.join("");
    expect(out).toContain("incoming request");
    expect(out).toContain("[REDACTED]");
    for (const secret of [
      "tok-SECRET",
      "cookie-SECRET",
      "sig-SECRET",
      "alice@corp.example",
      "key-SECRET",
      "key2-SECRET",
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).not.toContain("alice");
    expect(out).not.toContain("mallory");
    expect(out).not.toContain("staff");
  });
});
