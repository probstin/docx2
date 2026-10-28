import { z } from "zod";
import { GitShaSchema, ReleaseIdSchema } from "./lifecycle.js";

/**
 * `releases/<id>/manifest.json` on the artifact PVC. Written last by the builder; a
 * release directory without a valid manifest is incomplete and must never be served.
 */
export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  releaseId: ReleaseIdSchema,
  gitSha: GitShaSchema,
  source: z.object({ url: z.string(), branch: z.string() }),
  builtAt: z.iso.datetime(),
  site: z.object({
    title: z.string(),
    basePath: z.string(),
    /** Every page route and the heading anchors it exposes; used for citation validation. */
    pages: z.array(z.object({ route: z.string(), title: z.string(), anchors: z.array(z.string()) })),
    /** Content-hashed asset paths (relative to the site root) this release references. */
    hashedAssets: z.array(z.string()),
    fileCount: z.number().int().nonnegative(),
  }),
  index: z.object({
    documents: z.number().int().nonnegative(),
    chunks: z.number().int().nonnegative(),
    embeddingModel: z.string(),
    dimensions: z.number().int().positive(),
  }),
});

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

/** Paths on the artifact volume (PLAN §9.3), relative to `DATA_DIR`. */
export const ArtifactLayout = {
  staging: (buildId: string) => `staging/build-${buildId}`,
  release: (releaseId: string) => `releases/${releaseId}`,
  releaseSite: (releaseId: string) => `releases/${releaseId}/site`,
  releaseManifest: (releaseId: string) => `releases/${releaseId}/manifest.json`,
  sharedAssets: "shared-assets",
  /** Symlink to `releases/<active>/site`, swapped atomically via rename. */
  current: "current",
} as const;
