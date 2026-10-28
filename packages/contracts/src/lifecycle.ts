import { z } from "zod";

/**
 * Release IDs are path-safe (used as PVC directory names) and sort chronologically:
 * `<UTC yyyymmddhhmmss>-<first 12 chars of the Git SHA>`.
 */
export const ReleaseIdSchema = z.string().regex(/^\d{14}-[0-9a-f]{7,40}$/, "invalid release id");
export type ReleaseId = z.infer<typeof ReleaseIdSchema>;

export function createReleaseId(gitSha: string, at: Date = new Date()): ReleaseId {
  const stamp = at.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${stamp}-${gitSha.toLowerCase().slice(0, 12)}`;
}

export const GitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/, "must be a full SHA-1 or SHA-256");

/**
 * Build lifecycle (PLAN §9.1). `PUBLISHED` is the terminal success state for a build;
 * whether its release is *currently* live is tracked on the release (`ACTIVE`).
 */
export const BUILD_STATUSES = [
  "RECEIVED",
  "QUEUED",
  "CHECKOUT",
  "BUILDING",
  "INDEXING",
  "VALIDATING",
  "READY",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "SUPERSEDED",
] as const;
export const BuildStatusSchema = z.enum(BUILD_STATUSES);
export type BuildStatus = z.infer<typeof BuildStatusSchema>;

const BUILD_TRANSITIONS: Record<BuildStatus, readonly BuildStatus[]> = {
  RECEIVED: ["QUEUED", "FAILED", "SUPERSEDED"],
  QUEUED: ["CHECKOUT", "FAILED", "SUPERSEDED"],
  CHECKOUT: ["BUILDING", "FAILED"],
  BUILDING: ["INDEXING", "FAILED"],
  INDEXING: ["VALIDATING", "FAILED"],
  VALIDATING: ["READY", "FAILED"],
  READY: ["PUBLISHING", "FAILED", "SUPERSEDED"],
  PUBLISHING: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  FAILED: [],
  SUPERSEDED: [],
};

/** Build states owned by the builder Job; the API owns everything else. */
export const BUILDER_OWNED_BUILD_STATUSES: readonly BuildStatus[] = [
  "CHECKOUT",
  "BUILDING",
  "INDEXING",
  "VALIDATING",
  "READY",
];

export function isTerminalBuildStatus(status: BuildStatus): boolean {
  return BUILD_TRANSITIONS[status].length === 0;
}

export function canTransitionBuild(from: BuildStatus, to: BuildStatus): boolean {
  return BUILD_TRANSITIONS[from].includes(to);
}

export const RELEASE_STATUSES = [
  /** Being staged/indexed by a builder; never served. */
  "CANDIDATE",
  /** Validated and complete on the PVC and in pgvector; eligible for activation. */
  "READY",
  /** The single live release. */
  "ACTIVE",
  /** Previously active or ready; retained for in-flight sessions and rollback. */
  "INACTIVE",
  /** Artifacts and chunks deleted; terminal. */
  "PRUNED",
  /** Staging failed; partial artifacts may need cleanup; terminal. */
  "FAILED",
] as const;
export const ReleaseStatusSchema = z.enum(RELEASE_STATUSES);
export type ReleaseStatus = z.infer<typeof ReleaseStatusSchema>;

const RELEASE_TRANSITIONS: Record<ReleaseStatus, readonly ReleaseStatus[]> = {
  CANDIDATE: ["READY", "FAILED"],
  READY: ["ACTIVE", "INACTIVE", "PRUNED"],
  ACTIVE: ["INACTIVE"],
  INACTIVE: ["ACTIVE", "PRUNED"],
  PRUNED: [],
  FAILED: ["PRUNED"],
};

export function canTransitionRelease(from: ReleaseStatus, to: ReleaseStatus): boolean {
  return RELEASE_TRANSITIONS[from].includes(to);
}

/** Releases whose chunks may be queried by chat (served now, or recently served). */
export const CHAT_QUERYABLE_RELEASE_STATUSES: readonly ReleaseStatus[] = ["ACTIVE", "INACTIVE"];

export const RELEASE_EVENT_TYPES = [
  "CREATED",
  "VALIDATED",
  "ACTIVATED",
  "DEACTIVATED",
  "ROLLED_BACK",
  "PRUNED",
  "FAILED",
] as const;
export const ReleaseEventTypeSchema = z.enum(RELEASE_EVENT_TYPES);
export type ReleaseEventType = z.infer<typeof ReleaseEventTypeSchema>;

export const BUILD_TRIGGERS = ["webhook", "manual", "install", "reconcile"] as const;
export const BuildTriggerSchema = z.enum(BUILD_TRIGGERS);
export type BuildTrigger = z.infer<typeof BuildTriggerSchema>;
