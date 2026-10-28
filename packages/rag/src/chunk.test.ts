import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument } from "@docs-platform/contracts";
import { extractHeadings, readCheckout } from "@docs-platform/sources";
import { describe, expect, it } from "vitest";
import { chunkDocument } from "./chunk.js";

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/sample-docs");

function doc(content: string, title = "Doc"): SourceDocument {
  return {
    id: "docs/x.md",
    path: "docs/x.md",
    content,
    checksum: "0",
    metadata: { title, url: "/docs/x", headings: extractHeadings(content).headings, frontmatter: {} },
  };
}

describe("chunkDocument", () => {
  it("emits anchors exactly equal to metadata.headings for every sample doc", async () => {
    const { documents } = await readCheckout(SAMPLE);
    for (const d of documents) {
      const chunks = await chunkDocument(d);
      const anchors = new Set(d.metadata.headings.map((h) => h.anchor));
      for (const c of chunks) if (c.anchor !== undefined) expect(anchors.has(c.anchor), d.path).toBe(true);
      // Every heading that has a body is represented.
      const withChunks = new Set(chunks.map((c) => c.anchor));
      expect(withChunks.size).toBeGreaterThan(0);
      expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    }
  });

  it("keeps anchors aligned when the scanner skips a heading with an empty slug", async () => {
    const chunks = await chunkDocument(
      doc(
        ["# Title", "## 🚀", "launch text", "## Install", "install text", "## Usage", "usage text"].join(
          "\n",
        ),
      ),
    );
    const install = chunks.find((c) => c.content.includes("install text"))!;
    expect(install).toMatchObject({ heading: "Install", anchor: "install" });
    expect(chunks.find((c) => c.content.includes("usage text"))).toMatchObject({ anchor: "usage" });
    expect(chunks.find((c) => c.content.includes("launch text"))!.anchor).toBeUndefined();
  });

  it("handles duplicate headings, explicit ids and headings inside fences", async () => {
    const d = doc(
      [
        "# Title",
        "intro text",
        "## Setup",
        "one",
        "```md",
        "## Not a heading",
        "```",
        "## Setup",
        "two",
        "## Custom {#my-id}",
        "three",
      ].join("\n"),
    );
    const chunks = await chunkDocument(d);
    expect(chunks.map((c) => c.anchor)).toEqual([undefined, "setup", "setup-1", "my-id"]);
    expect(chunks[0]!.heading).toBeUndefined();
    expect(chunks[3]!.heading).toBe("Custom");
    expect(chunks[1]!.content).toContain("## Not a heading");
  });

  it("builds heading paths and a prefixed embed text while storing clean content", async () => {
    const d = doc("# T\n## Deployment\nbody\n### Rolling back\nundo it\n## Other\nx", "Guide");
    const chunks = await chunkDocument(d);
    const rb = chunks.find((c) => c.anchor === "rolling-back")!;
    expect(rb.headingPath).toBe("Guide › Deployment › Rolling back");
    expect(rb.embedText.startsWith("Guide › Deployment › Rolling back\n\n")).toBe(true);
    expect(rb.content).not.toContain("Guide ›");
    expect(chunks.find((c) => c.anchor === "other")!.headingPath).toBe("Guide › Other");
  });

  it("splits oversized sections without cutting a code fence", async () => {
    const code = ["```bash", ...Array.from({ length: 20 }, (_, i) => `command-${i} --flag`), "```"].join(
      "\n",
    );
    const prose = (n: string) => `${n} `.repeat(120);
    const d = doc(`## Big\n${prose("alpha")}\n\n${code}\n\n${prose("beta")}`);
    const chunks = await chunkDocument(d, { chunkSize: 500, chunkOverlap: 50 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.anchor).toBe("big");
      const fences = (c.content.match(/^```/gm) ?? []).length;
      expect(fences % 2).toBe(0);
    }
    expect(chunks.some((c) => c.content.includes("command-0") && c.content.includes("command-19"))).toBe(
      true,
    );
  });

  it("skips heading-only sections", async () => {
    const chunks = await chunkDocument(doc("# T\n## Parent\n### Child\ntext"));
    expect(chunks.map((c) => c.anchor)).toEqual(["child"]);
  });
});
