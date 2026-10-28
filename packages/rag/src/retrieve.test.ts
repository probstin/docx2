import type { ChunkHit } from "@docs-platform/storage";
import { describe, expect, it } from "vitest";
import { HEADING_BOOST, PAGE_BOOST, applyPageBoost, normalizeRoute } from "./retrieve.js";
import { pageContextFromRequest } from "./service.js";

function hit(
  id: string,
  url: string,
  heading: string | null,
  score: number,
  anchor: string | null = null,
): ChunkHit {
  return {
    chunkId: id,
    documentId: id,
    content: id,
    heading,
    anchor,
    ordinal: 0,
    title: id,
    sourcePath: `${id}.md`,
    renderedUrl: url,
    score,
  };
}

describe("applyPageBoost", () => {
  const hits = [
    hit("other", "/docs/other", "Intro", 0.5),
    hit("page", "/docs/page", "Something", 0.47),
    hit("pageHeading", "/docs/page", "Rollback", 0.45, "rollback"),
  ];

  it("re-ranks rather than filters", () => {
    const out = applyPageBoost(hits, {
      pageUrl: "https://site.example/docs/page/?x=1#rollback",
      heading: "rollback",
    });
    expect(out.map((c) => c.chunkId)).toEqual(["pageHeading", "page", "other"]);
    expect(out).toHaveLength(3);
    expect(out[0]!.score).toBeCloseTo(0.45 + PAGE_BOOST + HEADING_BOOST);
    expect(out[0]!.rawScore).toBe(0.45);
    expect(out[1]!.score).toBeCloseTo(0.47 + PAGE_BOOST);
  });

  it("does not let the boost beat a clearly better chunk", () => {
    const strong = [hit("far", "/docs/far", null, 0.8), hit("page", "/docs/page", null, 0.5)];
    expect(applyPageBoost(strong, { pageUrl: "/docs/page" })[0]!.chunkId).toBe("far");
  });

  it("is a no-op without page context and uses the anchor from the URL hash", () => {
    expect(applyPageBoost(hits, undefined).map((c) => c.chunkId)).toEqual(["other", "page", "pageHeading"]);
    const out = applyPageBoost(hits, { pageUrl: "/docs/page", anchor: "rollback" });
    expect(out[0]!.chunkId).toBe("pageHeading");
  });

  it("boosts the chunk whose anchor is in the request's pageUrl fragment", () => {
    const ctx = pageContextFromRequest({
      releaseId: "r",
      pageUrl: "/docs/page#rollback",
    });
    expect(ctx.anchor).toBe("rollback");
    const out = applyPageBoost(hits, ctx);
    expect(out[0]).toMatchObject({ chunkId: "pageHeading", boosted: true });
    expect(out[0]!.score).toBeCloseTo(0.45 + PAGE_BOOST + HEADING_BOOST);
    // The hash does not prevent the same-page match for chunks without that anchor.
    expect(out.find((c) => c.chunkId === "page")!.score).toBeCloseTo(0.47 + PAGE_BOOST);
  });

  it("normalizes routes", () => {
    expect(normalizeRoute("http://a.example/docs/x/#h")).toBe("/docs/x");
    expect(normalizeRoute("/docs/x?y=1")).toBe("/docs/x");
    expect(normalizeRoute("/")).toBe("/");
  });
});
