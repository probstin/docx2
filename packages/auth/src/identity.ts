import type { AuthEnv, PlatformIdentity } from "@docs-platform/contracts";

export type HeaderBag = Record<string, string | string[] | undefined>;
export type IdentityResolver = (headers: HeaderBag) => PlatformIdentity | null;

export type IdentityConfig = Pick<
  AuthEnv,
  | "AUTH_MODE"
  | "AUTH_SUBJECT_HEADER"
  | "AUTH_EMAIL_HEADER"
  | "AUTH_NAME_HEADER"
  | "AUTH_GROUPS_HEADER"
  | "AUTH_ADMIN_GROUPS"
>;

/** Subject used for the explicit, development-only AUTH_MODE=none. */
export const DEV_SUBJECT = "dev-user";

/** All raw values for a header name (case-insensitive), across repeated occurrences. */
function lookup(headers: HeaderBag, name: string): string[] {
  const wanted = name.toLowerCase();
  const values: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted || value === undefined) continue;
    if (Array.isArray(value)) values.push(...value);
    else values.push(value);
  }
  return values;
}

/** A single-valued header: exactly one occurrence, no comma. Otherwise null (ambiguous or blank). */
function single(headers: HeaderBag, name: string): string | null {
  const found = lookup(headers, name);
  if (found.length !== 1) return null;
  const value = (found[0] as string).trim();
  if (value === "" || value.includes(",")) return null;
  return value;
}

function groups(headers: HeaderBag, name: string): string[] {
  const out = new Set<string>();
  for (const raw of lookup(headers, name)) {
    for (const part of raw.split(",")) {
      const g = part.trim();
      if (g) out.add(g);
    }
  }
  return [...out];
}

/** Map trusted gateway headers to a PlatformIdentity; null means unauthenticated. */
export function createIdentityResolver(env: IdentityConfig): IdentityResolver {
  if (env.AUTH_MODE === "none") {
    return () => ({ subject: DEV_SUBJECT, groups: [...env.AUTH_ADMIN_GROUPS] });
  }
  return (headers) => {
    const subject = single(headers, env.AUTH_SUBJECT_HEADER);
    if (subject === null) return null;
    const identity: PlatformIdentity = { subject, groups: groups(headers, env.AUTH_GROUPS_HEADER) };
    // Optional single-value attributes: ambiguous or blank values are simply omitted.
    const email = single(headers, env.AUTH_EMAIL_HEADER);
    if (email !== null) identity.email = email;
    const displayName = single(headers, env.AUTH_NAME_HEADER);
    if (displayName !== null) identity.displayName = displayName;
    return identity;
  };
}

/** True only when the identity shares a group with a NONEMPTY admin list (never fails open). */
export function isAdmin(identity: PlatformIdentity | null, adminGroups: readonly string[]): boolean {
  if (!identity || adminGroups.length === 0) return false;
  const admins = new Set(adminGroups);
  return identity.groups.some((g) => admins.has(g));
}

/** Header names (lowercase) whose values must never reach logs. */
export function identityHeaderNames(env: IdentityConfig): string[] {
  return [
    ...new Set(
      [env.AUTH_SUBJECT_HEADER, env.AUTH_EMAIL_HEADER, env.AUTH_NAME_HEADER, env.AUTH_GROUPS_HEADER].map(
        (h) => h.toLowerCase(),
      ),
    ),
  ];
}
