/**
 * SLOW INTEGRATION TESTS: each `buildSite` runs a real offline `docusaurus build` (10-30 s).
 * Set SKIP_SLOW_TESTS=1 to skip this file.
 */
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCheckout, SourceValidationError } from "@docs-platform/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SiteVerificationError,
  collectManifestSite,
  headingIdsFromHtml,
  routeToHtmlPath,
} from "./manifest-site.js";
import { SiteBuildError, buildSite, type BuildSiteResult } from "./site.js";

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/sample-docs");
const SLOW_TIMEOUT = 240_000;
const describeSlow = process.env["SKIP_SLOW_TESTS"] ? describe.skip : describe;

const RELEASE_ID = "20260101000000-abcdef123456";

let tmp: string;
beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "builder-it-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function fixture(name: string, mutate: (dir: string) => Promise<void>): Promise<string> {
  const dir = path.join(tmp, `${name}-src`);
  await cp(SAMPLE, dir, { recursive: true });
  await mutate(dir);
  return dir;
}

async function build(
  name: string,
  checkoutDir: string,
  apiBasePath?: string,
): Promise<BuildSiteResult & { site: Awaited<ReturnType<typeof collectManifestSite>> }> {
  const content = await readCheckout(checkoutDir);
  const built = await buildSite({
    checkoutDir,
    content,
    releaseId: RELEASE_ID,
    publicUrl: "https://docs.example.com",
    workDir: path.join(tmp, `${name}-work`),
    outDir: path.join(tmp, `${name}-out`),
    ...(apiBasePath ? { apiBasePath } : {}),
  });
  const site = await collectManifestSite(built.outDir, built.documents, {
    title: content.docsYaml.site.title,
    basePath: content.docsYaml.site.basePath,
  });
  return { ...built, site };
}

async function allFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await allFiles(full)));
    else out.push(full);
  }
  return out;
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describeSlow("integration: sample-docs site build (slow)", () => {
  let result: Awaited<ReturnType<typeof build>>;

  beforeAll(async () => {
    const checkout = await fixture("sample", async (dir) => {
      // Tricky headings, compared against what Docusaurus really generates.
      await writeFile(
        path.join(dir, "docs", "edge-cases.md"),
        [
          "# Edge cases",
          "",
          "## Edge cases",
          "",
          "## Setup & Config: v2.0 (beta)!",
          "",
          "## Setup & Config: v2.0 (beta)!",
          "",
          "## The `atlasctl deploy` command",
          "",
          "## **Bold** and _em_ and snake_case_name",
          "",
          "## A [link](https://example.com) here ##",
          "",
          "## Ünïcödé Çafé",
          "",
          "## 日本語 見出し",
          "",
          "## Custom {#My_Custom-ID}",
          "",
          "### Edge cases",
          "",
          "```md",
          "## in code fence",
          "```",
          "",
          "## Trailing   spaces   ",
          "",
          "## 1. Numbered heading",
          "",
          '## What\'s "quoted"?',
          "",
        ].join("\n"),
      );
      // Executable-looking content that must stay inert text (no raw HTML here: see the failure test).
      await writeFile(
        path.join(dir, "docs", "injected.md"),
        [
          "---",
          "title: Injected",
          "---",
          "",
          "# Injected",
          "",
          "import Evil from './evil.js'",
          "",
          "export const answer = 42",
          "",
          "<!-- a comment is fine -->",
          "",
          "Result: {1 + 1} and {process.env.HOME}",
          "",
          "```html",
          "<script>window.PWNED = 1</script>",
          "```",
          "",
          "## After injection",
          "",
        ].join("\n"),
      );
    });
    result = await build("sample", checkout);
  }, SLOW_TIMEOUT);

  it("builds every non-excluded page and the manifest lists them", () => {
    const routes = result.site.pages.map((p) => p.route);
    expect(routes).toEqual(
      [
        "/docs/",
        "/docs/architecture/overview",
        "/docs/edge-cases",
        "/docs/getting-started",
        "/docs/guides/configuration",
        "/docs/guides/deployment",
        "/docs/guides/oncall",
        "/docs/injected",
        "/docs/reference/cli",
        "/docs/reference/limits", // 02-limits.md: number prefix stripped
      ].sort(),
    );
    expect(result.site.fileCount).toBeGreaterThan(10);
    expect(result.site.hashedAssets.length).toBeGreaterThan(0);
    expect(result.site.hashedAssets.every((a) => a.startsWith("assets/"))).toBe(true);
  });

  it("serves the landing page at /docs/ and redirects the site root there", async () => {
    const landing = await readFile(path.join(result.outDir, "docs", "index.html"), "utf8");
    expect(landing).toContain("Atlas Platform");
    expect(landing).toContain('id="what-atlas-does"');
    const root = await readFile(path.join(result.outDir, "index.html"), "utf8");
    expect(root).toMatch(/http-equiv="refresh"[^>]*content="0;\s*url=\/docs\/"/);
  });

  it("generates exactly the anchors the source adapter computed (h2-h6, in order)", async () => {
    for (const doc of result.documents) {
      const html = await readFile(path.join(result.outDir, routeToHtmlPath(doc.metadata.url, "/")), "utf8");
      // h2-h6 ids in the page versus the adapter's anchors. (The h1 title has no id in the output,
      // but Docusaurus still counts it for duplicates: see "edge-cases-1" below.)
      const built = headingIdsFromHtml(html, 2);
      expect(built, doc.path).toEqual(doc.metadata.headings.map((h) => h.anchor));
    }
    const deployment = result.documents.find((d) => d.path.endsWith("deployment.md"));
    expect(deployment?.metadata.headings.map((h) => h.anchor)).toContain("rollback");
    const edge = result.documents.find((d) => d.path.endsWith("edge-cases.md"));
    expect(edge?.metadata.headings.map((h) => h.anchor)).toEqual([
      "edge-cases-1",
      "setup--config-v20-beta",
      "setup--config-v20-beta-1",
      "the-atlasctl-deploy-command",
      "bold-and-em-and-snake_case_name",
      "a-link-here",
      "ünïcödé-çafé",
      "日本語-見出し",
      "My_Custom-ID",
      "edge-cases-2",
      "trailing---spaces",
      "1-numbered-heading",
      "whats-quoted",
    ]);
  });

  it("does not publish excluded drafts", async () => {
    expect(await exists(path.join(result.outDir, "docs", "_drafts"))).toBe(false);
    for (const file of await allFiles(result.outDir)) {
      if (!/\.(html|js|json|css|txt)$/.test(file)) continue;
      expect(await readFile(file, "utf8"), file).not.toContain("ZEPHYR-DRAFT-7731");
    }
  });

  it("keeps import/export/JSX-like and script content inert (format md)", async () => {
    const html = await readFile(path.join(result.outDir, "docs", "injected", "index.html"), "utf8");
    expect(html).toContain("import Evil from");
    expect(html).toContain("export const answer = 42");
    expect(html).toContain("{1 + 1}");
    expect(html).toContain("{process.env.HOME}");
    expect(html).not.toContain("<evil");
    expect(html).not.toMatch(/<script>\s*window\.PWNED/);
    // The only scripts in a page are the platform's own bundles.
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const body of inline) expect(body).not.toContain("PWNED");
    // The fenced example is shown as code, escaped.
    expect(html).toContain("PWNED");
    expect(html).toContain("&lt;");
  });

  it("copies the image and logo, and exposes release + assistant config to the client", async () => {
    const overview = await readFile(
      path.join(result.outDir, "docs", "architecture", "overview", "index.html"),
      "utf8",
    );
    expect(overview).toMatch(
      /<img[^>]+alt="Atlas request flow from Gateway to Scheduler to Runner"[^>]+src="(data:image\/svg|\/assets\/images\/)/,
    );
    expect(await exists(path.join(result.outDir, "platform", "logo.svg"))).toBe(true);

    const main = (await allFiles(path.join(result.outDir, "assets", "js"))).find((f) =>
      /main\.[0-9a-f]+\.js$/.test(f),
    );
    expect(main).toBeDefined();
    const js = await readFile(main as string, "utf8");
    expect(js).toContain(RELEASE_ID);
    expect(js).toContain("Ask Atlas AI");
    const css = await readFile(
      (await allFiles(path.join(result.outDir, "assets", "css"))).find((f) => f.endsWith(".css")) as string,
      "utf8",
    );
    expect(css).toContain("#0f766e");
  });

  it("includes the chat mount point and makes no external requests", async () => {
    const html = await readFile(path.join(result.outDir, "docs", "index.html"), "utf8");
    expect(html).toContain('id="docs-platform-chat-root"');
    const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    // Only links authored in the docs (the footer-less theme has none of its own).
    expect(
      external.filter((u) => /googleapis|gstatic|algolia|google-analytics|googletagmanager/.test(u ?? "")),
    ).toEqual([]);
    expect(html).not.toMatch(/googleapis|gstatic|algolia/);
  });

  it("bundles the chat widget with the default API base path, under hashed assets/", async () => {
    expect(result.platform.apiBasePath).toBe("/api/v1");
    const generated = JSON.parse(
      await readFile(path.join(tmp, "sample-work", "site", "platform.generated.json"), "utf8"),
    ) as { apiBasePath: string };
    expect(generated.apiBasePath).toBe("/api/v1");

    const jsFiles = (await allFiles(path.join(result.outDir, "assets", "js"))).filter((f) =>
      /\.[0-9a-f]{8,}\.js$/.test(f),
    );
    expect(jsFiles.length).toBeGreaterThan(0);
    const bundles = await Promise.all(jsFiles.map((f) => readFile(f, "utf8")));
    const all = bundles.join("\n");
    expect(all).toContain("dp-chat-launcher");
    expect(all).toContain("/api/v1");
    expect(all).toContain("docs-platform:");
    const css = (await allFiles(path.join(result.outDir, "assets", "css")))
      .filter((f) => f.endsWith(".css"))
      .map((f) => readFile(f, "utf8"));
    expect((await Promise.all(css)).join("\n")).toContain(".dp-chat-launcher");
    // Hashed names everywhere (ADR 0002), and the widget is client-only: no launcher in static HTML.
    expect(result.site.hashedAssets.every((a) => /\.[0-9a-f]{8,}\./.test(a))).toBe(true);
    const html = await readFile(path.join(result.outDir, "docs", "index.html"), "utf8");
    expect(html).not.toContain("dp-chat-launcher");
  });
});

describeSlow("integration: routing with basePath and a non-index landing page (slow)", () => {
  it(
    "prefixes basePath, serves the configured landing page at /docs/, strips number prefixes",
    async () => {
      const checkout = await fixture("routing", async (dir) => {
        await writeFile(
          path.join(dir, "docs.yaml"),
          (await readFile(path.join(dir, "docs.yaml"), "utf8"))
            .replace("basePath: /", "basePath: /team-a/")
            .replace("landingPage: index.md", "landingPage: welcome.md"),
        );
        await rm(path.join(dir, "docs", "index.md"));
        await writeFile(
          path.join(dir, "docs", "welcome.md"),
          "---\nslug: /elsewhere\n---\n# Welcome\n\n## Start here\n",
        );
        await mkdir(path.join(dir, "docs", "10-ops", "01-runbooks"), { recursive: true });
        await writeFile(
          path.join(dir, "docs", "10-ops", "01-runbooks", "README.md"),
          "# Runbooks\n\n## Index\n",
        );
        await writeFile(
          path.join(dir, "docs", "10-ops", "01-runbooks", "02-restart.md"),
          "---\nslug: reboot\n---\n# Restart\n\n## Steps\n",
        );
        await writeFile(path.join(dir, "docs", "10-ops", "custom.md"), "---\nid: renamed\n---\n# Custom\n");
        await writeFile(
          path.join(dir, "docs", "getting-started.md"),
          "# Getting started\n\nBack to [home](./welcome.md).\n",
        );
        await rm(path.join(dir, "docs", "architecture"), { recursive: true });
        await rm(path.join(dir, "docs", "guides"), { recursive: true });
        await rm(path.join(dir, "docs", "reference"), { recursive: true });
      });
      const built = await build("routing", checkout, "/gateway/api");
      expect(built.platform.apiBasePath).toBe("/gateway/api");
      const routingJs = await readFile(
        (await allFiles(path.join(built.outDir, "assets", "js"))).find((f) =>
          /main\.[0-9a-f]+\.js$/.test(f),
        ) as string,
        "utf8",
      );
      expect(routingJs).toContain("/gateway/api");
      const routes = built.site.pages.map((p) => p.route);
      expect(routes).toEqual([
        "/team-a/docs/",
        "/team-a/docs/getting-started",
        "/team-a/docs/ops/renamed",
        "/team-a/docs/ops/runbooks/",
        "/team-a/docs/ops/runbooks/reboot",
      ]);
      expect(await exists(path.join(built.outDir, "docs", "index.html"))).toBe(true);
      const landing = await readFile(path.join(built.outDir, "docs", "index.html"), "utf8");
      expect(landing).toContain("Start here");
      // The original file in the checkout is never modified.
      expect(await readFile(path.join(checkout, "docs", "welcome.md"), "utf8")).toContain("slug: /elsewhere");
    },
    SLOW_TIMEOUT,
  );
});

describeSlow("integration: content the platform must refuse (slow)", () => {
  it("rejects .mdx before any build starts", async () => {
    const checkout = await fixture("mdx", async (dir) => {
      await writeFile(path.join(dir, "docs", "widget.mdx"), "import X from './x'\n\n<X />\n");
    });
    const error = await build("mdx", checkout).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceValidationError);
    expect((error as Error).message).toContain("docs/widget.mdx");
    expect(await exists(path.join(tmp, "mdx-out"))).toBe(false);
  });

  it(
    "fails the build on raw HTML (<script>, event handlers) and javascript: URLs, naming file and line",
    async () => {
      const checkout = await fixture("html", async (dir) => {
        await writeFile(
          path.join(dir, "docs", "bad-html.md"),
          "# Bad\n\ntext\n\n<script>window.PWNED = 1</script>\n",
        );
        await writeFile(
          path.join(dir, "docs", "bad-link.md"),
          "# Bad link\n\n[click](javascript:alert(1))\n",
        );
      });
      const error = await build("html", checkout).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SiteBuildError);
      const message = (error as Error).message;
      expect(message).toContain("bad-html.md:5");
      expect(message).toContain("raw HTML is not allowed");
      expect(message).toContain('"javascript:" scheme');
      expect(await exists(path.join(tmp, "html-out", "docs", "bad-html"))).toBe(false);
    },
    SLOW_TIMEOUT,
  );

  it(
    "fails verification if the built HTML lacks a source anchor",
    async () => {
      const checkout = await fixture("verify", async () => {});
      const built = await buildSite({
        checkoutDir: checkout,
        content: await readCheckout(checkout),
        releaseId: RELEASE_ID,
        publicUrl: "https://docs.example.com",
        workDir: path.join(tmp, "verify-work"),
        outDir: path.join(tmp, "verify-out"),
      });
      const tampered = built.documents.map((d) =>
        d.path.endsWith("deployment.md")
          ? {
              ...d,
              metadata: {
                ...d.metadata,
                headings: [...d.metadata.headings, { text: "Ghost", anchor: "ghost", depth: 2 }],
              },
            }
          : d,
      );
      const error = await collectManifestSite(built.outDir, tampered, { title: "t", basePath: "/" }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(SiteVerificationError);
      expect((error as SiteVerificationError).issues).toEqual([
        expect.objectContaining({
          route: "/docs/guides/deployment",
          problem: expect.stringContaining("#ghost"),
        }),
      ]);
    },
    SLOW_TIMEOUT,
  );
});
