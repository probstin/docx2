import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument } from "@docs-platform/contracts";
import { startMockOpenAI, type MockOpenAI } from "@docs-platform/mock-openai";
import { readCheckout } from "@docs-platform/sources";
import { createCandidateRelease, migrate, type Pool } from "@docs-platform/storage";
import { createTestDatabase } from "./testing.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createEmbeddingsClient } from "./clients.js";
import { indexRelease } from "./ingest.js";
import { DEFAULT_MIN_SCORE, retrieve } from "./retrieve.js";
import type { EmbeddingsClient } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(here, "../../../examples/sample-docs");
const DIMS = 1024;
const RELEASE_ID = "20260101000000-abcdef1";

interface Golden {
  questions: {
    q: string;
    source: string;
    anchor: string | null;
    page?: { url: string; heading?: string };
  }[];
  outOfScope: string[];
}

describe.skipIf(!process.env.PGHOST)("golden questions (sample-docs, mock embeddings)", () => {
  let mock: MockOpenAI;
  let pool: Pool;
  let drop: () => Promise<void>;
  let embeddings: EmbeddingsClient;
  let docs: SourceDocument[];
  const golden = parse(readFileSync(path.join(here, "../fixtures/golden.yaml"), "utf8")) as Golden;

  beforeAll(async () => {
    mock = await startMockOpenAI({ dimensions: DIMS });
    embeddings = createEmbeddingsClient({
      CHAT_BASE_URL: `${mock.url}/v1`,
      CHAT_MODEL: "mock-chat",
      CHAT_API_KEY: "",
      CHAT_TEMPERATURE: 0,
      CHAT_MAX_TOKENS: 256,
      EMBEDDINGS_BASE_URL: `${mock.url}/v1`,
      EMBEDDINGS_MODEL: "mock-embeddings",
      EMBEDDINGS_API_KEY: "",
      EMBEDDINGS_DIMENSIONS: DIMS,
    });
    const db = await createTestDatabase();
    pool = db.pool;
    drop = db.drop;
    await migrate(pool);
    docs = (await readCheckout(SAMPLE)).documents;
    await createCandidateRelease(pool, {
      id: RELEASE_ID,
      gitSha: "abcdef1234567890abcdef1234567890abcdef12",
      artifactPath: `releases/${RELEASE_ID}`,
      embeddingModel: "mock-embeddings",
      embeddingDimensions: DIMS,
      docsYaml: {},
    });
    const result = await indexRelease({ pool, releaseId: RELEASE_ID, documents: docs, embeddings });
    expect(result.documents).toBe(docs.length);
  }, 60_000);

  afterAll(async () => {
    await drop?.();
    await mock?.close();
  });

  const ask = (q: string, page?: { url: string; heading?: string }, minScore = DEFAULT_MIN_SCORE) =>
    retrieve({
      pool,
      releaseId: RELEASE_ID,
      query: q,
      embeddings,
      pageContext: page ? { pageUrl: page.url, heading: page.heading } : undefined,
      topK: 8,
      minScore,
      pageBoost: true,
    });

  it("finds the expected source in the top 3 for >= 90% of in-scope questions", async () => {
    const lines: string[] = [];
    let hits = 0;
    for (const g of golden.questions) {
      const { chunks } = await ask(g.q, g.page);
      const top3 = chunks.slice(0, 3);
      const ok = top3.some(
        (c) => c.sourcePath === g.source && (g.anchor === null || (c.anchor ?? null) === g.anchor),
      );
      if (ok) hits++;
      lines.push(
        `${ok ? "PASS" : "FAIL"}  ${g.q}  -> ${top3
          .map((c) => `${c.sourcePath}#${c.anchor ?? ""}@${c.rawScore.toFixed(2)}`)
          .join(" | ")}`,
      );
    }
    const declined: string[] = [];
    const failures: string[] = [];
    for (const q of golden.outOfScope) {
      const r = await ask(q);
      declined.push(
        `${r.adequate ? "FAIL" : "PASS"}  (out of scope) ${q}  -> best raw ${(r.best ?? 0).toFixed(2)}`,
      );
      if (r.adequate) failures.push(q);
    }
    const rate = hits / golden.questions.length;
    console.log(
      `Golden eval (minScore=${DEFAULT_MIN_SCORE}): ${hits}/${golden.questions.length} in top 3 (${(rate * 100).toFixed(0)}%); ` +
        `${golden.outOfScope.length}/${golden.outOfScope.length} out-of-scope declined\n${[...lines, ...declined].join("\n")}`,
    );
    expect(failures, "out-of-scope questions that were not declined").toEqual([]);
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it("only cites anchors that exist in the document's headings", async () => {
    const byPath = new Map(docs.map((d) => [d.path, d]));
    for (const g of golden.questions) {
      const { chunks } = await ask(g.q, g.page);
      for (const c of chunks) {
        if (c.anchor === null) continue;
        const doc = byPath.get(c.sourcePath);
        expect(doc, c.sourcePath).toBeDefined();
        expect(doc!.metadata.headings.map((h) => h.anchor)).toContain(c.anchor);
      }
    }
  });
});
