import { describe, expect, it } from "vitest";
import {
  ReleaseIdSchema,
  canTransitionBuild,
  canTransitionRelease,
  createReleaseId,
  isTerminalBuildStatus,
} from "./lifecycle.js";

describe("release ids", () => {
  it("are chronological, path-safe, and valid", () => {
    const id = createReleaseId(
      "ABCDEF1234567890abcdef1234567890abcdef12",
      new Date("2026-10-27T12:34:56.789Z"),
    );
    expect(id).toBe("20261027123456-abcdef123456");
    expect(ReleaseIdSchema.safeParse(id).success).toBe(true);
    expect(ReleaseIdSchema.safeParse("../etc").success).toBe(false);
  });
});

describe("build transitions", () => {
  it("follows the happy path", () => {
    const path = [
      "RECEIVED",
      "QUEUED",
      "CHECKOUT",
      "BUILDING",
      "INDEXING",
      "VALIDATING",
      "READY",
      "PUBLISHING",
      "PUBLISHED",
    ] as const;
    for (let i = 1; i < path.length; i++) expect(canTransitionBuild(path[i - 1]!, path[i]!)).toBe(true);
    expect(isTerminalBuildStatus("PUBLISHED")).toBe(true);
  });

  it("rejects skipping validation and leaving terminal states", () => {
    expect(canTransitionBuild("BUILDING", "READY")).toBe(false);
    expect(canTransitionBuild("FAILED", "QUEUED")).toBe(false);
  });
});

describe("release transitions", () => {
  it("supports rollback and forbids serving candidates", () => {
    expect(canTransitionRelease("INACTIVE", "ACTIVE")).toBe(true);
    expect(canTransitionRelease("CANDIDATE", "ACTIVE")).toBe(false);
    expect(canTransitionRelease("PRUNED", "ACTIVE")).toBe(false);
  });
});
