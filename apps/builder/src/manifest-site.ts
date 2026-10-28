import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ReleaseManifest, SourceDocument } from "@docs-platform/contracts";
import { SourceError } from "@docs-platform/sources";

export interface ManifestIssue {
  route: string;
  problem: string;
}

/** The built site disagrees with what the source adapter computed (citations would break). */
export class SiteVerificationError extends SourceError {
  override name = "SiteVerificationError";
  readonly issues: ManifestIssue[];
  constructor(issues: ManifestIssue[]) {
    super(
      `Built site does not match the source documents (${issues.length} problem${issues.length === 1 ? "" : "s"}):\n` +
        issues.map((i) => `  - ${i.route}: ${i.problem}`).join("\n"),
    );
    this.issues = issues;
  }
}

/** Where Docusaurus writes the HTML for a route (`trailingSlash` unset: `<route>/index.html`). */
export function routeToHtmlPath(route: string, basePath: string): string {
  const rel = route.startsWith(basePath) ? route.slice(basePath.length) : route.replace(/^\//, "");
  return path.posix.join(rel, "index.html");
}

const HEADING_ID = /<h([1-6])\b[^>]*?\sid=(?:"([^"]*)"|'([^']*)')/g;

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** `id` attributes of `<hN>` elements (N >= `minDepth`) in an HTML page, in document order. */
export function headingIdsFromHtml(html: string, minDepth = 1): string[] {
  const ids: string[] = [];
  for (const match of html.matchAll(HEADING_ID)) {
    if (Number(match[1]) < minDepth) continue;
    ids.push(decodeAttr(match[2] ?? match[3] ?? ""));
  }
  return ids;
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

/**
 * Builds the `site` section of the release manifest from the built output and verifies the
 * anchor guarantee: every document URL and every heading anchor the source adapter computed
 * must exist in the generated HTML. Citations link to exactly these URLs and anchors, so any
 * difference fails the build with a precise list instead of shipping dead links.
 */
export async function collectManifestSite(
  outDir: string,
  sourceDocs: SourceDocument[],
  site: { title: string; basePath: string },
): Promise<ReleaseManifest["site"]> {
  const info = await stat(outDir).catch(() => undefined);
  if (!info?.isDirectory()) throw new SourceError(`Build output ${outDir} does not exist`);

  const files = await listFiles(outDir);
  const issues: ManifestIssue[] = [];
  const pages: ReleaseManifest["site"]["pages"] = [];

  for (const doc of [...sourceDocs].sort((a, b) => a.metadata.url.localeCompare(b.metadata.url))) {
    const route = doc.metadata.url;
    const htmlRel = routeToHtmlPath(route, site.basePath);
    if (!files.includes(htmlRel)) {
      issues.push({ route, problem: `no page was built for ${doc.path} (expected ${htmlRel})` });
      continue;
    }
    const html = await readFile(path.join(outDir, htmlRel), "utf8");
    const ids = new Set(headingIdsFromHtml(html));
    const missing = doc.metadata.headings.filter((h) => !ids.has(h.anchor));
    for (const h of missing) {
      issues.push({
        route,
        problem: `anchor #${h.anchor} (${"#".repeat(h.depth)} ${h.text}) is missing from ${htmlRel}`,
      });
    }
    pages.push({
      route,
      title: doc.metadata.title,
      anchors: [...new Set(doc.metadata.headings.map((h) => h.anchor))],
    });
  }

  if (issues.length > 0) throw new SiteVerificationError(issues);

  return {
    title: site.title,
    basePath: site.basePath,
    pages,
    hashedAssets: files.filter((f) => f.startsWith("assets/")),
    fileCount: files.length,
  };
}
