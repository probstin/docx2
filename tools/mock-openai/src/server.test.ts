import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embedText } from "./embed.js";
import { DECLINE_SENTENCE, startMockOpenAI, type MockOpenAI } from "./server.js";

let mock: MockOpenAI;
beforeAll(async () => {
  mock = await startMockOpenAI({ dimensions: 64, delayMs: 1 });
});
afterAll(async () => {
  await mock.close();
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${mock.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const cos = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);

describe("embeddings", () => {
  it("returns OpenAI-shaped, normalized, deterministic vectors", async () => {
    const res = await post("/v1/embeddings", { model: "m", input: ["roll back a release", "gateway port"] });
    const body = (await res.json()) as { data: { embedding: number[]; index: number }[]; usage: unknown };
    expect(body.data).toHaveLength(2);
    expect(body.data[1]!.index).toBe(1);
    expect(body.data[0]!.embedding).toHaveLength(64);
    expect(Math.hypot(...body.data[0]!.embedding)).toBeCloseTo(1, 6);
    expect(body.usage).toBeDefined();
    const again = (await (
      await post("/v1/embeddings", { input: "roll back a release" })
    ).json()) as typeof body;
    expect(again.data[0]!.embedding).toEqual(body.data[0]!.embedding);
  });

  it("honors the dimensions field and accepts a string input", async () => {
    const res = await post("/v1/embeddings", { input: "hello world", dimensions: 16 });
    const body = (await res.json()) as { data: { embedding: number[] }[] };
    expect(body.data[0]!.embedding).toHaveLength(16);
  });

  it("is lexically meaningful and stems", () => {
    const q = embedText("rolling back deployments", 1024);
    const near = embedText("To roll back a deployment run atlasctl rollback", 1024);
    const far = embedText("The on-call rotation changes every Tuesday", 1024);
    expect(cos(q, near)).toBeGreaterThan(cos(q, far));
    expect(cos(embedText("Releases", 256), embedText("release", 256))).toBeCloseTo(1, 6);
  });

  it("rejects bad input", async () => {
    expect((await post("/v1/embeddings", { input: 5 })).status).toBe(400);
  });
});

describe("chat completions", () => {
  const withSource = [
    { role: "system", content: "rules" },
    {
      role: "user",
      content:
        '<source index="1" title="T" url="/u">Rollback takes 90 seconds. Use atlasctl. Third.</source>\n<source index="2">Other.</source>\nQ?',
    },
  ];

  it("answers non-streaming with a grounded cited echo of the first source", async () => {
    const body = (await (await post("/v1/chat/completions", { messages: withSource })).json()) as {
      choices: { message: { content: string } }[];
    };
    expect(body.choices[0]!.message.content).toBe("Rollback takes 90 seconds. Use atlasctl. [1]");
  });

  it("declines when there are no context blocks", async () => {
    const body = (await (
      await post("/v1/chat/completions", { messages: [{ role: "user", content: "hi" }] })
    ).json()) as { choices: { message: { content: string } }[] };
    expect(body.choices[0]!.message.content).toBe(DECLINE_SENTENCE);
  });

  it("streams SSE deltas then [DONE]", async () => {
    const res = await post("/v1/chat/completions", { messages: withSource, stream: true });
    const text = await res.text();
    const events = text
      .split("\n\n")
      .filter(Boolean)
      .map((e) => e.replace(/^data: /, ""));
    expect(events.at(-1)).toBe("[DONE]");
    const content = events
      .slice(0, -1)
      .map(
        (e) =>
          (JSON.parse(e) as { choices: { delta: { content?: string } }[] }).choices[0]!.delta.content ?? "",
      )
      .join("");
    expect(content).toBe("Rollback takes 90 seconds. Use atlasctl. [1]");
  });

  it("stops writing when the client disconnects", async () => {
    const slow = await startMockOpenAI({ delayMs: 20, dimensions: 8 });
    try {
      const long = { role: "user", content: `<source index="1">${"word ".repeat(60)}end.</source>` };
      const ac = new AbortController();
      const res = await fetch(`${slow.url}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ messages: [long], stream: true }),
        signal: ac.signal,
      });
      const reader = res.body!.getReader();
      await reader.read();
      ac.abort();
      await expect(reader.read()).rejects.toThrow();
    } finally {
      await slow.close();
    }
  });
});

describe("models and auth", () => {
  it("lists models", async () => {
    const body = (await (await fetch(`${mock.url}/v1/models`)).json()) as { data: { id: string }[] };
    expect(body.data.map((m) => m.id)).toContain("mock-chat");
  });

  it("requires the bearer key when configured", async () => {
    const secured = await startMockOpenAI({ apiKey: "k3y" });
    try {
      expect((await fetch(`${secured.url}/v1/models`)).status).toBe(401);
      const bad = await fetch(`${secured.url}/v1/models`, { headers: { authorization: "Bearer nope" } });
      expect(bad.status).toBe(401);
      const ok = await fetch(`${secured.url}/v1/models`, { headers: { authorization: "Bearer k3y" } });
      expect(ok.status).toBe(200);
    } finally {
      await secured.close();
    }
  });
});
