// @vitest-environment jsdom
import { CHAT_LIMITS } from "@docs-platform/contracts";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildHistory, useChat } from "./useChat.js";
import { useChatMode } from "./useChatMode.js";
import {
  CITATION,
  controlledStream,
  jsonError,
  okEvents,
  RELEASE,
  sseChunks,
  streamResponse,
} from "./test-helpers.js";
import type { UiMessage } from "./types.js";

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

type Fetch = typeof fetch;

function setup(fetchImpl: Fetch, extra: { historyLimit?: number } = {}, key = "t:chat") {
  return renderHook(() =>
    useChat({
      endpoint: "/api/v1/chat",
      releaseId: RELEASE,
      getPageContext: () => ({ url: "http://x/docs/a", title: "A", heading: "H" }),
      storageKey: key,
      fetchImpl,
      ...extra,
    }),
  );
}

const okFetch = (): Fetch => (async () => streamResponse(sseChunks(okEvents, 6))) as Fetch;

describe("useChat", () => {
  it("accumulates deltas and attaches citations", async () => {
    const { result } = setup(okFetch());
    act(() => result.current.send("question"));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    const a = result.current.messages[1]!;
    expect(a).toMatchObject({
      content: "Hello world",
      status: "complete",
      answerStatus: "grounded",
      citations: [CITATION],
    });
  });

  it("sends context and handles insufficient_context", async () => {
    const calls: RequestInit[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      calls.push(init);
      return streamResponse(
        sseChunks([
          { type: "delta", text: "I can't tell" },
          { type: "citations", sources: [] },
          { type: "done", status: "insufficient_context" },
        ]),
      );
    }) as unknown as Fetch;
    const { result } = setup(f);
    act(() => result.current.send("q"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.messages[1]?.answerStatus).toBe("insufficient_context");
    expect(JSON.parse(calls[0]!.body as string)).toMatchObject({
      message: "q",
      history: [],
      context: { releaseId: RELEASE, pageUrl: "http://x/docs/a", pageTitle: "A", heading: "H" },
    });
  });

  it("cancel keeps partial text, marks cancelled and aborts the signal", async () => {
    let signal: AbortSignal | null | undefined;
    let stream!: ReturnType<typeof controlledStream>;
    const f = (async (_u: string, init: RequestInit) => {
      signal = init.signal;
      stream = controlledStream(init.signal);
      return stream.response;
    }) as unknown as Fetch;
    const { result } = setup(f);
    act(() => result.current.send("q"));
    await waitFor(() => expect(stream).toBeDefined());
    stream.push(sseChunks([{ type: "delta", text: "partial" }], 1000)[0]!);
    await waitFor(() => expect(result.current.messages[1]?.content).toBe("partial"));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(signal?.aborted).toBe(true);
    expect(result.current.messages[1]).toMatchObject({ status: "cancelled", content: "partial" });
  });

  it("ignores send while streaming", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => controlledStream(init.signal).response);
    const { result } = setup(f as unknown as Fetch);
    act(() => result.current.send("one"));
    act(() => result.current.send("two"));
    expect(f).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toHaveLength(2);
  });

  it("aborts in-flight stream on unmount", async () => {
    let signal: AbortSignal | null | undefined;
    const f = (async (_u: string, init: RequestInit) => {
      signal = init.signal;
      return controlledStream(init.signal).response;
    }) as unknown as Fetch;
    const { result, unmount } = setup(f);
    act(() => result.current.send("q"));
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("retries after an error, replacing the failed assistant message", async () => {
    let n = 0;
    const f = (async () => {
      n += 1;
      return n === 1
        ? jsonError(429, "RATE_LIMITED", { "retry-after": "3" })
        : streamResponse(sseChunks(okEvents));
    }) as unknown as Fetch;
    const { result } = setup(f);
    act(() => result.current.send("q"));
    await waitFor(() => expect(result.current.messages[1]?.status).toBe("error"));
    expect(result.current.messages[1]?.errorMessage).toContain("3 seconds");
    const failedId = result.current.messages[1]!.id;
    act(() => result.current.retry(failedId));
    await waitFor(() => expect(result.current.messages[1]?.status).toBe("complete"));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]?.id).not.toBe(failedId);
    expect(result.current.messages[1]?.content).toBe("Hello world");
  });

  it.each([
    [() => jsonError(401, "UNAUTHENTICATED"), "session expired"],
    [() => jsonError(404, "RELEASE_UNKNOWN"), "documentation was updated"],
    [() => jsonError(429, "RATE_LIMITED", { "retry-after": "5" }), "5 seconds"],
    [
      () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      "session expired",
    ],
  ])("maps failure responses to friendly messages (%#)", async (make, expected) => {
    const { result } = setup((async () => make()) as unknown as Fetch);
    act(() => result.current.send("q"));
    await waitFor(() => expect(result.current.messages[1]?.status).toBe("error"));
    expect(result.current.messages[1]?.errorMessage).toContain(expected);
  });

  it("turns a stream without done into an error", async () => {
    const f = (async () => streamResponse(sseChunks(okEvents.slice(0, 2)))) as unknown as Fetch;
    const { result } = setup(f);
    act(() => result.current.send("q"));
    await waitFor(() => expect(result.current.messages[1]?.status).toBe("error"));
    expect(result.current.messages[1]?.errorMessage).toContain("interrupted");
    expect(result.current.messages[1]?.content).toBe("Hello ");
  });

  it("maps a server error event", async () => {
    const f = (async () =>
      streamResponse(
        sseChunks([{ type: "error", code: "UPSTREAM_UNAVAILABLE", message: "model down" }]),
      )) as unknown as Fetch;
    const { result } = setup(f);
    act(() => result.current.send("q"));
    await waitFor(() => expect(result.current.messages[1]?.status).toBe("error"));
    expect(result.current.messages[1]?.errorMessage).toBe("model down");
  });

  it("sends trimmed history that excludes failed turns", async () => {
    const bodies: { history: { role: string; content: string }[] }[] = [];
    let fail = false;
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return fail ? jsonError(404, "RELEASE_UNKNOWN") : streamResponse(sseChunks(okEvents, 50));
    }) as unknown as Fetch;
    const { result } = setup(f, { historyLimit: 4 });
    for (let i = 0; i < 4; i += 1) {
      act(() => result.current.send(`q${i}`));
      await waitFor(() => expect(result.current.isStreaming).toBe(false));
    }
    fail = true;
    act(() => result.current.send("bad"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    fail = false;
    act(() => result.current.send("final"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    const history = bodies.at(-1)!.history;
    expect(history).toHaveLength(4);
    expect(history.map((h) => h.content)).toEqual(["q2", "Hello world", "q3", "Hello world"]);
  });

  it("clear empties messages and storage", async () => {
    const { result } = setup(okFetch());
    act(() => result.current.send("q"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    act(() => result.current.clear());
    expect(result.current.messages).toEqual([]);
    expect(sessionStorage.getItem("t:chat")).toBeNull();
  });

  it("persists across remounts, with stale streaming restored as cancelled", async () => {
    const f = (async (_u: string, init: RequestInit) =>
      controlledStream(init.signal).response) as unknown as Fetch;
    const first = setup(f);
    act(() => first.result.current.send("q"));
    first.unmount();
    const second = setup(okFetch());
    expect(second.result.current.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(second.result.current.messages[1]?.status).toBe("cancelled");
  });

  it("works when storage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result, unmount } = setup(okFetch());
    act(() => result.current.send("q"));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.messages[1]?.content).toBe("Hello world");
    expect(() => unmount()).not.toThrow();
    vi.restoreAllMocks();
  });
});

describe("buildHistory", () => {
  const m = (role: UiMessage["role"], content: string, status: UiMessage["status"] = "complete") =>
    ({ id: content, role, content, status }) as UiMessage;

  it("drops failed pairs and clips to contract limits", () => {
    const msgs = [
      m("user", "a"),
      m("assistant", "b", "error"),
      m("user", "c"),
      m("assistant", "x".repeat(CHAT_LIMITS.historyMessageMaxChars + 10)),
    ];
    const h = buildHistory(msgs, 100);
    expect(h.map((x) => x.role)).toEqual(["user", "assistant"]);
    expect(h[1]!.content).toHaveLength(CHAT_LIMITS.historyMessageMaxChars);
  });

  it("never exceeds the contract message limit", () => {
    const msgs = Array.from({ length: 40 }, (_, i) => m(i % 2 ? "assistant" : "user", `m${i}`));
    expect(buildHistory(msgs, 1000)).toHaveLength(CHAT_LIMITS.historyMaxMessages);
  });
});

describe("useChatMode", () => {
  it("persists across remounts", () => {
    const a = renderHook(() => useChatMode("t:chat"));
    expect(a.result.current[0]).toBe("closed");
    act(() => a.result.current[1]("fullscreen"));
    a.unmount();
    const b = renderHook(() => useChatMode("t:chat"));
    expect(b.result.current[0]).toBe("fullscreen");
  });
});
