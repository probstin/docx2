import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import type { DocsYaml, SourceDocument } from "@docs-platform/contracts";
import {
  DOCS_PLUGIN_EXCLUDE,
  SourceError,
  computeDocRoute,
  isInside,
  normalizeRepoPath,
  resolveContentPath,
  setFrontmatterField,
} from "@docs-platform/sources";
import { z } from "zod";
import { generateThemeCss } from "./theme.js";

/** Shape of `platform.generated.json`; the template's `docusaurus.config.ts` mirrors it. */
export const PlatformConfigSchema = z.object({
  title: z.string(),
  tagline: z.string(),
  url: z.string(),
  baseUrl: z.string(),
  logo: z.string().nullable(),
  theme: z.object({ mode: z.enum(["light", "dark", "system"]), primaryColor: z.string() }),
  releaseId: z.string(),
  contentPath: z.string(),
  docsExclude: z.array(z.string()),
  assistant: z.object({
    enabled: z.boolean(),
    title: z.string(),
    welcomeMessage: z.string(),
    pageContext: z.boolean(),
    citations: z.boolean(),
    expandable: z.boolean(),
  }),
});
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;

/** The already-read repository content: `readCheckout`'s result, or a `GitMarkdownSnapshot` mapped onto it. */
export interface BuildSiteContent {
  docsYaml: DocsYaml;
  /** Parsed Markdown documents. */
  documents: SourceDocument[];
  /** Non-Markdown files under the content root (repo-relative). */
  assetFiles: string[];
}

export interface BuildSiteOptions {
  /** A checked-out repository (see `GitMarkdownSourceAdapter`). */
  checkoutDir: string;
  /** What was read from `checkoutDir`; it is not parsed again, so the config cannot disagree with it. */
  content: BuildSiteContent;
  releaseId: string;
  /** Public origin of the site, e.g. `https://docs.example.com`. Any path is ignored: use `docsYaml.site.basePath`. */
  publicUrl: string;
  /** Scratch directory; the Docusaurus project is assembled in `<workDir>/site`. */
  workDir: string;
  /** Receives the static site. Replaced if it exists. */
  outDir: string;
  /** Kill the Docusaurus build after this long. Default 10 minutes. */
  timeoutMs?: number;
}

export interface BuildSiteResult {
  outDir: string;
  /** The documents that went into the site (same data the source adapter yields). */
  documents: SourceDocument[];
  platform: PlatformConfig;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class SiteBuildError extends SourceError {
  override name = "SiteBuildError";
  constructor(
    message: string,
    readonly stdout = "",
    readonly stderr = "",
  ) {
    super(message);
  }
}

const COPIED_ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".pdf",
  ".mp4",
  ".webm",
  ".txt",
  ".csv",
  ".json",
]);

/** Template entries never copied into the work directory. */
const TEMPLATE_SKIP = new Set(["node_modules", "build", ".docusaurus", "docs", "repo", ".gitignore"]);

function templateDir(): string {
  const require = createRequire(import.meta.url);
  return path.dirname(require.resolve("@docs-platform/docusaurus-template/package.json"));
}

/**
 * Assembles the platform-owned Docusaurus project around the team's content and builds it.
 *
 * Layout inside `<workDir>/site` (mirrors the repository so relative image and link paths in the
 * Markdown resolve exactly as authors wrote them, with no rewriting):
 *
 *   repo/<content.root>/**.md   the Markdown (docs plugin `path`)
 *   repo/assets/**              the repository's assets directory
 *   static/platform/logo.*      site.logo
 *
 * The only Markdown change ever made is forcing `slug: /` on a landing page that would not
 * otherwise be served at `/docs/`.
 */
export async function buildSite(options: BuildSiteOptions): Promise<BuildSiteResult> {
  const { checkoutDir, content, releaseId, workDir, outDir } = options;
  const { docsYaml } = content;
  const started = Date.now();

  const realCheckout = await realpath(checkoutDir);
  const tplDir = templateDir();
  const siteDir = path.resolve(workDir, "site");
  const absOut = path.resolve(outDir);
  await assertSafeOutDir(absOut, [checkoutDir, workDir]);
  if (isInside(siteDir, absOut) || isInside(absOut, siteDir)) {
    throw new SiteBuildError("outDir and workDir/site must not overlap");
  }

  await rm(siteDir, { recursive: true, force: true });
  await rm(absOut, { recursive: true, force: true });
  await mkdir(siteDir, { recursive: true });

  // 1. The fixed template, minus dependencies and anything generated.
  await cp(tplDir, siteDir, {
    recursive: true,
    filter: (src) => !TEMPLATE_SKIP.has(path.relative(tplDir, src).split(path.sep)[0] ?? ""),
  });
  await linkNodeModules(tplDir, siteDir);

  // 2. Content, mirroring the repository layout.
  const contentRootRel = normalizeRepoPath(docsYaml.content.root);
  const repoDir = path.join(siteDir, "repo");
  const landingPath = path.posix.join(contentRootRel, normalizeRepoPath(docsYaml.content.landingPage));
  for (const doc of content.documents) {
    const dest = path.join(repoDir, doc.path);
    await mkdir(path.dirname(dest), { recursive: true });
    const src = path.join(realCheckout, doc.path);
    if (doc.path === landingPath && needsLandingSlug(doc, docsYaml, contentRootRel)) {
      await writeFile(dest, setFrontmatterField(await readFile(src, "utf8"), "slug", "/"));
    } else {
      await copyFile(src, dest);
    }
  }
  for (const rel of content.assetFiles) {
    if (!COPIED_ASSET_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    const dest = path.join(repoDir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(realCheckout, rel), dest);
  }
  await copyAssetsDir(realCheckout, path.join(repoDir, "assets"));

  // 3. Logo.
  let logo: string | null = null;
  if (docsYaml.site.logo) {
    const logoReal = await resolveContentPath(checkoutDir, docsYaml.site.logo);
    if (!(await stat(logoReal)).isFile())
      throw new SiteBuildError(`site.logo "${docsYaml.site.logo}" is not a file`);
    const ext = path.extname(logoReal).toLowerCase();
    if (![".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".gif"].includes(ext)) {
      throw new SiteBuildError(
        `site.logo "${docsYaml.site.logo}" must be an image (svg, png, jpg, webp, ico, gif)`,
      );
    }
    logo = `platform/logo${ext}`;
    await mkdir(path.join(siteDir, "static", "platform"), { recursive: true });
    await copyFile(logoReal, path.join(siteDir, "static", logo));
  }

  // 4. Generated configuration.
  const platform: PlatformConfig = PlatformConfigSchema.parse({
    title: docsYaml.site.title,
    tagline: docsYaml.site.tagline ?? "",
    url: new URL(options.publicUrl).origin,
    baseUrl: docsYaml.site.basePath,
    logo,
    theme: { mode: docsYaml.theme.mode, primaryColor: docsYaml.theme.primaryColor },
    releaseId,
    contentPath: `repo/${contentRootRel}`,
    docsExclude: [...DOCS_PLUGIN_EXCLUDE, ...docsYaml.content.exclude],
    assistant: docsYaml.assistant,
  });
  await writeFile(path.join(siteDir, "platform.generated.json"), `${JSON.stringify(platform, null, 2)}\n`);
  await writeFile(
    path.join(siteDir, "src", "css", "theme.generated.css"),
    generateThemeCss(docsYaml.theme.primaryColor),
  );

  // 5. Build, offline, with the template's own Docusaurus binary.
  const bin = path.join(tplDir, "node_modules", "@docusaurus", "core", "bin", "docusaurus.mjs");
  const { stdout, stderr } = await runDocusaurus(bin, siteDir, absOut, options.timeoutMs ?? 10 * 60_000);

  return {
    outDir: absOut,
    documents: content.documents,
    platform,
    stdout,
    stderr,
    durationMs: Date.now() - started,
  };
}

/** `realpath` of the deepest existing ancestor, with the missing remainder appended. */
async function realpathLoose(p: string): Promise<string> {
  const abs = path.resolve(p);
  try {
    return await realpath(abs);
  } catch {
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    return path.join(await realpathLoose(parent), path.basename(abs));
  }
}

/** `outDir` is deleted before the build, so refuse anything that could take real data with it. */
async function assertSafeOutDir(absOut: string, protectedDirs: string[]): Promise<void> {
  const out = await realpathLoose(absOut);
  const home = await realpathLoose(homedir());
  if (out === path.parse(out).root) throw new SiteBuildError("refusing to use the filesystem root as outDir");
  if (out === home) throw new SiteBuildError("refusing to use the home directory as outDir");
  for (const dir of protectedDirs) {
    const real = await realpathLoose(dir);
    if (out === real || isInside(out, real) || isInside(real, out)) {
      throw new SiteBuildError(`outDir "${absOut}" must not equal, contain or be inside "${dir}"`);
    }
  }
}

function needsLandingSlug(doc: SourceDocument, docsYaml: DocsYaml, contentRootRel: string): boolean {
  const relInRoot = path.posix.relative(contentRootRel, doc.path);
  const natural = computeDocRoute({
    relPath: relInRoot,
    frontmatter: doc.metadata.frontmatter,
    basePath: docsYaml.site.basePath,
  });
  return natural.url !== doc.metadata.url;
}

/**
 * Gives the work copy its own `node_modules` made of symlinks to the template's top-level
 * packages. Docusaurus writes its caches into `node_modules/.cache`; a real directory keeps those
 * writes out of the shared template install.
 */
async function linkNodeModules(tplDir: string, siteDir: string): Promise<void> {
  const src = path.join(tplDir, "node_modules");
  const dest = path.join(siteDir, "node_modules");
  await mkdir(dest, { recursive: true });
  for (const name of await readdir(src)) {
    if (name === ".cache" || name === ".bin") continue;
    await symlink(await realpath(path.join(src, name)), path.join(dest, name));
  }
}

/** Copies `<checkout>/assets` (if present), refusing symlinks and anything that is not a regular file. */
async function copyAssetsDir(realCheckout: string, dest: string): Promise<void> {
  const src = path.join(realCheckout, "assets");
  const info = await lstat(src).catch(() => undefined);
  if (!info) return;
  if (info.isSymbolicLink()) throw new SiteBuildError("assets must not be a symlink");
  if (!info.isDirectory()) throw new SiteBuildError("assets must be a directory");
  const problems: string[] = [];
  await copyTree(src, dest, "assets", problems);
  if (problems.length > 0) {
    throw new SiteBuildError(`Unsafe files in assets/:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

async function copyTree(srcDir: string, destDir: string, rel: string, problems: string[]) {
  await mkdir(destDir, { recursive: true });
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // never copies `.git` or other dotfiles
    const src = path.join(srcDir, entry.name);
    const here = `${rel}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      problems.push(`${here}: symlinks are not allowed`);
    } else if (entry.isDirectory()) {
      await copyTree(src, path.join(destDir, entry.name), here, problems);
    } else if (entry.isFile()) {
      await copyFile(src, path.join(destDir, entry.name));
    } else {
      problems.push(`${here}: not a regular file`);
    }
  }
}

function runDocusaurus(bin: string, siteDir: string, outDir: string, timeoutMs: number) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      process.execPath,
      [bin, "build", "--out-dir", outDir],
      {
        cwd: siteDir,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          // No update checks, no telemetry, no interactive anything.
          NO_UPDATE_NOTIFIER: "1",
          DO_NOT_TRACK: "1",
          DOCUSAURUS_TELEMETRY_DISABLED: "1",
          CI: "true",
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const timedOut = "killed" in error && error.killed;
          const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-40).join("\n");
          reject(
            new SiteBuildError(
              `${timedOut ? `docusaurus build timed out after ${timeoutMs} ms` : "docusaurus build failed"}:\n${tail}`,
              stdout,
              stderr,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
