import type { ChatRequest, ChatStreamEvent, PlatformIdentity, SiteInfo } from "@docs-platform/contracts";

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

/** Answers one chat turn as a stream of contract events (implemented by `@docs-platform/rag`). */
export interface ChatService {
  /**
   * Called only after the API has authenticated the caller, validated the request, and
   * confirmed `request.context.releaseId` is chat-queryable. Must stop promptly and stop
   * calling upstream models when `signal` aborts. Must not throw after yielding `start`;
   * failures are reported as a final `error` event instead.
   */
  stream(input: {
    request: ChatRequest;
    identity: PlatformIdentity;
    signal: AbortSignal;
  }): AsyncIterable<ChatStreamEvent>;
}

/** Release lookups the API needs outside of chat streaming (implemented over `@docs-platform/storage`). */
export interface ReleaseService {
  /** True only for releases whose chunks chat may query (ACTIVE or INACTIVE). */
  isChatQueryable(releaseId: string): Promise<boolean>;
}
