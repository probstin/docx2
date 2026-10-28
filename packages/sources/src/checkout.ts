import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { DocsYaml, SourceDocument } from "@docs-platform/contracts";
import picomatch from "picomatch";
import { loadDocsYaml } from "./docs-yaml.js";
import { SourceError, SourceValidationError, type SourceIssue } from "./errors.js";
import { extractHeadings, parseFrontmatter } from "./markdown.js";
import { isInside, normalizeRepoPath, resolveContentPath } from "./paths.js";
import { DOCS_PLUGIN_EXCLUDE, computeDocRoute } from "./routing.js";

const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

export interface CheckoutContent {
  docsYaml: DocsYaml;
  /** Parsed Markdown documents, sorted by path. */
  documents: SourceDocument[];
  /** Non-Markdown files under the content root (images and the like), repo-relative, sorted. */
  assetFiles: string[];
  /** Markdown skipped on purpose (`draft: true`), repo-relative. */
  skipped: string[];
}

interface WalkResult {
  markdown: string[];
  assetFiles: string[];
}

/**
 * Reads a checked-out repository: validates `docs.yaml`, walks the content root and parses every
 * Markdown file. Anything the platform will not build (MDX, symlinks that leave the checkout,
 * oversize files, duplicate routes, a missing landing page) is collected and thrown together as
 * a `SourceValidationError`, so the author sees every problem at once.
 */
export async function readCheckout(checkoutDir: string): Promise<CheckoutContent> {
  const docsYaml = await loadDocsYaml(checkoutDir);
  const realCheckout = await realpath(checkoutDir);
  const issues: SourceIssue[] = [];

  let contentRootReal: string;
  try {
    contentRootReal = await resolveContentPath(checkoutDir, docsYaml.content.root);
  } catch (error) {
    throw new SourceError(
      `docs.yaml content.root: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!(await stat(contentRootReal)).isDirectory()) {
    throw new SourceError(`docs.yaml content.root "${docsYaml.content.root}" is not a directory`);
  }
  const contentRootRel = normalizeRepoPath(docsYaml.content.root);

  const isExcluded = picomatch([...docsYaml.content.exclude, ...DOCS_PLUGIN_EXCLUDE], { dot: true });
  const walked: WalkResult = { markdown: [], assetFiles: [] };
  await walk({
    dirReal: contentRootReal,
    dirRel: "",
    realCheckout,
    contentRootRel,
    isExcluded,
    issues,
    out: walked,
  });

  const documents: SourceDocument[] = [];
  const skipped: string[] = [];
  const landing = normalizeRepoPath(docsYaml.content.landingPage);

  for (const relInRoot of walked.markdown.sort()) {
    const repoPath = path.posix.join(contentRootRel, relInRoot);
    try {
      const bytes = await readFile(path.join(contentRootReal, relInRoot));
      const parsed = parseFrontmatter(bytes.toString("utf8"), repoPath);
      if (parsed.frontmatter["draft"] === true) {
        skipped.push(repoPath);
        continue;
      }
      const { headings, h1 } = extractHeadings(parsed.body);
      const route = computeDocRoute({
        relPath: relInRoot,
        frontmatter: parsed.frontmatter,
        basePath: docsYaml.site.basePath,
        isLanding: relInRoot === landing,
      });
      const fmTitle = parsed.frontmatter["title"];
      const title =
        (typeof fmTitle === "string" || typeof fmTitle === "number" ? String(fmTitle).trim() : "") ||
        h1 ||
        route.baseId;
      documents.push({
        id: repoPath,
        path: repoPath,
        content: parsed.body,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        metadata: { title, url: route.url, headings, frontmatter: parsed.frontmatter },
      });
    } catch (error) {
      issues.push({ path: repoPath, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const byUrl = new Map<string, string[]>();
  for (const doc of documents) {
    byUrl.set(doc.metadata.url, [...(byUrl.get(doc.metadata.url) ?? []), doc.path]);
  }
  for (const [url, paths] of byUrl) {
    if (paths.length > 1)
      issues.push({ path: paths.join(", "), message: `documents share the route ${url}` });
  }

  if (!documents.some((d) => d.path === path.posix.join(contentRootRel, landing))) {
    issues.push({
      path: path.posix.join(contentRootRel, landing),
      message: "content.landingPage does not exist (or is excluded or a draft)",
    });
  }

  if (issues.length > 0) throw new SourceValidationError(issues);
  return { docsYaml, documents, assetFiles: walked.assetFiles.sort(), skipped };
}

async function walk(ctx: {
  dirReal: string;
  dirRel: string;
  realCheckout: string;
  contentRootRel: string;
  isExcluded: (p: string) => boolean;
  issues: SourceIssue[];
  out: WalkResult;
}): Promise<void> {
  const entries = await readdir(ctx.dirReal, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue; // dotfiles and `.git`, like Docusaurus' globbing
    const relInRoot = ctx.dirRel === "" ? entry.name : `${ctx.dirRel}/${entry.name}`;
    const repoPath = path.posix.join(ctx.contentRootRel, relInRoot);
    const abs = path.join(ctx.dirReal, entry.name);
    const lower = entry.name.toLowerCase();

    if (entry.isDirectory()) {
      await walk({ ...ctx, dirReal: abs, dirRel: relInRoot });
      continue;
    }

    if (ctx.isExcluded(relInRoot)) continue;

    if (entry.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(abs);
      } catch {
        ctx.issues.push({ path: repoPath, message: "broken symlink" });
        continue;
      }
      if (!isInside(ctx.realCheckout, target)) {
        ctx.issues.push({ path: repoPath, message: "symlink resolves outside the checkout" });
        continue;
      }
      const info = await stat(target);
      if (info.isDirectory()) {
        ctx.issues.push({ path: repoPath, message: "directory symlinks are not supported" });
        continue;
      }
      if (!info.isFile()) {
        ctx.issues.push({ path: repoPath, message: "symlink does not point to a regular file" });
        continue;
      }
    } else if (!entry.isFile()) {
      ctx.issues.push({ path: repoPath, message: "not a regular file" });
      continue;
    }

    if (lower.endsWith(".mdx")) {
      ctx.issues.push({
        path: repoPath,
        message:
          "MDX is not supported: content may only be plain Markdown (.md); JSX, import and export are never compiled",
      });
      continue;
    }

    const info = await lstat(abs).then(async (l) => (l.isSymbolicLink() ? await stat(abs) : l));
    if (entry.name.endsWith(".md")) {
      if (info.size > MAX_MARKDOWN_BYTES) {
        ctx.issues.push({
          path: repoPath,
          message: `Markdown file is larger than ${MAX_MARKDOWN_BYTES} bytes`,
        });
        continue;
      }
      ctx.out.markdown.push(relInRoot);
    } else {
      ctx.out.assetFiles.push(repoPath);
    }
  }
}
