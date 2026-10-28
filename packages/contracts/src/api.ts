import { z } from "zod";
import { DocsYamlSchema } from "./docs-yaml.js";
import {
  BuildStatusSchema,
  BuildTriggerSchema,
  GitShaSchema,
  ReleaseIdSchema,
  ReleaseStatusSchema,
} from "./lifecycle.js";

export const API_ROUTES = {
  chat: "/api/v1/chat",
  site: "/api/v1/site",
  gitWebhook: "/api/v1/webhooks/git",
  builds: "/api/v1/builds",
  build: "/api/v1/builds/:id",
  releases: "/api/v1/releases",
  activateRelease: "/api/v1/releases/:id/activate",
  healthLive: "/health/live",
  healthReady: "/health/ready",
  metrics: "/metrics",
} as const;

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "CONFLICT",
  "RELEASE_UNKNOWN",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "WEBHOOK_REJECTED",
  "UPSTREAM_UNAVAILABLE",
  "INTERNAL",
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Every non-2xx JSON response uses this envelope. */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const ReleaseSummarySchema = z.object({
  id: ReleaseIdSchema,
  gitSha: GitShaSchema,
  status: ReleaseStatusSchema,
  createdAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
});
export type ReleaseSummary = z.infer<typeof ReleaseSummarySchema>;

/** `GET /api/v1/site` */
export const SiteInfoSchema = z.object({
  title: z.string(),
  basePath: z.string(),
  assistant: DocsYamlSchema.shape.assistant.unwrap(),
  activeRelease: ReleaseSummarySchema.nullable(),
});
export type SiteInfo = z.infer<typeof SiteInfoSchema>;

export const BuildSummarySchema = z.object({
  id: z.string(),
  gitSha: GitShaSchema.nullable(),
  status: BuildStatusSchema,
  trigger: BuildTriggerSchema,
  releaseId: ReleaseIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  error: z.string().nullable(),
});
export type BuildSummary = z.infer<typeof BuildSummarySchema>;

/** `GET /api/v1/builds/:id` */
export const BuildDetailSchema = BuildSummarySchema.extend({
  k8sJobName: z.string().nullable(),
  history: z.array(
    z.object({ status: BuildStatusSchema, at: z.iso.datetime(), message: z.string().optional() }),
  ),
});
export type BuildDetail = z.infer<typeof BuildDetailSchema>;

/** `POST /api/v1/builds` — omit `gitSha` to build the branch head. */
export const CreateBuildRequestSchema = z.strictObject({
  gitSha: GitShaSchema.optional(),
});
export type CreateBuildRequest = z.infer<typeof CreateBuildRequestSchema>;

/** `POST /api/v1/webhooks/git` response (202 accepted / 200 ignored). */
export const WebhookAckSchema = z.object({
  accepted: z.boolean(),
  buildId: z.string().optional(),
  /** Why an authentic event was ignored (wrong branch, duplicate SHA, unsupported event). */
  reason: z.string().optional(),
});
export type WebhookAck = z.infer<typeof WebhookAckSchema>;
