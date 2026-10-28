import { describe, expect, it } from "vitest";
import { AuthEnvSchema, loadEnv } from "@docs-platform/contracts";
import { createIdentityResolver, identityHeaderNames, isAdmin } from "./index.js";

const env = (o: Record<string, string> = {}) => loadEnv(AuthEnvSchema, o);

describe("createIdentityResolver (trusted-header)", () => {
  const resolve = createIdentityResolver(env({ AUTH_ADMIN_GROUPS: "admins" }));

  it("maps headers case-insensitively", () => {
    expect(
      resolve({
        "X-Auth-Request-User": " alice ",
        "X-AUTH-REQUEST-EMAIL": "a@x.io",
        "x-auth-request-preferred-username": "Alice",
        "x-auth-request-groups": "a, b ,,a",
      }),
    ).toEqual({ subject: "alice", email: "a@x.io", displayName: "Alice", groups: ["a", "b"] });
  });
  it("returns null without a subject", () => {
    expect(resolve({})).toBeNull();
    expect(resolve({ "x-auth-request-groups": "admins" })).toBeNull();
  });
  it.each(["", "   ", "\t"])("returns null for blank subject %j", (v) => {
    expect(resolve({ "x-auth-request-user": v })).toBeNull();
  });
  it("treats repeated or comma-containing subjects as ambiguous", () => {
    expect(resolve({ "x-auth-request-user": ["alice", "mallory"] })).toBeNull();
    expect(resolve({ "x-auth-request-user": "alice, mallory" })).toBeNull();
    expect(resolve({ "x-auth-request-user": ["alice"], "X-Auth-Request-User": "bob" })).toBeNull();
  });
  it("merges repeated group headers and dedupes", () => {
    const id = resolve({ "x-auth-request-user": "u", "x-auth-request-groups": ["a,b", "b, c"] });
    expect(id?.groups).toEqual(["a", "b", "c"]);
  });
  it("omits ambiguous optional attributes but keeps the identity", () => {
    const id = resolve({ "x-auth-request-user": "u", "x-auth-request-email": ["a@x", "b@x"] });
    expect(id).toEqual({ subject: "u", groups: [] });
  });
  it("only honours the configured subject header", () => {
    const custom = createIdentityResolver(env({ AUTH_SUBJECT_HEADER: "X-Sub" }));
    expect(custom({ "x-auth-request-user": "mallory" })).toBeNull();
    expect(custom({ "x-sub": "sam" })?.subject).toBe("sam");
  });
});

describe("AUTH_MODE=none", () => {
  it("returns the fixed dev identity with admin groups", () => {
    const resolve = createIdentityResolver(
      env({ AUTH_MODE: "none", AUTH_ALLOW_INSECURE_NONE: "true", AUTH_ADMIN_GROUPS: "admins,ops" }),
    );
    expect(resolve({ "x-auth-request-user": "someone-else" })).toEqual({
      subject: "dev-user",
      groups: ["admins", "ops"],
    });
  });
});

describe("isAdmin", () => {
  const id = { subject: "u", groups: ["a", "b"] };
  it("requires intersection", () => {
    expect(isAdmin(id, ["b"])).toBe(true);
    expect(isAdmin(id, ["z"])).toBe(false);
  });
  it("does not fail open on an empty admin list or missing identity", () => {
    expect(isAdmin(id, [])).toBe(false);
    expect(isAdmin({ subject: "u", groups: [] }, [])).toBe(false);
    expect(isAdmin(null, ["a"])).toBe(false);
  });
});

describe("identityHeaderNames", () => {
  it("lists lowercase configured names", () => {
    expect(identityHeaderNames(env({ AUTH_SUBJECT_HEADER: "X-Sub" }))).toContain("x-sub");
    expect(identityHeaderNames(env())).toContain("x-auth-request-groups");
  });
});
