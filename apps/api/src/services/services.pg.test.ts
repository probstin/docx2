import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SiteInfoSchema, createReleaseId, type ReleaseManifest } from "@docs-platform/contracts";
import {
  activateRelease,
  createCandidateRelease,
  createPool,
  failRelease,
  markReleaseReady,
  migrate,
  type Pool,
} from "@docs-platform/storage";
import { databaseReadiness } from "./readiness.js";
import { createReleaseService } from "./releases.js";
import { createSiteService } from "./site.js";

const hasPg = Boolean(process.env.PGHOST);
const sha = (n: number) => n.toString(16).padStart(40, "0");

describe.skipIf(!hasPg)("storage-backed services", () => {
  const name = `api_test_${randomBytes(6).toString("hex")}`;
  let pool: Pool;
  let n = 0;

  beforeAll(async () => {
    const admin = createPool({ max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    pool = createPool({ database: name, max: 4 });
    await migrate(pool);
  });
  afterAll(async () => {
    await pool?.end();
    const admin = createPool({ max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  async function newRelease(docsYaml: unknown) {
    const gitSha = sha(++n);
    const id = createReleaseId(gitSha, new Date(Date.UTC(2026, 0, 1, 0, 0, n)));
    await createCandidateRelease(pool, {
      id,
      gitSha,
      artifactPath: `releases/${id}`,
      embeddingModel: "m",
      embeddingDimensions: 3,
      docsYaml,
    });
    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      releaseId: id,
      gitSha,
      source: { url: "https://git.example/repo.git", branch: "main" },
      builtAt: new Date().toISOString(),
      site: { title: "t", basePath: "/", pages: [], hashedAssets: [], fileCount: 0 },
      index: { documents: 0, chunks: 0, embeddingModel: "m", dimensions: 3 },
    };
    await markReleaseReady(pool, id, manifest);
    return id;
  }

  it("readiness runs SELECT 1", async () => {
    await expect(databaseReadiness(pool).check()).resolves.toBeUndefined();
  });

  it("SiteService: defaults with no active release", async () => {
    const info = await createSiteService(pool).getSiteInfo();
    expect(SiteInfoSchema.parse(info).activeRelease).toBeNull();
    expect(info.basePath).toBe("/");
    expect(info.assistant.enabled).toBe(true);
  });

  it("SiteService: reads title/basePath/assistant from the active release's docs.yaml", async () => {
    const id = await newRelease({
      schemaVersion: 1,
      site: { title: "Acme Docs", basePath: "/product/" },
      assistant: { title: "Ask Acme", citations: false },
    });
    await activateRelease(pool, id);
    const info = SiteInfoSchema.parse(await createSiteService(pool).getSiteInfo());
    expect(info).toMatchObject({
      title: "Acme Docs",
      basePath: "/product/",
      assistant: { title: "Ask Acme", citations: false, enabled: true },
      activeRelease: { id, status: "ACTIVE" },
    });
  });

  it("ReleaseService: queryable states, positive caching, no negative caching", async () => {
    const active = await newRelease({ schemaVersion: 1, site: { title: "x" } });
    const ready = await newRelease({ schemaVersion: 1, site: { title: "x" } });
    await activateRelease(pool, active);
    let clock = 0;
    let queries = 0;
    const counting = {
      query: ((...args: Parameters<Pool["query"]>) => {
        queries++;
        return (pool.query as (...a: unknown[]) => unknown)(...args);
      }) as Pool["query"],
    };
    const svc = createReleaseService(counting, { positiveTtlMs: 30_000, now: () => clock });

    expect(await svc.isChatQueryable(active)).toBe(true);
    expect(await svc.isChatQueryable(ready)).toBe(false); // READY, not yet queryable
    expect(await svc.isChatQueryable("20200101000000-abcdef1")).toBe(false);

    // positive result is cached: no further query within the TTL, re-checked after it
    const before = queries;
    expect(await svc.isChatQueryable(active)).toBe(true);
    expect(queries).toBe(before);
    clock = 31_000;
    expect(await svc.isChatQueryable(active)).toBe(true);
    expect(queries).toBe(before + 1);

    // a release that becomes queryable is seen immediately (negatives not cached)
    await activateRelease(pool, ready);
    expect(await svc.isChatQueryable(ready)).toBe(true);
  });

  it("ReleaseService: FAILED releases are not queryable", async () => {
    const gitSha = sha(++n);
    const id = createReleaseId(gitSha, new Date(Date.UTC(2026, 0, 2, 0, 0, n)));
    await createCandidateRelease(pool, {
      id,
      gitSha,
      artifactPath: "x",
      embeddingModel: "m",
      embeddingDimensions: 3,
      docsYaml: {},
    });
    await failRelease(pool, id, "boom");
    expect(await createReleaseService(pool).isChatQueryable(id)).toBe(false);
  });
});
