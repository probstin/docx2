import { realpath } from "node:fs/promises";
import path from "node:path";
import { RepoRelativePathSchema } from "@docs-platform/contracts";
import { ContentPathError } from "./errors.js";

/** True when `child` is `parent` or lives under it. Both must be absolute and normalized. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Normalizes a repository-relative path to POSIX form without `.` segments. Throws if it is unsafe. */
export function normalizeRepoPath(relPath: string): string {
  const parsed = RepoRelativePathSchema.safeParse(relPath);
  if (!parsed.success) {
    throw new ContentPathError(
      `Unsafe path ${JSON.stringify(relPath)}: must be a relative path inside the repository`,
    );
  }
  const normalized = path.posix.normalize(relPath.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new ContentPathError(`Unsafe path ${JSON.stringify(relPath)}: escapes the repository`);
  }
  return normalized;
}

/**
 * Resolves a repository-relative path to an absolute, symlink-free path that is guaranteed to
 * live inside the checkout. Rejects traversal (`..`), absolute paths, and symlinks whose target
 * is outside the checkout. The path must exist.
 */
export async function resolveContentPath(checkoutDir: string, relPath: string): Promise<string> {
  const normalized = normalizeRepoPath(relPath);
  const root = path.resolve(checkoutDir);
  const candidate = path.resolve(root, normalized);
  if (!isInside(root, candidate)) {
    throw new ContentPathError(`Path ${JSON.stringify(relPath)} escapes the checkout`);
  }
  let realRoot: string;
  let real: string;
  try {
    realRoot = await realpath(root);
    real = await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ContentPathError(`Path ${JSON.stringify(relPath)} does not exist in the checkout`);
    }
    throw error;
  }
  if (!isInside(realRoot, real)) {
    throw new ContentPathError(
      `Path ${JSON.stringify(relPath)} resolves outside the checkout (symlink escape)`,
    );
  }
  // Fail closed on any symlink in the path, even one that stays inside the checkout.
  if (real !== path.join(realRoot, normalized)) {
    throw new ContentPathError(
      `Path ${JSON.stringify(relPath)} goes through a symlink, which is not allowed`,
    );
  }
  return real;
}
