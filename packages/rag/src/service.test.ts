import type { ChatRequest, ChatStreamEvent, PlatformIdentity } from "@docs-platform/contracts";
import type { Pool } from "@docs-platform/storage";
import { describe, expect, it } from "vitest";
import { DECLINE_TEXT, buildCitations, createChatService } from "./service.js";
import type { RetrievedChunk } from "./retrieve.js";
import type { ChatMessage, ChatModelClient, EmbeddingsClient } from "./types.js";

const RELEASE = "20260101000000-abcdef1";

function fakePool(scores: number[]): Pool {
  const rows = scores.map((s, i) => ({
    chunk_id: `c${i}`,
    document_id: `d${i}`,
    content: `content ${i}`,
    heading: i === 0 ? "Rollback" : null,
    anchor: i === 0 ? "rollback" : null,
    ordinal: 0,
    title: `Doc ${i}`,
    source_path: `docs/${i}.md`,
    rendered_url: `/docs/${i}`,
    score: s,
  }));
  return {
    query: async (sql: string) =>
      sql.includes("embedding_dimensions") ? { rows: [{ embedding_dimensions: 2 }] } : { rows },
  } as unknown as Pool;
}

const embeddings: EmbeddingsClient = {
  embedDocuments: async (t) => t.map(() => [1, 0]),
  embedQuery: async () => [1, 0],
};

const request: ChatRequest = {
  message: "How do I roll back?",
  history: [],
  context: { releaseId: RELEASE, pageUrl: "/docs/0", heading: "Rollback" },
};
const identity = {} as PlatformIdentity;
const retrieval = { RETRIEVAL_TOP_K: 4, RETRIEVAL_PAGE_CONTEXT_BOOST: true, RETRIEVAL_MIN_SCORE: 0.3 };

async function collect(it: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function chatOf(parts: string[], onCall?: (m: ChatMessage[]) => void): ChatModelClient {
  return {
    async *stream(messages) {
      onCall?.(messages);
      for (const p of parts) yield p;
    },
  };
}

describe("createChatService", () => {
  it("streams start, deltas, citations of referenced sources, done(grounded)", async () => {
    const svc = createChatService({
      pool: fakePool([0.8, 0.6, 0.5]),
      embeddings,
      chat: chatOf(["Run the command ", "[2]", "."]),
      retrieval,
    });
    const events = await collect(svc.stream({ request, identity, signal: new AbortController().signal }));
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta", "delta", "citations", "done"]);
    const citations = events.find((e) => e.type === "citations") as Extract<
      ChatStreamEvent,
      { type: "citations" }
    >;
    expect(citations.sources).toHaveLength(1);
    expect(citations.sources[0]).toMatchObject({
      index: 2,
      url: "/docs/1",
      sourcePath: "docs/1.md",
      releaseId: RELEASE,
    });
    expect(events.at(-1)).toEqual({ type: "done", status: "grounded" });
  });

  it("lists all sources when the answer references none, with url#anchor", async () => {
    const svc = createChatService({
      pool: fakePool([0.8, 0.6]),
      embeddings,
      chat: chatOf(["No cites"]),
      retrieval,
    });
    const events = await collect(svc.stream({ request, identity, signal: new AbortController().signal }));
    const c = events.find((e) => e.type === "citations") as Extract<ChatStreamEvent, { type: "citations" }>;
    expect(c.sources.map((s) => s.url)).toEqual(["/docs/0#rollback", "/docs/1"]);
    expect(c.sources[0]).toMatchObject({ heading: "Rollback", anchor: "rollback", title: "Doc 0" });
  });

  it("declines without calling the model when retrieval is inadequate", async () => {
    let called = false;
    const svc = createChatService({
      pool: fakePool([0.1, 0.05]),
      embeddings,
      chat: chatOf(["x"], () => (called = true)),
      retrieval,
    });
    const events = await collect(svc.stream({ request, identity, signal: new AbortController().signal }));
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "done"]);
    expect(events[1]).toEqual({ type: "delta", text: DECLINE_TEXT });
    expect(events[2]).toEqual({ type: "done", status: "insufficient_context" });
    expect(called).toBe(false);
  });

  it("stops promptly when aborted mid-stream, even if the model ignores the signal", async () => {
    const ac = new AbortController();
    let pulled = 0;
    const chat: ChatModelClient = {
      async *stream() {
        for (;;) {
          pulled++;
          await new Promise((r) => setTimeout(r, 5));
          yield "word ";
        }
      },
    };
    const svc = createChatService({ pool: fakePool([0.9]), embeddings, chat, retrieval });
    const events: ChatStreamEvent[] = [];
    for await (const e of svc.stream({ request, identity, signal: ac.signal })) {
      events.push(e);
      if (events.filter((x) => x.type === "delta").length === 2) ac.abort();
    }
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "delta"]);
    const after = pulled;
    await new Promise((r) => setTimeout(r, 40));
    expect(pulled).toBeLessThanOrEqual(after + 1);
  });

  it("turns an upstream failure into a final error event", async () => {
    const chat: ChatModelClient = {
      async *stream() {
        yield "partial ";
        throw new Error("secret-token connection reset");
      },
    };
    const svc = createChatService({ pool: fakePool([0.9]), embeddings, chat, retrieval });
    const events = await collect(svc.stream({ request, identity, signal: new AbortController().signal }));
    expect(events.map((e) => e.type)).toEqual(["start", "delta", "error"]);
    const err = events.at(-1) as Extract<ChatStreamEvent, { type: "error" }>;
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(err.message).not.toContain("secret-token");
  });

  it("reports embedding failures as an error event, never throwing after start", async () => {
    const bad: EmbeddingsClient = {
      ...embeddings,
      embedQuery: async () => Promise.reject(new Error("down")),
    };
    const svc = createChatService({ pool: fakePool([0.9]), embeddings: bad, chat: chatOf(["x"]), retrieval });
    const events = await collect(svc.stream({ request, identity, signal: new AbortController().signal }));
    expect(events.map((e) => e.type)).toEqual(["start", "error"]);
  });
});

describe("buildCitations", () => {
  const src = (i: number) =>
    ({
      title: `T${i}`,
      renderedUrl: `/d/${i}`,
      sourcePath: `${i}.md`,
      heading: null,
      anchor: null,
    }) as unknown as RetrievedChunk;
  it("understands [1, 3] groups and ignores out-of-range numbers", () => {
    const out = buildCitations("see [1, 3] and [9]", [src(1), src(2), src(3)], RELEASE);
    expect(out.map((c) => c.index)).toEqual([1, 3]);
  });
});
