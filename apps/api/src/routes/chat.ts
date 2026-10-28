import { createHash } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  API_ROUTES,
  ChatRequestSchema,
  encodeSseEvent,
  type ChatStreamEvent,
} from "@docs-platform/contracts";
import { ChatLimiter } from "../chat-limiter.js";
import { HttpError, errorBody, releaseUnknown } from "../errors.js";
import { parseBody } from "../validate.js";
import type { RouteDeps } from "./deps.js";

const pageUrlRejected = () =>
  new HttpError(400, "VALIDATION_FAILED", "Invalid request body", {
    in: "body",
    issues: [{ path: ["context", "pageUrl"], message: "must belong to this documentation site" }],
  });

/**
 * `pageUrl` must be root-relative or absolute on the site's origin, and under its path.
 * Resolution uses the WHATWG parser, so tricks like `/\evil.com` or `//evil.com` end up on
 * the wrong origin and are rejected.
 */
export function pageUrlBelongsToSite(pageUrl: string, publicUrl: string): boolean {
  const site = new URL(publicUrl);
  let resolved: URL;
  try {
    resolved = pageUrl.startsWith("/") ? new URL(pageUrl, site) : new URL(pageUrl);
  } catch {
    return false;
  }
  if (resolved.origin !== site.origin || resolved.username || resolved.password) return false;
  const base = site.pathname.endsWith("/") ? site.pathname : `${site.pathname}/`;
  return resolved.pathname === base.slice(0, -1) || resolved.pathname.startsWith(base);
}

const subjectHash = (subject: string) => createHash("sha256").update(subject).digest("hex").slice(0, 16);

export const chatRoutes: FastifyPluginAsync<RouteDeps> = async (app, deps) => {
  const { chat, releases, metrics } = deps;
  if (!chat || !releases) throw new Error("chatRoutes requires chat and releases");
  const limiter = new ChatLimiter({
    perMinute: deps.chatLimits.CHAT_RATE_LIMIT_PER_MINUTE,
    maxConcurrent: deps.chatLimits.CHAT_MAX_CONCURRENT_STREAMS_PER_USER,
  });
  const open = new Set<AbortController>();

  // Fastify waits for open connections on close; abort streams first so shutdown is prompt.
  app.addHook("preClose", async () => {
    for (const ac of open) ac.abort();
  });

  app.post(API_ROUTES.chat, async (request: FastifyRequest, reply) => {
    const identity = request.identity!;
    const reject = (outcome: string, error: HttpError) => {
      metrics.chatRequests.labels({ outcome }).inc();
      return error;
    };

    let body;
    try {
      body = parseBody(request, ChatRequestSchema);
      if (!pageUrlBelongsToSite(body.context.pageUrl, deps.publicUrl)) throw pageUrlRejected();
    } catch (err) {
      throw err instanceof HttpError ? reject("invalid", err) : err;
    }

    const slot = limiter.acquire(identity.subject);
    if (!slot.ok) {
      metrics.chatRequests.labels({ outcome: "rate_limited" }).inc();
      return reply
        .code(429)
        .header("retry-after", String(slot.retryAfterSeconds))
        .send(
          errorBody(
            "RATE_LIMITED",
            slot.reason === "rate" ? "Too many chat requests" : "Too many chat streams open",
            request.id,
          ),
        );
    }

    const releaseId = body.context.releaseId;
    const ac = new AbortController();
    open.add(ac);
    const startedAt = performance.now();
    const counts: Record<string, number> = {};
    let doneStatus: string | null = null;
    let outcome = "ok";
    let streaming = false;
    let ended = false;
    let keepAlive: NodeJS.Timeout | undefined;
    const raw = reply.raw;
    const onClose = () => {
      if (!raw.writableFinished) ac.abort();
    };
    raw.once("close", onClose);
    metrics.chatActiveStreams.inc();

    const aborted = new Promise<"aborted">((resolve) => {
      ac.signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });

    const write = async (chunk: string): Promise<void> => {
      if (raw.destroyed || raw.writableEnded) return;
      if (raw.write(chunk)) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          raw.off("drain", done);
          raw.off("close", done);
          resolve();
        };
        raw.once("drain", done);
        raw.once("close", done);
      });
    };

    let iterator: AsyncIterator<ChatStreamEvent> | undefined;
    const releaseSlot = slot.release;
    const cleanup = (): void => {
      if (ended) return;
      ended = true;
      if (keepAlive) clearInterval(keepAlive);
      raw.off("close", onClose);
      open.delete(ac);
      releaseSlot();
      metrics.chatActiveStreams.dec();
      // Stop the service if it is still running (e.g. we stopped reading early).
      void iterator?.return?.().catch(() => undefined);
    };
    const pull = () => {
      const p = iterator!.next();
      p.catch(() => undefined); // a rejection after abort won the race must not go unhandled
      return Promise.race([p, aborted]);
    };
    try {
      if (!(await releases.isChatQueryable(releaseId))) throw releaseUnknown();

      iterator = chat.stream({ request: body, identity, signal: ac.signal })[Symbol.asyncIterator]();

      let next = await pull();
      if (next !== "aborted") {
        // First event in hand: commit to a stream. Errors before this point are normal JSON errors.
        reply.hijack();
        streaming = true;
        raw.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          "x-request-id": request.id,
        });
        raw.flushHeaders();
        keepAlive = setInterval(() => {
          if (!raw.writableNeedDrain && !raw.destroyed && !raw.writableEnded) raw.write(": keep-alive\n\n");
        }, deps.keepAliveMs);

        let terminal = false;
        try {
          while (next !== "aborted" && !next.done) {
            const event = next.value;
            counts[event.type] = (counts[event.type] ?? 0) + 1;
            if (event.type === "done") doneStatus = event.status;
            if (event.type === "error") outcome = "error";
            await write(encodeSseEvent(event));
            if (event.type === "done" || event.type === "error") {
              terminal = true;
              break;
            }
            next = await pull();
          }
          if (next === "aborted") outcome = "aborted";
          else if (!terminal) {
            // Service ended without done/error.
            outcome = "error";
            counts.error = (counts.error ?? 0) + 1;
            await write(
              encodeSseEvent({
                type: "error",
                code: "INTERNAL",
                message: "The response ended unexpectedly.",
              }),
            );
          }
        } catch (err) {
          if (ac.signal.aborted) {
            outcome = "aborted";
          } else {
            outcome = "error";
            request.log.error({ err }, "chat stream failed after start");
            counts.error = (counts.error ?? 0) + 1;
            await write(
              encodeSseEvent({ type: "error", code: "INTERNAL", message: "Something went wrong." }),
            );
          }
        }
      } else {
        outcome = "aborted";
      }
    } catch (err) {
      if (streaming) throw err; // unreachable in practice; inner catch handles stream errors
      if (ac.signal.aborted) {
        outcome = "aborted";
      } else {
        outcome = err instanceof HttpError && err.code === "RELEASE_UNKNOWN" ? "release_unknown" : "error";
        cleanup();
        metrics.chatRequests.labels({ outcome }).inc();
        throw err;
      }
    }

    cleanup();
    if (outcome === "aborted" && !streaming) {
      // Client is gone before we responded; nothing to send but we must settle the reply.
      reply.hijack();
      raw.end();
    } else if (streaming && !raw.writableEnded) {
      raw.end();
    }
    metrics.chatRequests.labels({ outcome }).inc();
    metrics.chatStreamDuration.observe((performance.now() - startedAt) / 1000);
    request.log.info(
      {
        requestId: request.id,
        subject: subjectHash(identity.subject),
        releaseId,
        events: counts,
        durationMs: Math.round(performance.now() - startedAt),
        done: doneStatus,
        aborted: outcome === "aborted",
        outcome,
      },
      "chat turn",
    );
    return reply;
  });
};
