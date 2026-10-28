import type { RequestHook } from "../auth.js";
import type { Metrics } from "../metrics.js";
import type { ChatLimitsEnv } from "../config.js";
import type { ChatService, ReadinessCheck, ReleaseService, SiteService } from "../ports.js";

/** Everything route plugins may depend on; passed as plugin options by `buildApp`. */
export interface RouteDeps {
  site: SiteService;
  /** Chat is only registered when both `chat` and `releases` are provided. */
  chat?: ChatService;
  releases?: ReleaseService;
  chatLimits: ChatLimitsEnv;
  /** Public site URL; chat `pageUrl` must belong to it. */
  publicUrl: string;
  /** SSE keep-alive comment interval in ms. */
  keepAliveMs: number;
  readiness: readonly ReadinessCheck[];
  readinessTimeoutMs: number;
  metrics: Metrics;
  /** Route-level preHandler: 401 without identity, 403 for non-admins. */
  requireAdmin: RequestHook;
}
