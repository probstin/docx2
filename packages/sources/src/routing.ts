import path from "node:path";

/**
 * Reproduces `@docusaurus/plugin-content-docs` 3.10 routing for the platform's fixed config
 * (`routeBasePath: "docs"`, default number-prefix parser, no versions, no i18n).
 * See `lib/slug.js`, `lib/numberPrefix.js` and `lib/docs.js` in the plugin.
 */

/** Plugin option `exclude` the template uses; the source adapter applies the same rules. */
export const DOCS_PLUGIN_EXCLUDE: readonly string[] = ["**/_*/**", "**/__tests__/**"];

export const ROUTE_BASE_PATH = "docs";

const IGNORED_PREFIX = /^\d+[-_.]\d+/;
const NUMBER_PREFIX = /^(?<numberPrefix>\d+)\s*[-_.]+\s*(?<suffix>[^-_.\s].*)$/;

/** `01-intro` becomes `intro`; date- and version-like names (`2021-11-foo`, `7.0-foo`) are kept. */
export function stripNumberPrefix(name: string): string {
  if (IGNORED_PREFIX.test(name)) return name;
  const match = NUMBER_PREFIX.exec(name);
  return match?.groups?.suffix ?? name;
}

export interface RouteInput {
  /** POSIX path of the Markdown file relative to the content root, e.g. `guides/01-deploy.md`. */
  relPath: string;
  frontmatter: Record<string, unknown>;
  /** `docs.yaml` `site.basePath`: starts and ends with `/`. */
  basePath: string;
  /** The configured landing page is always served at `<basePath>docs/`. */
  isLanding?: boolean;
}

export interface DocRoute {
  /** Full permalink including `basePath`, e.g. `/docs/guides/deploy`. Directory routes end in `/`. */
  url: string;
  /** Docusaurus doc id base name (after number-prefix stripping, or frontmatter `id`). */
  baseId: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function computeDocRoute(input: RouteInput): DocRoute {
  const { relPath, frontmatter, basePath } = input;
  const dir = path.posix.dirname(relPath);
  const ext = path.posix.extname(relPath);
  const fileName = path.posix.basename(relPath, ext);

  const baseId = str(frontmatter["id"]) ?? stripNumberPrefix(fileName);
  const dirSlug = dir === "." ? "/" : `/${dir.split("/").map(stripNumberPrefix).join("/")}/`;

  const lastDir = dir === "." ? "." : (dir.split("/").at(-1) as string);
  const isCategoryIndex = ["index", "readme", lastDir.toLowerCase()].includes(fileName.toLowerCase());

  const fmSlug = str(frontmatter["slug"]);
  let slug: string;
  if (input.isLanding) {
    slug = "/";
  } else if (fmSlug?.startsWith("/")) {
    slug = fmSlug;
  } else if (!fmSlug && isCategoryIndex) {
    slug = dirSlug;
  } else {
    // Resolve `.`/`..` like a URL would, but keep raw characters: Docusaurus does not percent-encode.
    slug = path.posix.normalize(`${dirSlug}${fmSlug ?? baseId}`);
  }

  const url = `${basePath}${ROUTE_BASE_PATH}${slug}`.replace(/\/{2,}/g, "/");
  return { url, baseId };
}
