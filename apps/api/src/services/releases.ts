import { isChatQueryable, type Queryable } from "@docs-platform/storage";
import type { ReleaseService } from "../ports.js";

export interface ReleaseServiceOptions {
  /** How long a positive answer is cached (default 30s). Negatives are never cached. */
  positiveTtlMs?: number;
  now?: () => number;
}

const MAX_CACHE = 256;

export function createReleaseService(db: Queryable, options: ReleaseServiceOptions = {}): ReleaseService {
  const ttl = options.positiveTtlMs ?? 30_000;
  const now = options.now ?? Date.now;
  const positive = new Map<string, number>(); // releaseId -> expiry
  return {
    async isChatQueryable(releaseId) {
      const t = now();
      const expiry = positive.get(releaseId);
      if (expiry !== undefined && expiry > t) return true;
      const ok = await isChatQueryable(db, releaseId);
      if (ok) {
        if (positive.size >= MAX_CACHE) positive.clear();
        positive.set(releaseId, t + ttl);
      } else {
        positive.delete(releaseId);
      }
      return ok;
    },
  };
}
