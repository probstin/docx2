/**
 * Platform-owned Docusaurus configuration. Team repositories never touch this file.
 *
 * Everything team- or release-specific arrives through `platform.generated.json`, which the
 * builder (apps/builder) writes next to this file before running `docusaurus build`.
 *
 * Hard rules (PLAN section 9.4):
 *  - `markdown.format: "md"`: repository content is never compiled as MDX, so JSX, `import`
 *    and `export` cannot execute at build time.
 *  - `docs.include` only matches `.md` files for the same reason.
 *  - A remark plugin rejects raw HTML and `javascript:`-style URLs (format "md" still passes
 *    raw HTML through to the output, which would otherwise allow script injection).
 *  - No network access: no Algolia, no analytics, no remote fonts or stylesheets.
 *  - Every broken link, anchor, image and duplicate route fails the build.
 */
import fs from "node:fs";
import path from "node:path";
import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes as prismThemes } from "prism-react-renderer";
import restrictMarkdown from "./plugins/restrict-markdown";
import workspaceBundling from "./plugins/workspace-bundling";

interface PlatformConfig {
  title: string;
  tagline: string;
  /** Origin only, e.g. `https://docs.example.com`. */
  url: string;
  /** Always starts and ends with `/`. */
  baseUrl: string;
  /** Path under `static/` of the navbar logo, or null. */
  logo: string | null;
  theme: { mode: "light" | "dark" | "system"; primaryColor: string };
  releaseId: string;
  /** Where the browser reaches the API, e.g. `/api/v1`. */
  apiBasePath: string;
  /** Directory (relative to this file) holding the team's Markdown, mirroring the repo layout. */
  contentPath: string;
  /** Extra exclude globs for the docs plugin (relative to `contentPath`). */
  docsExclude: string[];
  assistant: {
    enabled: boolean;
    title: string;
    welcomeMessage: string;
    pageContext: boolean;
    citations: boolean;
    expandable: boolean;
  };
}

const platform = JSON.parse(
  fs.readFileSync(path.join(__dirname, "platform.generated.json"), "utf8"),
) as PlatformConfig;

const config: Config = {
  title: platform.title,
  tagline: platform.tagline,
  url: platform.url,
  baseUrl: platform.baseUrl,
  favicon: platform.logo ?? undefined,

  // Fail the build on anything that would produce a dead citation target.
  onBrokenLinks: "throw",
  onBrokenAnchors: "throw",
  onDuplicateRoutes: "throw",

  markdown: {
    format: "md",
    mermaid: false,
    hooks: {
      onBrokenMarkdownLinks: "throw",
      onBrokenMarkdownImages: "throw",
    },
  },

  i18n: { defaultLocale: "en", locales: ["en"] },

  // Read by the chat widget through `useDocusaurusContext().siteConfig.customFields`.
  customFields: {
    releaseId: platform.releaseId,
    apiBasePath: platform.apiBasePath,
    basePath: platform.baseUrl,
    assistant: platform.assistant,
  },

  plugins: [workspaceBundling],

  presets: [
    [
      "classic",
      {
        docs: {
          path: platform.contentPath,
          routeBasePath: "docs",
          include: ["**/*.md"],
          exclude: platform.docsExclude,
          // Fails the build on raw HTML / unsafe URLs (see plugins/restrict-markdown.ts).
          beforeDefaultRemarkPlugins: [restrictMarkdown],
          sidebarPath: path.join(__dirname, "sidebars.ts"),
          // Reads Git history per file; the build runs without a usable work tree.
          showLastUpdateTime: false,
          showLastUpdateAuthor: false,
        },
        blog: false,
        sitemap: false,
        gtag: undefined,
        googleTagManager: undefined,
        theme: {
          customCss: [
            path.join(__dirname, "src/css/custom.css"),
            path.join(__dirname, "src/css/theme.generated.css"),
          ],
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: platform.theme.mode === "dark" ? "dark" : "light",
      respectPrefersColorScheme: platform.theme.mode === "system",
      disableSwitch: platform.theme.mode !== "system",
    },
    navbar: {
      title: platform.title,
      logo: platform.logo ? { alt: `${platform.title} logo`, src: platform.logo } : undefined,
      items: [],
    },
    docs: { sidebar: { hideable: false } },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "toml", "yaml", "json", "diff"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
