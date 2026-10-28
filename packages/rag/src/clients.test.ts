import { startMockOpenAI } from "@docs-platform/mock-openai";
import type { ModelsEnv } from "@docs-platform/contracts";
import { describe, expect, it } from "vitest";
import {
  EmbeddingDimensionError,
  createChatModelClient,
  createEmbeddingsClient,
  wrapEmbeddings,
} from "./clients.js";

const env = (url: string, dims: number): ModelsEnv => ({
  CHAT_BASE_URL: `${url}/v1`,
  CHAT_MODEL: "mock-chat",
  CHAT_API_KEY: "",
  CHAT_TEMPERATURE: 0,
  CHAT_MAX_TOKENS: 128,
  EMBEDDINGS_BASE_URL: `${url}/v1`,
  EMBEDDINGS_MODEL: "mock-embeddings",
  EMBEDDINGS_API_KEY: "",
  EMBEDDINGS_DIMENSIONS: dims,
});

describe("wrapEmbeddings", () => {
  it("batches with bounded concurrency and preserves order", async () => {
    let active = 0;
    let maxActive = 0;
    const calls: number[] = [];
    const inner = {
      async embedDocuments(texts: string[]) {
        calls.push(texts.length);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return texts.map((t) => [Number(t), 0]);
      },
      embedQuery: async () => [1, 0],
    };
    const client = wrapEmbeddings(inner, 2, { batchSize: 3, concurrency: 2 });
    const out = await client.embedDocuments(Array.from({ length: 10 }, (_, i) => String(i)));
    expect(out.map((v) => v[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(calls).toEqual([3, 3, 3, 1]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("throws a clear error on the wrong dimension", async () => {
    const client = wrapEmbeddings(
      { embedDocuments: async (t) => t.map(() => [1, 2, 3]), embedQuery: async () => [1, 2, 3] },
      4,
    );
    await expect(client.embedDocuments(["a"])).rejects.toThrow(EmbeddingDimensionError);
    await expect(client.embedQuery("a")).rejects.toThrow(/3 dimensions.*EMBEDDINGS_DIMENSIONS is 4/);
  });
});

describe("clients against the mock server", () => {
  it("embeds, validates dimensions, and omits `dimensions` unless asked", async () => {
    const mock = await startMockOpenAI({ dimensions: 32 });
    try {
      const ok = createEmbeddingsClient(env(mock.url, 32));
      expect((await ok.embedQuery("hello world")).length).toBe(32);
      // Without `dimensions` the server returns its own 32; configuring 16 must fail validation.
      const wrong = createEmbeddingsClient(env(mock.url, 16));
      await expect(wrong.embedDocuments(["a", "b"])).rejects.toThrow(/32 dimensions/);
      // With sendDimensions the server honors the request and the check passes.
      const sent = createEmbeddingsClient(env(mock.url, 16), { sendDimensions: true });
      expect((await sent.embedQuery("hello")).length).toBe(16);
    } finally {
      await mock.close();
    }
  });

  it("streams chat deltas and stops on abort", async () => {
    const mock = await startMockOpenAI({ dimensions: 8, delayMs: 30 });
    try {
      const chat = createChatModelClient(env(mock.url, 8));
      const messages = [
        { role: "user" as const, content: `<source index="1">${"word ".repeat(80)}end.</source>` },
      ];
      let text = "";
      for await (const d of chat.stream(messages, new AbortController().signal)) text += d;
      expect(text).toContain("[1]");

      const ac = new AbortController();
      const got: string[] = [];
      const run = (async () => {
        for await (const d of chat.stream(messages, ac.signal)) {
          got.push(d);
          if (got.length === 2) ac.abort();
        }
      })();
      await expect(run).rejects.toThrow();
      expect(got.length).toBeLessThan(10);
    } finally {
      await mock.close();
    }
  });
});
