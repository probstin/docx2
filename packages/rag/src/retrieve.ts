import { searchChunks, type ChunkHit, type Pool } from "@docs-platform/storage";
import type { EmbeddingsClient, PageContext } from "./types.js";

/** Additive score boost for chunks from the page the user is on. */
export const PAGE_BOOST = 0.05;
/** Extra additive boost when the chunk's heading is the section the user is on. */
export const HEADING_BOOST = 0.05;
/** Candidates fetched per requested result, so boosted chunks can overtake unboosted ones. */
export const OVERFETCH_FACTOR = 3;
export const DEFAULT_TOP_K = 8;

export interface RetrievedChunk extends ChunkHit {
  /** Cosine similarity as returned by the database. Used for the minScore cutoff. */
  rawScore: number;
  /** rawScore plus page-context boosts; the ranking key. */
  score: number;
  boosted: boolean;
}

export interface RetrieveInput {
  pool: Pool;
  releaseId: string;
  query: string;
  embeddings: EmbeddingsClient;
  pageContext?: PageContext;
  topK?: number;
  /** Cosine cutoff; the caller supplies it (the service takes it from `RETRIEVAL_MIN_SCORE`). */
  minScore: number;
  pageBoost?: boolean;
  signal?: AbortSignal;
}

export interface RetrieveResult {
  chunks: RetrievedChunk[];
  /** True when at least one candidate scored at or above minScore. */
  adequate: boolean;
  /** Highest raw score among the candidates (before the minScore cutoff); useful for tuning. */
  best?: number;
}

/** Reduces a route or absolute URL to a comparable path: no origin, query, hash or trailing slash. */
export function normalizeRoute(urlOrPath: string): string {
  let p: string;
  try {
    p = new URL(urlOrPath, "http://x.invalid").pathname;
  } catch {
    p = urlOrPath.split(/[?#]/)[0] ?? "";
  }
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep encoded */
  }
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

const norm = (s: string): string => s.trim().toLowerCase();

export function applyPageBoost(hits: ChunkHit[], pageContext: PageContext | undefined): RetrievedChunk[] {
  const page = pageContext?.pageUrl ? normalizeRoute(pageContext.pageUrl) : undefined;
  return hits
    .map((h) => {
      let boost = 0;
      if (page !== undefined && normalizeRoute(h.renderedUrl) === page) {
        boost += PAGE_BOOST;
        const sameAnchor = pageContext?.anchor !== undefined && h.anchor === pageContext.anchor;
        const sameHeading =
          pageContext?.heading !== undefined &&
          h.heading !== null &&
          norm(h.heading) === norm(pageContext.heading);
        if (sameAnchor || sameHeading) boost += HEADING_BOOST;
      }
      return { ...h, rawScore: h.score, score: h.score + boost, boosted: boost > 0 };
    })
    .sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.ordinal - b.ordinal);
}

export async function retrieve(input: RetrieveInput): Promise<RetrieveResult> {
  const topK = input.topK ?? DEFAULT_TOP_K;
  const { minScore } = input;
  const embedding = await input.embeddings.embedQuery(input.query, input.signal);
  const hits = await searchChunks(input.pool, {
    releaseId: input.releaseId,
    embedding,
    limit: topK * OVERFETCH_FACTOR,
  });
  const ranked =
    input.pageBoost === false ? applyPageBoost(hits, undefined) : applyPageBoost(hits, input.pageContext);
  const kept = ranked.filter((c) => c.rawScore >= minScore);
  return {
    chunks: kept.slice(0, topK),
    adequate: kept.length > 0,
    best: ranked.reduce((m, c) => Math.max(m, c.rawScore), 0),
  };
}
