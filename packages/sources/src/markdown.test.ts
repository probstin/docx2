import { describe, expect, it } from "vitest";
import { computeDocRoute, stripNumberPrefix } from "./routing.js";
import { extractHeadings, inlineToText, parseFrontmatter, setFrontmatterField } from "./markdown.js";

const anchors = (md: string) => extractHeadings(md).headings.map((h) => h.anchor);

describe("extractHeadings", () => {
  it("slugs headings like github-slugger", () => {
    expect(anchors("## Hello World\n### What's new? (v2.0)\n#### C++ & Rust: friends!")).toEqual([
      "hello-world",
      "whats-new-v20",
      "c--rust-friends",
    ]);
  });

  it("de-duplicates per document, counting the h1 too", () => {
    const md = "# Setup\n\n## Setup\n\n## Setup\n\n### Other\n\n## Setup\n";
    expect(anchors(md)).toEqual(["setup-1", "setup-2", "other", "setup-3"]);
  });

  it("uses explicit {#custom-id} verbatim, strips it from the text and does not advance the slugger", () => {
    const { headings } = extractHeadings(
      "## Rolling back {#rollback}\n\n## Rolling back\n\n## Rolling back {#Other_ID}\n",
    );
    expect(headings).toEqual([
      { text: "Rolling back", anchor: "rollback", depth: 2 },
      { text: "Rolling back", anchor: "rolling-back", depth: 2 },
      { text: "Rolling back", anchor: "Other_ID", depth: 2 },
    ]);
  });

  it("supports the trailing HTML comment id syntax", () => {
    expect(anchors("## Title <!-- #from-comment -->\n## Other <!-- not an id -->")).toEqual([
      "from-comment",
      "other",
    ]);
  });

  it("ignores headings inside fenced code blocks, any fence length or style", () => {
    const md = [
      "## Real",
      "```bash",
      "## not a heading",
      "```",
      "~~~",
      "## nor this",
      "```",
      "~~~",
      "````md",
      "```",
      "## still code",
      "```",
      "````",
      "## After",
    ].join("\n");
    expect(anchors(md)).toEqual(["real", "after"]);
  });

  it("ignores headings in HTML comments and indented code, and requires a space after #", () => {
    const md = "<!--\n## hidden\n-->\n    ## indented code\n#hashtag\n## Visible";
    expect(anchors(md)).toEqual(["visible"]);
  });

  it("strips inline markdown before slugging", () => {
    const md = [
      "## The `atlasctl deploy` command",
      "## **Bold** and _emphasis_ and snake_case",
      "## A [link](https://example.com/x) here",
      "## Image ![alt text](a.png) inline",
      "## Escaped \\* star",
      "## Café &amp; bar",
      "## Closing hashes ##",
    ].join("\n");
    expect(anchors(md)).toEqual([
      "the-atlasctl-deploy-command",
      "bold-and-emphasis-and-snake_case",
      "a-link-here",
      "image-alt-text-inline",
      "escaped--star",
      "café--bar",
      "closing-hashes",
    ]);
  });

  it("reports depth, title and the h1", () => {
    const r = extractHeadings("# Title\n\n## A\n###### F\n");
    expect(r.h1).toBe("Title");
    expect(r.headings.map((h) => h.depth)).toEqual([2, 6]);
  });
});

describe("inlineToText", () => {
  it("drops raw html tags but keeps their text", () => {
    expect(inlineToText("Hello <b>bold</b> <br/>world")).toBe("Hello bold world");
  });
});

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter and returns the body", () => {
    const r = parseFrontmatter("---\ntitle: Hi\nsidebar_position: 2\n---\n# Body\n");
    expect(r.frontmatter).toEqual({ title: "Hi", sidebar_position: 2 });
    expect(r.body).toBe("# Body\n");
  });

  it("returns an empty mapping without frontmatter", () => {
    expect(parseFrontmatter("# Only body\n")).toEqual({ frontmatter: {}, body: "# Only body\n" });
  });

  it("refuses code engines such as ---js", () => {
    expect(() => parseFrontmatter("---js\n{ title: 'x' }\n---\nbody", "a.md")).toThrow(
      /unsupported frontmatter language/,
    );
  });

  it("refuses YAML tags/aliases explosions and names the file", () => {
    const bomb = "---\na: &a [1,2,3]\nb: &b [*a,*a,*a,*a,*a,*a]\nc: [*b,*b,*b,*b,*b,*b,*b]\n---\nbody";
    expect(() => parseFrontmatter(bomb, "bomb.md")).toThrow(/bomb\.md/);
  });

  it("does not evaluate custom tags", () => {
    expect(() => parseFrontmatter("---\nx: !!js/function 'function(){}'\n---\n", "t.md")).not.toThrow();
    expect(
      parseFrontmatter("---\nx: !!js/function 'function(){}'\n---\n", "t.md").frontmatter["x"],
    ).not.toBeTypeOf("function");
  });

  it("rejects non-mapping frontmatter", () => {
    expect(() => parseFrontmatter("---\n- a\n- b\n---\n", "list.md")).toThrow(/mapping/);
  });
});

describe("computeDocRoute", () => {
  const route = (
    relPath: string,
    frontmatter: Record<string, unknown> = {},
    basePath = "/",
    isLanding = false,
  ) => computeDocRoute({ relPath, frontmatter, basePath, isLanding }).url;

  it("maps files under /docs without an extension", () => {
    expect(route("getting-started.md")).toBe("/docs/getting-started");
    expect(route("guides/deployment.md")).toBe("/docs/guides/deployment");
  });

  it("maps index.md and README.md to the directory route", () => {
    expect(route("index.md")).toBe("/docs/");
    expect(route("guides/index.md")).toBe("/docs/guides/");
    expect(route("guides/README.md")).toBe("/docs/guides/");
    expect(route("guides/guides.md")).toBe("/docs/guides/");
  });

  it("strips number prefixes from files and directories", () => {
    expect(route("01-intro/02-setup.md")).toBe("/docs/intro/setup");
    expect(route("reference/02-limits.md")).toBe("/docs/reference/limits");
    expect(route("2021-11-release.md")).toBe("/docs/2021-11-release");
    expect(stripNumberPrefix("7.0-notes")).toBe("7.0-notes");
    expect(stripNumberPrefix("003 - myDoc")).toBe("myDoc");
  });

  it("honors frontmatter slug and id", () => {
    expect(route("guides/deploy.md", { slug: "/ship-it" })).toBe("/docs/ship-it");
    expect(route("guides/deploy.md", { slug: "ship" })).toBe("/docs/guides/ship");
    expect(route("guides/deploy.md", { slug: "/" })).toBe("/docs/");
    expect(route("guides/deploy.md", { id: "release" })).toBe("/docs/guides/release");
    expect(route("guides/index.md", { slug: "/custom" })).toBe("/docs/custom");
  });

  it("serves the landing page at /docs/ and prefixes basePath", () => {
    expect(route("intro.md", {}, "/", true)).toBe("/docs/");
    expect(route("guides/deploy.md", {}, "/team-a/")).toBe("/team-a/docs/guides/deploy");
    expect(route("index.md", {}, "/team-a/")).toBe("/team-a/docs/");
  });
});

describe("setFrontmatterField", () => {
  it("adds a frontmatter block when missing", () => {
    const out = setFrontmatterField("# Hi\n", "slug", "/");
    expect(parseFrontmatter(out)).toEqual({ frontmatter: { slug: "/" }, body: "# Hi\n" });
  });

  it("replaces or adds a key while keeping the rest", () => {
    const raw = "---\ntitle: T\nslug: /old\n---\nbody\n";
    const out = setFrontmatterField(raw, "slug", "/");
    expect(parseFrontmatter(out)).toEqual({ frontmatter: { title: "T", slug: "/" }, body: "body\n" });
  });
});
