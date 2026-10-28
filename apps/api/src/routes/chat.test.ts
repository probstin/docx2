import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorBodySchema, SseDecoder, type ChatStreamEvent } from "@docs-platform/contracts";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { ChatService, ReleaseService } from "../ports.js";
import { InMemorySiteService } from "../testing/fakes.js";
import { pageUrlBelongsToSite } from "./chat.js";

const RELEASE = "20260101120000-abcdef1";
const baseEnv = {
  PLATFORM_PUBLIC_URL: "https://docs.example.com/product/",
  AUTH_ADMIN_GROUPS: "admins",
  LOG_LEVEL: "info",
};
const headers = { "x-auth-request-user": "alice", "content-type": "application/json" };
const goodBody = (over: Record<string, unknown> = {}) => ({
  message: "SECRET-QUESTION how do I deploy?",
  context: { releaseId: RELEASE, pageUrl: "/product/guides/deploy" },
  ...over,
});

const happy: ChatService = {
  async *stream() {
    yield { type: "start", messageId: "m1" };
    yield { type: "delta", text: "Hello " };
    yield { type: "delta", text: "world" };
    yield { type: "done", status: "grounded" };
  },
};
const knownRelease: ReleaseService = { isChatQueryable: (id) => Promise.resolve(id === RELEASE) };

const apps: FastifyInstance[] = [];
const logLines: string[] = [];
async function make(
  chat: ChatService,
  env: Record<string, string> = {},
  extra: { keepAliveMs?: number; releases?: ReleaseService } = {},
) {
  logLines.length = 0;
  const app = await buildApp({
    config: loadConfig({ ...baseEnv, ...env }),
    site: new InMemorySiteService(),
    chat,
    releases: extra.releases ?? knownRelease,
    ...(extra.keepAliveMs ? { keepAliveMs: extra.keepAliveMs } : {}),
    logStream: new Writable({
      write(c, _e, cb) {
        logLines.push(String(c));
        cb();
      },
    }),
  });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const post = (app: FastifyInstance, payload: unknown, h: Record<string, string> = headers) =>
  app.inject({ method: "POST", url: "/api/v1/chat", headers: h, payload: JSON.stringify(payload) });

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return `http://127.0.0.1:${addr.port}/api/v1/chat`;
}

async function eventually(fn: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("pageUrlBelongsToSite", () => {
  const site = "https://docs.example.com/product/";
  it.each([
    ["/product/a", true],
    ["/product", true],
    ["https://docs.example.com/product/a#x", true],
    ["/other", false],
    ["/productx", false],
    ["//evil.com/product/a", false],
    ["/\\evil.com/product/a", false],
    ["https://evil.com/product/a", false],
    ["http://docs.example.com/product/a", false],
    ["https://user:pw@docs.example.com/product/a", false],
    ["relative/path", false],
    ["javascript:alert(1)", false],
  ])("%s -> %s", (url, ok) => {
    expect(pageUrlBelongsToSite(url, site)).toBe(ok);
  });
});

describe("POST /api/v1/chat validation", () => {
  it("401 without identity", async () => {
    const app = await make(happy);
    const res = await post(app, goodBody(), { "content-type": "application/json" });
    expect(res.statusCode).toBe(401);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["bad body", { nope: 1 }],
    ["oversized message", goodBody({ message: "x".repeat(4001) })],
    ["foreign pageUrl", goodBody({ context: { releaseId: RELEASE, pageUrl: "https://evil.com/product/a" } })],
    ["pageUrl outside base path", goodBody({ context: { releaseId: RELEASE, pageUrl: "/elsewhere" } })],
  ])("400 VALIDATION_FAILED for %s", async (_n, payload) => {
    const app = await make(happy);
    const res = await post(app, payload);
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("VALIDATION_FAILED");
  });

  it("404 RELEASE_UNKNOWN as JSON", async () => {
    const app = await make(happy);
    const res = await post(
      app,
      goodBody({ context: { releaseId: "20250101120000-0000000", pageUrl: "/product/a" } }),
    );
    expect(res.statusCode).toBe(404);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("RELEASE_UNKNOWN");
  });
});

describe("rate limits", () => {
  it("429 with Retry-After after the per-minute budget", async () => {
    const app = await make(happy, { CHAT_RATE_LIMIT_PER_MINUTE: "2" });
    expect((await post(app, goodBody())).statusCode).toBe(200);
    expect((await post(app, goodBody())).statusCode).toBe(200);
    const res = await post(app, goodBody());
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(ErrorBodySchema.parse(res.json()).error.code).toBe("RATE_LIMITED");
    // another user is unaffected
    expect((await post(app, goodBody(), { ...headers, "x-auth-request-user": "bob" })).statusCode).toBe(200);
  });

  it("429 when too many concurrent streams, and the slot frees afterwards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: ChatService = {
      async *stream() {
        yield { type: "start", messageId: "m" };
        await gate;
        yield { type: "done", status: "grounded" };
      },
    };
    const app = await make(slow, { CHAT_MAX_CONCURRENT_STREAMS_PER_USER: "1" });
    const url = await listen(app);
    const first = await fetch(url, { method: "POST", headers, body: JSON.stringify(goodBody()) });
    expect(first.status).toBe(200);
    const second = await fetch(url, { method: "POST", headers, body: JSON.stringify(goodBody()) });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    release();
    await first.text();
    await eventually(() => logLines.some((l) => l.includes("chat turn")));
    const third = await fetch(url, { method: "POST", headers, body: JSON.stringify(goodBody()) });
    expect(third.status).toBe(200);
    await third.text();
  });
});

describe("streaming", () => {
  it("streams events in order with the right headers", async () => {
    const app = await make(happy);
    const url = await listen(app);
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "x-request-id": "req-123" },
      body: JSON.stringify(goodBody()),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("x-request-id")).toBe("req-123");
    const decoder = new SseDecoder();
    const events: ChatStreamEvent[] = [];
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      events.push(...decoder.push(value));
    }
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta", "done"]);
    expect(events[1]).toEqual({ type: "delta", text: "Hello " });
  });

  it("sends keep-alive comments while waiting", async () => {
    const slow: ChatService = {
      async *stream() {
        yield { type: "start", messageId: "m" };
        await new Promise((r) => setTimeout(r, 150));
        yield { type: "done", status: "grounded" };
      },
    };
    const app = await make(slow, {}, { keepAliveMs: 20 });
    const url = await listen(app);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(goodBody()) });
    expect(await res.text()).toContain(": keep-alive");
  });

  it("client disconnect aborts the service signal and frees the slot", async () => {
    let seen: AbortSignal | undefined;
    const hanging: ChatService = {
      async *stream({ signal }) {
        seen = signal;
        yield { type: "start", messageId: "m" };
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      },
    };
    const app = await make(hanging, { CHAT_MAX_CONCURRENT_STREAMS_PER_USER: "1" });
    const url = await listen(app);
    const ac = new AbortController();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(goodBody()),
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read(); // the start event
    expect(seen?.aborted).toBe(false);
    ac.abort();
    await eventually(() => seen?.aborted === true);
    await eventually(() => logLines.some((l) => l.includes("chat turn")));
    const line = JSON.parse(logLines.find((l) => l.includes("chat turn"))!) as Record<string, unknown>;
    expect(line.aborted).toBe(true);
    // slot released: a new request is admitted (not 429)
    const again = await fetch(url, { method: "POST", headers, body: JSON.stringify(goodBody()) });
    expect(again.status).toBe(200);
    again.body?.cancel().catch(() => undefined);
  });

  it("service throwing before start -> error envelope", async () => {
    const boom: ChatService = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("model exploded password=hunter2");
      },
    };
    const app = await make(boom);
    const res = await post(app, goodBody());
    expect(res.statusCode).toBe(500);
    const body = ErrorBodySchema.parse(res.json());
    expect(body.error.code).toBe("INTERNAL");
    expect(res.body).not.toContain("hunter2");
  });

  it("service throwing after start -> error event", async () => {
    const boom: ChatService = {
      async *stream() {
        yield { type: "start", messageId: "m" };
        await Promise.resolve();
        throw new Error("mid-stream failure");
      },
    };
    const app = await make(boom);
    const url = await listen(app);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(goodBody()) });
    expect(res.status).toBe(200);
    const events = new SseDecoder().push(await res.text());
    expect(events.map((e) => e.type)).toEqual(["start", "error"]);
  });

  it("logs one structured line per turn without message text", async () => {
    const app = await make(happy);
    const res = await post(app, goodBody());
    expect(res.statusCode).toBe(200);
    await eventually(() => logLines.some((l) => l.includes("chat turn")));
    const raw = logLines.filter((l) => l.includes("chat turn"));
    expect(raw).toHaveLength(1);
    const line = JSON.parse(raw[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({
      releaseId: RELEASE,
      done: "grounded",
      aborted: false,
      events: { start: 1, delta: 2, done: 1 },
    });
    expect(line.subject).not.toBe("alice");
    expect(typeof line.requestId).toBe("string");
    const all = logLines.join("");
    expect(all).not.toContain("SECRET-QUESTION");
    expect(all).not.toContain("alice");
  });
});
