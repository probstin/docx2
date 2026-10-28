import {
  AuthEnvSchema,
  ServerEnvSchema,
  loadEnv,
  type AuthEnv,
  type ServerEnv,
} from "@docs-platform/contracts";

/** Parsed configuration. Later waves add sections (source, webhook, models, ...). */
export interface ApiConfig {
  server: ServerEnv;
  auth: AuthEnv;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  return {
    server: loadEnv(ServerEnvSchema, env),
    auth: loadEnv(AuthEnvSchema, env),
  };
}
