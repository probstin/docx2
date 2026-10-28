import { z } from "zod";

/**
 * Runtime environment contracts. The Helm chart maps values + Secrets onto these
 * variables; local development reads them from `.env`. PostgreSQL uses the standard
 * libpq variables (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE) and custom
 * CAs use NODE_EXTRA_CA_CERTS, so neither is redeclared here.
 */

const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
const bool = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((v) => v === "true");

export const ModelsEnvSchema = z.object({
  CHAT_BASE_URL: z.url(),
  CHAT_MODEL: z.string().min(1),
  CHAT_API_KEY: z.string().default(""),
  /**
   * Sent only when set. Leave it unset for models that accept only their default
   * temperature (e.g. OpenAI reasoning models reject anything but 1).
   */
  CHAT_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  CHAT_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
  EMBEDDINGS_BASE_URL: z.url(),
  EMBEDDINGS_MODEL: z.string().min(1),
  EMBEDDINGS_API_KEY: z.string().default(""),
  /** Must equal the model's actual output size; verified on every embedding call. */
  EMBEDDINGS_DIMENSIONS: z.coerce.number().int().positive(),
});
export type ModelsEnv = z.infer<typeof ModelsEnvSchema>;

export const AuthEnvSchema = z
  .object({
    AUTH_MODE: z.enum(["trusted-header", "none"]).default("trusted-header"),
    /** Required alongside AUTH_MODE=none; there is no implicit insecure default. */
    AUTH_ALLOW_INSECURE_NONE: bool(false),
    AUTH_SUBJECT_HEADER: z.string().default("x-auth-request-user"),
    AUTH_EMAIL_HEADER: z.string().default("x-auth-request-email"),
    AUTH_NAME_HEADER: z.string().default("x-auth-request-preferred-username"),
    AUTH_GROUPS_HEADER: z.string().default("x-auth-request-groups"),
    AUTH_ADMIN_GROUPS: csv,
  })
  .refine((e) => e.AUTH_MODE !== "none" || e.AUTH_ALLOW_INSECURE_NONE, {
    message: "AUTH_MODE=none requires AUTH_ALLOW_INSECURE_NONE=true (development only)",
  });
export type AuthEnv = z.infer<typeof AuthEnvSchema>;

export const SourceEnvSchema = z.object({
  SOURCE_GIT_URL: z.string().min(1),
  SOURCE_BRANCH: z.string().min(1).default("main"),
  /** Optional HTTPS basic-auth credentials for the Git server (from a Secret). */
  SOURCE_GIT_USERNAME: z.string().optional(),
  SOURCE_GIT_TOKEN: z.string().optional(),
});
export type SourceEnv = z.infer<typeof SourceEnvSchema>;

export const WebhookEnvSchema = z.object({
  WEBHOOK_ENABLED: bool(false),
  WEBHOOK_PROVIDER: z.enum(["gitea"]).default("gitea"),
  WEBHOOK_SECRET: z.string().default(""),
  WEBHOOK_MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
});
export type WebhookEnv = z.infer<typeof WebhookEnvSchema>;

export const PublishingEnvSchema = z.object({
  /** Mount point of the artifact PVC. */
  DATA_DIR: z.string().default("/data"),
  PUBLISHING_RETAIN_REVISIONS: z.coerce.number().int().min(1).default(3),
  PUBLISHING_JOB_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
  PUBLISHING_JOB_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});
export type PublishingEnv = z.infer<typeof PublishingEnvSchema>;

export const RetrievalEnvSchema = z.object({
  RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(50).default(8),
  RETRIEVAL_PAGE_CONTEXT_BOOST: bool(true),
  /** Minimum cosine similarity for a chunk to count as support; below it, decline. */
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.3),
});
export type RetrievalEnv = z.infer<typeof RetrievalEnvSchema>;

export const ServerEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Canonical external URL of the docs site; chat `pageUrl` must belong to it. */
  PLATFORM_PUBLIC_URL: z.url(),
});
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

/** Parse a section of `process.env`, throwing a readable error listing every problem. */
export function loadEnv<S extends z.ZodType>(schema: S, env: Record<string, string | undefined>): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
