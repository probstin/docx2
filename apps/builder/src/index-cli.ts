import path from "node:path";
import { parseArgs } from "node:util";
import { ModelsEnvSchema, ReleaseIdSchema, loadEnv, type ReleaseManifest } from "@docs-platform/contracts";
import { createEmbeddingsClient, indexRelease, type Logger } from "@docs-platform/rag";
import { readCheckout } from "@docs-platform/sources";
import {
  activateRelease,
  createCandidateRelease,
  createPool,
  failRelease,
  markReleaseReady,
  migrate,
} from "@docs-platform/storage";

export const INDEX_USAGE = `Usage:
  builder index --source <dir> --release-id <id> [--sha <sha>] [--activate]

Dev command: indexes a docs directory into the database for a release, so the chat can be tried
locally before the Kubernetes Job exists. Runs migrations, creates a CANDIDATE release, embeds and
stores every chunk, marks the release READY and (with --activate) ACTIVE. On failure the release is
marked FAILED.

Options:
  --source <dir>      Directory containing docs.yaml (same as "builder site").
  --release-id <id>   Release id; pass the same value to "builder site --release-id" so the site and
                      the index match. Format: <yyyymmddhhmmss>-<7-40 hex chars>.
  --sha <sha>         Full commit SHA recorded on the release (default: forty zeros).
  --activate          Make the release the ACTIVE one after indexing.
  --help              Show this help.

Database: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE. Models: CHAT_*/EMBEDDINGS_* (see .env.example).`;

const log: Logger = {
  debug: () => undefined,
  info: (_f, msg) => console.log(msg),
  warn: (_f, msg) => console.warn(msg),
  error: (_f, msg) => console.error(msg),
};

export async function runIndex(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string" },
      "release-id": { type: "string" },
      sha: { type: "string", default: "0".repeat(40) },
      activate: { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(INDEX_USAGE);
    return;
  }
  if (!values.source || !values["release-id"]) {
    console.error(`--source and --release-id are required.\n\n${INDEX_USAGE}`);
    process.exitCode = 2;
    return;
  }
  const releaseId = ReleaseIdSchema.parse(values["release-id"]);
  const models = loadEnv(ModelsEnvSchema, process.env);

  const pool = createPool({ max: 4 });
  let created = false;
  try {
    await migrate(pool, { log: (m) => console.log(`[migrate] ${m}`) });
    const content = await readCheckout(path.resolve(values.source));

    await createCandidateRelease(pool, {
      id: releaseId,
      gitSha: values.sha,
      artifactPath: `releases/${releaseId}`,
      embeddingModel: models.EMBEDDINGS_MODEL,
      embeddingDimensions: models.EMBEDDINGS_DIMENSIONS,
      docsYaml: content.docsYaml,
    });
    created = true;

    const counts = await indexRelease({
      pool,
      releaseId,
      documents: content.documents,
      embeddings: createEmbeddingsClient(models),
      log,
    });

    const manifest: ReleaseManifest = {
      schemaVersion: 1,
      releaseId,
      gitSha: values.sha,
      source: { url: path.resolve(values.source), branch: "local" },
      builtAt: new Date().toISOString(),
      site: {
        title: content.docsYaml.site.title,
        basePath: content.docsYaml.site.basePath,
        pages: content.documents.map((d) => ({
          route: d.metadata.url,
          title: d.metadata.title,
          anchors: d.metadata.headings.map((h) => h.anchor),
        })),
        hashedAssets: [],
        fileCount: 0,
      },
      index: {
        documents: counts.documents,
        chunks: counts.chunks,
        embeddingModel: models.EMBEDDINGS_MODEL,
        dimensions: models.EMBEDDINGS_DIMENSIONS,
      },
    };
    const ready = await markReleaseReady(pool, releaseId, manifest);
    if (!ready.ok) throw new Error(`could not mark release READY: ${ready.reason}`);
    if (values.activate) {
      const active = await activateRelease(pool, releaseId);
      if (!active.ok) throw new Error(`could not activate release: ${active.reason}`);
    }
    console.log(
      `Indexed ${counts.documents} documents / ${counts.chunks} chunks${values.activate ? " (ACTIVE)" : " (READY)"}`,
    );
    console.log(releaseId);
  } catch (error) {
    if (created) {
      const reason = error instanceof Error ? error.message : String(error);
      await failRelease(pool, releaseId, reason).catch(() => undefined);
    }
    throw error;
  } finally {
    await pool.end();
  }
}
