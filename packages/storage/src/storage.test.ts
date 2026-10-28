import { createReleaseId, type ReleaseManifest } from "@docs-platform/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activateRelease,
  claimNextQueued,
  countIndex,
  createBuild,
  createCandidateRelease,
  failRelease,
  getActiveRelease,
  getBuildDetail,
  hasPublishedBuildForSha,
  insertChunks,
  insertDocument,
  isChatQueryable,
  listBuilds,
  listPrunableReleases,
  listReleaseEvents,
  markReleasePruned,
  markReleaseReady,
  searchChunks,
  supersedeQueuedOlderThan,
  transitionBuild,
  StorageError,
  withTransaction,
} from "./index.js";
import { migrate } from "./migrate.js";
import { createTestDatabase, hasPg } from "./testing.js";

const sha = (n: number) => n.toString(16).padStart(40, "0");
let relCounter = 0;

function manifestFor(id: string, gitSha: string, dims = 3): ReleaseManifest {
  return {
    schemaVersion: 1,
    releaseId: id,
    gitSha,
    source: { url: "https://git.example/repo.git", branch: "main" },
    builtAt: new Date().toISOString(),
    site: { title: "t", basePath: "/", pages: [], hashedAssets: [], fileCount: 0 },
    index: { documents: 0, chunks: 0, embeddingModel: "m", dimensions: dims },
  };
}

describe.skipIf(!hasPg)("storage repositories", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  const pool = () => db.pool;

  beforeAll(async () => {
    db = await createTestDatabase();
    await migrate(db.pool);
  });
  afterAll(async () => {
    await db?.drop();
  });

  async function newRelease(dims = 3, ready = true) {
    const n = ++relCounter;
    const gitSha = sha(n);
    const id = createReleaseId(gitSha, new Date(Date.UTC(2026, 0, 1, 0, 0, n)));
    await createCandidateRelease(pool(), {
      id,
      gitSha,
      artifactPath: `releases/${id}`,
      embeddingModel: "m",
      embeddingDimensions: dims,
      docsYaml: { a: 1 },
    });
    if (ready) {
      const r = await markReleaseReady(pool(), id, manifestFor(id, gitSha, dims));
      expect(r.ok).toBe(true);
    }
    return id;
  }

  describe("builds", () => {
    it("creates builds with history and rejects duplicate open SHA", async () => {
      const r1 = await createBuild(pool(), { trigger: "webhook", gitSha: sha(1000) });
      expect(r1.ok).toBe(true);
      const r2 = await createBuild(pool(), { trigger: "manual", gitSha: sha(1000) });
      expect(r2).toMatchObject({ ok: false, reason: "duplicate_open" });
      if (!r1.ok) throw new Error();
      const detail = await getBuildDetail(pool(), r1.build.id);
      expect(detail?.history.map((h) => h.status)).toEqual(["QUEUED"]);
      // After it terminates, the same SHA may be built again.
      await transitionBuild(pool(), r1.build.id, "QUEUED", "FAILED", { error: "boom" });
      expect((await createBuild(pool(), { trigger: "manual", gitSha: sha(1000) })).ok).toBe(true);
    });

    it("allows multiple builds with unknown SHA", async () => {
      expect((await createBuild(pool(), { trigger: "manual" })).ok).toBe(true);
      expect((await createBuild(pool(), { trigger: "manual" })).ok).toBe(true);
    });

    it("guarded transition loses a race and rejects invalid transitions", async () => {
      const r = await createBuild(pool(), { trigger: "webhook", gitSha: sha(1001) });
      if (!r.ok) throw new Error();
      const id = r.build.id;
      const results = await Promise.all([
        transitionBuild(pool(), id, "QUEUED", "CHECKOUT", { k8sJobName: "job-a" }),
        transitionBuild(pool(), id, "QUEUED", "SUPERSEDED"),
      ]);
      expect(results.filter((x) => x.ok)).toHaveLength(1);
      expect(results.filter((x) => !x.ok && x.reason === "lost_race")).toHaveLength(1);
      expect(await transitionBuild(pool(), id, "QUEUED", "PUBLISHED")).toMatchObject({
        ok: false,
        reason: "invalid_transition",
      });
      expect(
        await transitionBuild(pool(), "00000000-0000-0000-0000-000000000000", "QUEUED", "CHECKOUT"),
      ).toMatchObject({
        ok: false,
        reason: "not_found",
      });
    });

    it("transitionBuild reports duplicate_open instead of throwing, and keeps the caller's transaction usable", async () => {
      const s = sha(1500);
      const a = await createBuild(pool(), { trigger: "webhook", gitSha: s });
      const b = await createBuild(pool(), { trigger: "manual" });
      if (!a.ok || !b.ok) throw new Error();
      // Pool form.
      expect(await transitionBuild(pool(), b.build.id, "QUEUED", "CHECKOUT", { gitSha: s })).toEqual({
        ok: false,
        reason: "duplicate_open",
      });
      expect((await getBuildDetail(pool(), b.build.id))?.status).toBe("QUEUED");
      // Client form: the surrounding transaction must survive.
      await withTransaction(pool(), async (tx) => {
        expect(await transitionBuild(tx, b.build.id, "QUEUED", "CHECKOUT", { gitSha: s })).toMatchObject({
          ok: false,
          reason: "duplicate_open",
        });
        const ok = await transitionBuild(tx, b.build.id, "QUEUED", "CHECKOUT", { gitSha: sha(1501) });
        expect(ok).toMatchObject({ ok: true });
        expect(await getBuildDetail(tx, b.build.id)).toMatchObject({ status: "CHECKOUT", gitSha: sha(1501) });
      });
    });

    it("rejects malformed and unknown ids/cursors without leaking raw pg errors", async () => {
      expect(await getBuildDetail(pool(), "not-a-uuid")).toBeNull();
      expect(await getBuildDetail(pool(), "00000000-0000-0000-0000-000000000000")).toBeNull();
      expect(await transitionBuild(pool(), "not-a-uuid", "QUEUED", "CHECKOUT")).toMatchObject({
        ok: false,
        reason: "not_found",
      });
      const bad = await listBuilds(pool(), { limit: 5, cursor: "not-a-uuid" }).catch((e: unknown) => e);
      expect(bad).toBeInstanceOf(StorageError);
      expect((bad as StorageError).code).toBe("INVALID_CURSOR");
      const unknown = await listBuilds(pool(), {
        limit: 5,
        cursor: "00000000-0000-0000-0000-000000000000",
      }).catch((e: unknown) => e);
      expect(unknown).toBeInstanceOf(StorageError);
      expect((unknown as StorageError).code).toBe("INVALID_CURSOR");
    });

    it("hasPublishedBuildForSha and listBuilds pagination", async () => {
      const s = sha(1002);
      const r = await createBuild(pool(), { trigger: "webhook", gitSha: s });
      if (!r.ok) throw new Error();
      expect(await hasPublishedBuildForSha(pool(), s)).toBe(false);
      for (const [from, to] of [
        ["QUEUED", "CHECKOUT"],
        ["CHECKOUT", "BUILDING"],
        ["BUILDING", "INDEXING"],
        ["INDEXING", "VALIDATING"],
        ["VALIDATING", "READY"],
        ["READY", "PUBLISHING"],
        ["PUBLISHING", "PUBLISHED"],
      ] as const) {
        expect((await transitionBuild(pool(), r.build.id, from, to)).ok).toBe(true);
      }
      expect(await hasPublishedBuildForSha(pool(), s)).toBe(true);
      const p1 = await listBuilds(pool(), { limit: 2 });
      expect(p1.items).toHaveLength(2);
      expect(p1.nextCursor).not.toBeNull();
      const p2 = await listBuilds(pool(), { limit: 2, cursor: p1.nextCursor! });
      expect(p2.items[0]!.id).not.toBe(p1.items[0]!.id);
      expect(p2.items.every((b) => b.createdAt <= p1.items[1]!.createdAt)).toBe(true);
    });

    it("claimNextQueued: concurrent claimers never get the same build; oldest first; supersede", async () => {
      await pool().query("UPDATE builds SET status = 'FAILED' WHERE status = 'QUEUED'");
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await createBuild(pool(), { trigger: "webhook", gitSha: sha(2000 + i) });
        if (!r.ok) throw new Error();
        ids.push(r.build.id);
      }
      const claims = await Promise.all(Array.from({ length: 8 }, () => claimNextQueued(pool())));
      const got = claims.filter((c) => c !== null).map((c) => c!.id);
      expect(got).toHaveLength(5);
      expect(new Set(got).size).toBe(5);
      expect(new Set(got)).toEqual(new Set(ids));

      const a = await createBuild(pool(), { trigger: "webhook", gitSha: sha(2100) });
      const b = await createBuild(pool(), { trigger: "webhook", gitSha: sha(2101) });
      const c = await createBuild(pool(), { trigger: "webhook", gitSha: sha(2102) });
      if (!a.ok || !b.ok || !c.ok) throw new Error();
      expect((await claimNextQueued(pool()))?.id).toBe(a.build.id);
      const superseded = await supersedeQueuedOlderThan(pool(), c.build.id);
      expect(superseded).toEqual([b.build.id]);
      expect((await getBuildDetail(pool(), b.build.id))?.status).toBe("SUPERSEDED");
      expect((await claimNextQueued(pool()))?.id).toBe(c.build.id);
    });
  });

  describe("releases", () => {
    it("enforces a single ACTIVE release, rollback, and events", async () => {
      const r1 = await newRelease();
      const r2 = await newRelease();

      const a1 = await activateRelease(pool(), r1);
      expect(a1).toMatchObject({ ok: true, value: { changed: true, rolledBack: false } });
      // idempotent
      expect(await activateRelease(pool(), r1)).toMatchObject({ ok: true, value: { changed: false } });

      const a2 = await activateRelease(pool(), r2);
      expect(a2).toMatchObject({ ok: true, value: { changed: true, rolledBack: false } });
      expect((await getActiveRelease(pool()))?.id).toBe(r2);
      const { rows } = await pool().query("SELECT id FROM releases WHERE status = 'ACTIVE'");
      expect(rows).toHaveLength(1);

      // rollback to r1
      const back = await activateRelease(pool(), r1);
      expect(back).toMatchObject({ ok: true, value: { changed: true, rolledBack: true } });
      expect((await getActiveRelease(pool()))?.id).toBe(r1);
      expect((await listReleaseEvents(pool(), r1)).map((e) => e.type)).toEqual([
        "CREATED",
        "VALIDATED",
        "ACTIVATED",
        "DEACTIVATED",
        "ACTIVATED",
        "ROLLED_BACK",
      ]);
      expect((await listReleaseEvents(pool(), r2)).map((e) => e.type)).toEqual([
        "CREATED",
        "VALIDATED",
        "ACTIVATED",
        "DEACTIVATED",
      ]);

      // DB itself refuses a second ACTIVE row
      await expect(pool().query("UPDATE releases SET status = 'ACTIVE' WHERE id = $1", [r2])).rejects.toThrow(
        /releases_single_active/,
      );
    });

    it("concurrent activations leave exactly one ACTIVE", async () => {
      const ids = await Promise.all([newRelease(), newRelease(), newRelease()]);
      await Promise.all(ids.map((id) => activateRelease(pool(), id)));
      const { rows } = await pool().query("SELECT id FROM releases WHERE status = 'ACTIVE'");
      expect(rows).toHaveLength(1);
    });

    it("rejects activation of candidate/unknown releases and tracks chat queryability", async () => {
      const cand = await newRelease(3, false);
      expect(await activateRelease(pool(), cand)).toMatchObject({ ok: false, reason: "invalid_transition" });
      expect(await activateRelease(pool(), "20260101000000-abcdef0")).toMatchObject({
        ok: false,
        reason: "not_found",
      });
      expect(await isChatQueryable(pool(), cand)).toBe(false);
      expect((await failRelease(pool(), cand, "nope")).ok).toBe(true);
      expect(await failRelease(pool(), cand, "again")).toMatchObject({
        ok: false,
        reason: "invalid_transition",
      });
      const ready = await newRelease();
      expect(await isChatQueryable(pool(), ready)).toBe(false);
      await activateRelease(pool(), ready);
      expect(await isChatQueryable(pool(), ready)).toBe(true);
    });

    it("rolls back activation transaction as a whole when composed in a failing transaction", async () => {
      const a = await newRelease();
      await activateRelease(pool(), a);
      const b = await newRelease();
      await expect(
        withTransaction(pool(), async (tx) => {
          await activateRelease(tx, b);
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect((await getActiveRelease(pool()))?.id).toBe(a);
    });
  });

  describe("index", () => {
    it("rejects chunks with the wrong dimension", async () => {
      const id = await newRelease(3);
      const doc = await insertDocument(pool(), {
        releaseId: id,
        sourcePath: "a.md",
        renderedUrl: "/a",
        title: "A",
        checksum: "x",
      });
      await expect(
        insertChunks(pool(), doc, [{ ordinal: 0, content: "c", embedding: [1, 2] }]),
      ).rejects.toThrow(/expects 3/);
      expect(await countIndex(pool(), id)).toEqual({ documents: 1, chunks: 0 });
    });

    it("search is scoped to the release and ranked by cosine similarity", async () => {
      const r1 = await newRelease(3);
      const r2 = await newRelease(3);
      const r3 = await newRelease(2);
      const mk = async (rel: string, p: string) =>
        insertDocument(pool(), {
          releaseId: rel,
          sourcePath: p,
          renderedUrl: `/${p}`,
          title: p,
          checksum: p,
        });
      const d1 = await mk(r1, "one.md");
      const d2 = await mk(r2, "two.md");
      const d3 = await mk(r3, "three.md");
      await insertChunks(pool(), d1, [
        { ordinal: 0, heading: "H0", anchor: "h0", content: "near", tokenCount: 1, embedding: [1, 0, 0] },
        { ordinal: 1, content: "mid", embedding: [1, 1, 0] },
        { ordinal: 2, content: "far", embedding: [0, 0, 1] },
      ]);
      await insertChunks(pool(), d2, [{ ordinal: 0, content: "other release", embedding: [1, 0, 0] }]);
      await insertChunks(pool(), d3, [{ ordinal: 0, content: "two dims", embedding: [1, 0] }]);

      const hits = await searchChunks(pool(), { releaseId: r1, embedding: [1, 0, 0], limit: 10 });
      expect(hits.map((h) => h.content)).toEqual(["near", "mid", "far"]);
      expect(hits[0]).toMatchObject({
        heading: "H0",
        anchor: "h0",
        title: "one.md",
        sourcePath: "one.md",
        renderedUrl: "/one.md",
      });
      expect(hits[0]!.score).toBeCloseTo(1, 5);
      expect(hits[1]!.score).toBeCloseTo(Math.SQRT1_2, 5);
      expect(hits[2]!.score).toBeCloseTo(0, 5);
      expect((await searchChunks(pool(), { releaseId: r1, embedding: [1, 0, 0], limit: 1 })).length).toBe(1);

      await expect(searchChunks(pool(), { releaseId: r1, embedding: [1, 0], limit: 3 })).rejects.toThrow(
        /must be 3/,
      );
      await expect(searchChunks(pool(), { releaseId: "nope", embedding: [1], limit: 3 })).rejects.toThrow(
        /unknown release/,
      );
    });

    it("pruning removes chunks; prunable selection respects retention, ACTIVE and open builds", async () => {
      await pool().query("DELETE FROM builds");
      await pool().query("UPDATE releases SET status = 'PRUNED' WHERE status <> 'PRUNED'");
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push(await newRelease(3));
      // ids[4] newest ... ids[0] oldest. Activate each in order so 0..3 end INACTIVE and 4 ACTIVE.
      for (const id of ids) await activateRelease(pool(), id);
      const doc = await insertDocument(pool(), {
        releaseId: ids[0]!,
        sourcePath: "p.md",
        renderedUrl: "/p",
        title: "P",
        checksum: "c",
      });
      await insertChunks(pool(), doc, [{ ordinal: 0, content: "x", embedding: [1, 0, 0] }]);

      // an open build references ids[1]
      const b = await createBuild(pool(), { trigger: "manual", gitSha: sha(9000) });
      if (!b.ok) throw new Error();
      await pool().query("UPDATE builds SET release_id = $1 WHERE id = $2", [ids[1], b.build.id]);

      const prunable = await listPrunableReleases(pool(), 2);
      // newest 2 (ids[4] ACTIVE, ids[3]) retained; ids[1] protected by the open build.
      expect(prunable.map((r) => r.id)).toEqual([ids[0], ids[2]]);

      expect((await countIndex(pool(), ids[0]!)).chunks).toBe(1);
      expect((await markReleasePruned(pool(), ids[0]!)).ok).toBe(true);
      expect(await countIndex(pool(), ids[0]!)).toEqual({ documents: 0, chunks: 0 });
      expect((await listReleaseEvents(pool(), ids[0]!)).at(-1)?.type).toBe("PRUNED");
      expect(await markReleasePruned(pool(), ids[4]!)).toMatchObject({
        ok: false,
        reason: "invalid_transition",
      });
      expect(await isChatQueryable(pool(), ids[0]!)).toBe(false);
    });

    it("failed and candidate releases do not use up the retention window; failed ones are prunable", async () => {
      await pool().query("DELETE FROM builds");
      await pool().query("UPDATE releases SET status = 'PRUNED' WHERE status <> 'PRUNED'");
      const good: string[] = [];
      for (let i = 0; i < 3; i++) good.push(await newRelease(3));
      for (const id of good) await activateRelease(pool(), id); // good[0], good[1] INACTIVE; good[2] ACTIVE
      const failed: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await newRelease(3, false);
        expect((await failRelease(pool(), id, "boom")).ok).toBe(true);
        failed.push(id);
      }
      const candidate = await newRelease(3, false);

      const prunable = (await listPrunableReleases(pool(), 3)).map((r) => r.id);
      expect(prunable).toEqual(failed);
      expect(prunable).not.toContain(candidate);
      for (const id of good) expect(prunable).not.toContain(id);
      // A smaller window still only ranks servable releases.
      expect((await listPrunableReleases(pool(), 1)).map((r) => r.id)).toEqual([good[0], good[1], ...failed]);

      expect((await markReleasePruned(pool(), failed[0]!)).ok).toBe(true);
      expect((await listPrunableReleases(pool(), 3)).map((r) => r.id)).toEqual(failed.slice(1));
    });
  });
});
