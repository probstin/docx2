import { Histogram, Registry, collectDefaultMetrics } from "prom-client";

/** Per-app registry (not the global one) so multiple apps can coexist in tests. */
export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });
  return { registry, httpDuration };
}
export type Metrics = ReturnType<typeof createMetrics>;
