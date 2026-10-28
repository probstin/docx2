import type { RequestHook } from "../auth.js";
import type { Metrics } from "../metrics.js";
import type { ReadinessCheck, SiteService } from "../ports.js";

/** Everything route plugins may depend on; passed as plugin options by `buildApp`. */
export interface RouteDeps {
  site: SiteService;
  readiness: readonly ReadinessCheck[];
  readinessTimeoutMs: number;
  metrics: Metrics;
  /** Route-level preHandler: 401 without identity, 403 for non-admins. */
  requireAdmin: RequestHook;
}
