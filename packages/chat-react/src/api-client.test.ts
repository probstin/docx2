// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ChatApiError, isAbortError, streamChat } from "./api-client.js";
import { controlledStream, jsonError, okEvents, RELEASE, sseChunks, streamResponse } from "./test-helpers.js";

const request = {
  message: "hi",
  history: [],
  context: { releaseId: RELEASE, pageUrl: "http://x/docs" },
};

async function collect(fetchImpl: typeof fetch) {
  const out = [];
  for await (const e of streamChat({ endpoint: "/api/v1/chat", request, fetchImpl })) out.push(e);
  return out;
}

async function failure(fetchImpl: typeof fetch): Promise<ChatApiError> {
  try {
    await collect(fetchImpl);
  } catch (e) {
    return e as ChatApiError;
  }
  throw new Error("expected failure");
}

describe("streamChat", () => {
  it("posts JSON with same-origin credentials and decodes split chunks", async () => {
    const fetchImpl = vi.fn(async () => streamResponse(sseChunks(okEvents, 5)));
    const events = await collect(fetchImpl as unknown as typeof fetch);
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta", "citations", "done"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/chat");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
    expect(JSON.parse(init.body as string).message).toBe("hi");
  });

  it("maps 401 to a session message", async () => {
    const e = await failure((async () => jsonError(401, "UNAUTHENTICATED")) as typeof fetch);
    expect(e).toBeInstanceOf(ChatApiError);
    expect(e.status).toBe(401);
    expect(e.message).toBe("Your session expired, reload the page to sign in again");
  });

  it("maps 404 RELEASE_UNKNOWN", async () => {
    const e = await failure((async () => jsonError(404, "RELEASE_UNKNOWN")) as typeof fetch);
    expect(e.code).toBe("RELEASE_UNKNOWN");
    expect(e.message).toBe("The documentation was updated, reload the page");
  });

  it("uses Retry-After for 429", async () => {
    const e = await failure((async () =>
      jsonError(429, "RATE_LIMITED", { "retry-after": "12" })) as typeof fetch);
    expect(e.retryAfterSeconds).toBe(12);
    expect(e.message).toContain("12 seconds");
  });

  it("treats an HTML gateway page as a session problem", async () => {
    const html = async () =>
      new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } });
    expect((await failure(html as typeof fetch)).code).toBe("SESSION_EXPIRED");
    const html502 = async () =>
      new Response("<html>x</html>", { status: 502, headers: { "content-type": "text/html" } });
    expect((await failure(html502 as typeof fetch)).code).toBe("SESSION_EXPIRED");
  });

  it("reports a stream ending without done as interrupted", async () => {
    const e = await failure((async () => streamResponse(sseChunks(okEvents.slice(0, 3)))) as typeof fetch);
    expect(e.code).toBe("STREAM_INTERRUPTED");
  });

  it("throws an AbortError when aborted mid-stream", async () => {
    const ac = new AbortController();
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const s = controlledStream(init.signal);
      s.push(sseChunks([okEvents[1]!], 1000)[0]!);
      return s.response;
    }) as unknown as typeof fetch;
    const gen = streamChat({ endpoint: "/x", request, signal: ac.signal, fetchImpl });
    await gen.next();
    ac.abort();
    await expect(gen.next()).rejects.toSatisfy(isAbortError);
  });
});
