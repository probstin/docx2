import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCheckout } from "@docs-platform/sources";
import { countIndex, createCandidateRelease, getRelease, migrate, type Pool } from "@docs-platform/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexRelease } from "./ingest.js";
import { createTestDatabase } from "./testing.js";
import type { EmbeddingsClient } from "./types.js";

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/sample-docs");
const DIMS = 8;

const fake = (fail = false): EmbeddingsClient => ({
  embedDocuments: async (texts) => {
    if (fail) throw new Error("embeddings down");
    return texts.map((t) => Array.from({ length: DIMS }, (_, i) => ((t.length + i) % 7) + 1));
  },
  embedQuery: async () => Array.from({ length: DIMS }, () => 1),
});

describe.skipIf(!process.env.PGHOST)("indexRelease", () => {
  let pool: Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const db = await createTestDatabase();
    pool = db.pool;
    drop = db.drop;
    await migrate(pool);
  });
  afterAll(async () => {
    await drop?.();
  });

  const candidate = (id: string) =>
    createCandidateRelease(pool, {
      id,
      gitSha: "abcdef1234567890abcdef1234567890abcdef12",
      artifactPath: `releases/${id}`,
      embeddingModel: "fake",
      embeddingDimensions: DIMS,
      docsYaml: {},
    });

  it("indexes documents and returns verified counts", async () => {
    const { documents } = await readCheckout(SAMPLE);
    await candidate("20260101000001-abcdef1");
    const res = await indexRelease({
      pool,
      releaseId: "20260101000001-abcdef1",
      documents,
      embeddings: fake(),
      groupSize: 10,
    });
    expect(res.documents).toBe(documents.length);
    expect(res.chunks).toBeGreaterThan(documents.length);
    expect(await countIndex(pool, "20260101000001-abcdef1")).toEqual(res);
  });

  it("surfaces embedding failures and leaves the release CANDIDATE", async () => {
    const { documents } = await readCheckout(SAMPLE);
    await candidate("20260101000002-abcdef1");
    await expect(
      indexRelease({ pool, releaseId: "20260101000002-abcdef1", documents, embeddings: fake(true) }),
    ).rejects.toThrow("embeddings down");
    expect((await getRelease(pool, "20260101000002-abcdef1"))?.status).toBe("CANDIDATE");
  });

  it("rejects wrong-dimension vectors from the store", async () => {
    const { documents } = await readCheckout(SAMPLE);
    await candidate("20260101000003-abcdef1");
    const wrong: EmbeddingsClient = { ...fake(), embedDocuments: async (t) => t.map(() => [1, 2, 3]) };
    await expect(
      indexRelease({ pool, releaseId: "20260101000003-abcdef1", documents, embeddings: wrong }),
    ).rejects.toThrow();
  });
});
