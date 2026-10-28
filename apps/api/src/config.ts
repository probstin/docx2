import {
  AuthEnvSchema,
  ModelsEnvSchema,
  PublishingEnvSchema,
  RetrievalEnvSchema,
  ServerEnvSchema,
  loadEnv,
  type AuthEnv,
  type ModelsEnv,
  type PublishingEnv,
  type RetrievalEnv,
  type ServerEnv,
} from "@docs-platform/contracts";
import { z } from "zod";

/**
 * API-local chat limits. Defined here rather than in contracts because only the API reads
 * them; move them to contracts' env.ts if Helm values validation should share the schema.
 */
export const ChatLimitsEnvSchema = z.object({
  CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  CHAT_MAX_CONCURRENT_STREAMS_PER_USER: z.coerce.number().int().min(1).default(2),
});
export type ChatLimitsEnv = z.infer<typeof ChatLimitsEnvSchema>;

export const DbEnvSchema = z.object({
  /** Run pending migrations at startup. Local-dev convenience; production uses the Helm migration Job. */
  DB_MIGRATE_ON_START: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export type DbEnv = z.infer<typeof DbEnvSchema>;

/** Configuration needed by `buildApp` itself (no model/DB settings, so tests stay light). */
export interface ApiConfig {
  server: ServerEnv;
  auth: AuthEnv;
  chat: ChatLimitsEnv;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  return {
    server: loadEnv(ServerEnvSchema, env),
    auth: loadEnv(AuthEnvSchema, env),
    chat: loadEnv(ChatLimitsEnvSchema, env),
  };
}

/** Everything the composition root needs. PG settings come from the libpq `PG*` variables. */
export interface RuntimeConfig extends ApiConfig {
  models: ModelsEnv;
  retrieval: RetrievalEnv;
  publishing: PublishingEnv;
  db: DbEnv;
}

export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  return {
    ...loadConfig(env),
    models: loadEnv(ModelsEnvSchema, env),
    retrieval: loadEnv(RetrievalEnvSchema, env),
    publishing: loadEnv(PublishingEnvSchema, env),
    db: loadEnv(DbEnvSchema, env),
  };
}
