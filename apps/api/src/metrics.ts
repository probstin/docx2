import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

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
  const chatRequests = new Counter({
    name: "chat_requests_total",
    help: "Chat requests by outcome",
    labelNames: ["outcome"] as const,
    registers: [registry],
  });
  const chatStreamDuration = new Histogram({
    name: "chat_stream_duration_seconds",
    help: "Duration of chat streams in seconds",
    buckets: [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
    registers: [registry],
  });
  const chatActiveStreams = new Gauge({
    name: "chat_active_streams",
    help: "Chat streams currently open",
    registers: [registry],
  });
  return { registry, httpDuration, chatRequests, chatStreamDuration, chatActiveStreams };
}
export type Metrics = ReturnType<typeof createMetrics>;
