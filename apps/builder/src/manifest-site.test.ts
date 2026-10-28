import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SourceDocument } from "@docs-platform/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SiteVerificationError,
  collectManifestSite,
  headingIdsFromHtml,
  routeToHtmlPath,
} from "./manifest-site.js";
import { generateThemeCss } from "./theme.js";

let out: string;
beforeEach(async () => {
  out = await mkdtemp(path.join(tmpdir(), "builder-manifest-"));
});
afterEach(async () => {
  await rm(out, { recursive: true, force: true });
});

function doc(url: string, anchors: string[]): SourceDocument {
  return {
    id: `docs${url}.md`,
    path: `docs${url}.md`,
    content: "",
    checksum: "0".repeat(64),
    metadata: {
      title: `Title ${url}`,
      url,
      headings: anchors.map((anchor) => ({ text: anchor, anchor, depth: 2 })),
      frontmatter: {},
    },
  };
}

async function page(rel: string, html: string): Promise<void> {
  await mkdir(path.dirname(path.join(out, rel)), { recursive: true });
  await writeFile(path.join(out, rel), html);
}

describe("routeToHtmlPath", () => {
  it("maps routes to Docusaurus output files, honoring basePath", () => {
    expect(routeToHtmlPath("/docs/", "/")).toBe("docs/index.html");
    expect(routeToHtmlPath("/docs/guides/deploy", "/")).toBe("docs/guides/deploy/index.html");
    expect(routeToHtmlPath("/team/docs/guides/", "/team/")).toBe("docs/guides/index.html");
  });
});

describe("headingIdsFromHtml", () => {
  it("reads heading ids only", () => {
    const html = `<div id="__docusaurus"><h2 class="anchor x" id="a">A</h2><h3 id='b'>B</h3><p id="nope">x</p></div>`;
    expect(headingIdsFromHtml(html)).toEqual(["a", "b"]);
  });
});

describe("collectManifestSite", () => {
  const site = { title: "T", basePath: "/" };

  it("produces the manifest site section", async () => {
    await page("docs/index.html", `<h1 id="t">T</h1><h2 id="one">One</h2>`);
    await page("docs/a/index.html", `<h2 id="x">X</h2><h2 id="y">Y</h2>`);
    await page("assets/js/main.abc123.js", "//");
    await page("assets/css/styles.def456.css", "/**/");
    const result = await collectManifestSite(out, [doc("/docs/a", ["x", "y"]), doc("/docs/", ["one"])], site);
    expect(result.pages).toEqual([
      { route: "/docs/", title: "Title /docs/", anchors: ["one"] },
      { route: "/docs/a", title: "Title /docs/a", anchors: ["x", "y"] },
    ]);
    expect(result.hashedAssets).toEqual(["assets/css/styles.def456.css", "assets/js/main.abc123.js"]);
    expect(result.fileCount).toBe(4);
    expect(result.basePath).toBe("/");
  });

  it("fails with a precise list of missing pages and anchors", async () => {
    await page("docs/a/index.html", `<h2 id="x">X</h2>`);
    const error = await collectManifestSite(
      out,
      [doc("/docs/a", ["x", "gone"]), doc("/docs/missing", ["z"])],
      site,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SiteVerificationError);
    const issues = (error as SiteVerificationError).issues;
    expect(issues).toHaveLength(2);
    expect(issues[0]?.route).toBe("/docs/a");
    expect(issues[0]?.problem).toContain("#gone");
    expect(issues[1]?.route).toBe("/docs/missing");
    expect((error as Error).message).toContain("docs/a/index.html");
  });
});

describe("generateThemeCss", () => {
  it("emits Infima primary shades for light and dark", () => {
    const css = generateThemeCss("#2e8555");
    expect(css).toContain("--ifm-color-primary: #2e8555;");
    expect(css).toMatch(/--ifm-color-primary-dark: #29784[cd];/);
    expect(css).toContain("[data-theme='dark']");
    for (const suffix of ["dark", "darker", "darkest", "light", "lighter", "lightest"]) {
      expect(css).toContain(`--ifm-color-primary-${suffix}:`);
    }
  });

  it("rejects invalid colors", () => {
    expect(() => generateThemeCss("blue")).toThrow(/Invalid hex/);
  });
});
