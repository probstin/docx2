import { z } from "zod";

/** A repository-relative path that cannot escape the checkout (no absolute paths, drive letters, or `..`). */
export const RepoRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (p) =>
      !p.includes("\0") &&
      !p.startsWith("/") &&
      !p.startsWith("\\") &&
      !/^[a-zA-Z]:/.test(p) &&
      !p.split(/[\\/]/).includes(".."),
    { message: "must be a relative path inside the repository" },
  );
