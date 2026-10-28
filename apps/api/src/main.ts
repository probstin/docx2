import {
  createChatModelClient,
  createChatService,
  createEmbeddingsClient,
  type Logger,
} from "@docs-platform/rag";
import { createPool, migrate } from "@docs-platform/storage";
import { buildApp } from "./app.js";
import { loadRuntimeConfig } from "./config.js";
import { databaseReadiness } from "./services/readiness.js";
import { createReleaseService } from "./services/releases.js";
import { createSiteService } from "./services/site.js";

/** Composition root: config -> pool -> services -> app. */
async function main(): Promise<void> {
  const config = loadRuntimeConfig();
  const pool = createPool();
  try {
    // Production runs migrations from the Helm migration Job; this is for local development.
    if (config.db.DB_MIGRATE_ON_START) await migrate(pool);
  } catch (err) {
    await pool.end();
    throw err;
  }

  // The RAG service is built before the app, so it logs through a forwarder bound to the
  // app's logger once that exists.
  const appLog: { current?: Logger } = {};
  const log: Logger = {
    debug: (fields, msg) => appLog.current?.debug(fields, msg),
    info: (fields, msg) => appLog.current?.info(fields, msg),
    warn: (fields, msg) => appLog.current?.warn(fields, msg),
    error: (fields, msg) => appLog.current?.error(fields, msg),
  };
  const chat = createChatService({
    pool,
    embeddings: createEmbeddingsClient(config.models),
    chat: createChatModelClient(config.models),
    retrieval: config.retrieval,
    log,
  });

  const app = await buildApp({
    config,
    site: createSiteService(pool),
    releases: createReleaseService(pool),
    chat,
    readiness: [databaseReadiness(pool)],
    onClose: [() => pool.end()],
  });
  appLog.current = app.log.child({ component: "rag" });

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
