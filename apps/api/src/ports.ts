import type { SiteInfo } from "@docs-platform/contracts";

/**
 * Narrow ports the API depends on. Real implementations (storage, RAG, build packages)
 * are wired in by the composition root (`main.ts`); tests use in-memory fakes.
 */

/** A dependency probe for `GET /health/ready`. Reject (or hang) to report not ready. */
export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

export interface SiteService {
  getSiteInfo(): Promise<SiteInfo>;
}
