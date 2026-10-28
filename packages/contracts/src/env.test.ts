import { describe, expect, it } from "vitest";
import { AuthEnvSchema, ModelsEnvSchema, loadEnv } from "./env.js";

describe("env contracts", () => {
  it("refuses AUTH_MODE=none without the explicit insecure opt-in", () => {
    expect(() => loadEnv(AuthEnvSchema, { AUTH_MODE: "none" })).toThrow(/AUTH_ALLOW_INSECURE_NONE/);
    expect(loadEnv(AuthEnvSchema, { AUTH_MODE: "none", AUTH_ALLOW_INSECURE_NONE: "true" }).AUTH_MODE).toBe(
      "none",
    );
  });

  it("parses admin groups and model settings", () => {
    expect(loadEnv(AuthEnvSchema, { AUTH_ADMIN_GROUPS: "docs-admins, ops " }).AUTH_ADMIN_GROUPS).toEqual([
      "docs-admins",
      "ops",
    ]);
    const models = loadEnv(ModelsEnvSchema, {
      CHAT_BASE_URL: "http://localhost:4010/v1",
      CHAT_MODEL: "m",
      EMBEDDINGS_BASE_URL: "http://localhost:4010/v1",
      EMBEDDINGS_MODEL: "e",
      EMBEDDINGS_DIMENSIONS: "1024",
    });
    expect(models.EMBEDDINGS_DIMENSIONS).toBe(1024);
    expect(models.CHAT_TEMPERATURE).toBeUndefined();
  });
});
