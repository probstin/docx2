import { createPool, migrate } from "@docs-platform/storage";
import { buildApp } from "./app.js";
import { loadRuntimeConfig } from "./config.js";
import { placeholderChatService, provideChatService } from "./services/chat.js";
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

  // WIRING POINT: swap `placeholderChatService` for the `@docs-platform/rag` implementation.
  const chat = provideChatService(placeholderChatService);

  const app = await buildApp({
    config,
    site: createSiteService(pool),
    releases: createReleaseService(pool),
    chat,
    readiness: [databaseReadiness(pool)],
    onClose: [() => pool.end()],
  });

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
