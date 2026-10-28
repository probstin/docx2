import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { upstreamUnavailable } from "./errors.js";
import type { SiteService } from "./ports.js";

/**
 * Composition root. Real implementations of the ports (storage, RAG, build) are wired in
 * here by later work; until then the site service reports itself unavailable.
 */
const unwiredSite: SiteService = {
  getSiteInfo: () => Promise.reject(upstreamUnavailable("Site service not configured")),
};

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config, site: unwiredSite, readiness: [], onClose: [] });

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "shutting down");
    // Closes the server first, then runs the injected onClose hooks.
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, "error during shutdown");
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await app.listen({ port: config.server.PORT, host: config.server.HOST });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
