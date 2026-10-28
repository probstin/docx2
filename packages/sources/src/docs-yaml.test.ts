import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDocsYaml, parseDocsYaml } from "./docs-yaml.js";
import { resolveContentPath } from "./paths.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sources-yaml-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const VALID = "schemaVersion: 1\nsite:\n  title: Hello\n";

describe("loadDocsYaml", () => {
  it("loads, validates and applies defaults", async () => {
    await writeFile(path.join(dir, "docs.yaml"), VALID);
    const cfg = await loadDocsYaml(dir);
    expect(cfg.site.title).toBe("Hello");
    expect(cfg.site.basePath).toBe("/");
    expect(cfg.content.root).toBe("docs");
    expect(cfg.theme.primaryColor).toBe("#2563eb");
  });

  it("names the file when it is missing", async () => {
    await expect(loadDocsYaml(dir)).rejects.toThrow(/docs\.yaml.*does not exist/);
  });

  it("reports YAML syntax errors with the file name", async () => {
    await writeFile(path.join(dir, "docs.yaml"), "schemaVersion: 1\nsite: [unclosed\n");
    await expect(loadDocsYaml(dir)).rejects.toThrow(/^.*docs\.yaml: invalid YAML/);
  });

  it("reports every schema problem with its path", async () => {
    await writeFile(
      path.join(dir, "docs.yaml"),
      "schemaVersion: 1\nsite:\n  title: ''\n  basePath: nope\nplugins: [evil]\ntheme:\n  primaryColor: red\n",
    );
    const error = await loadDocsYaml(dir).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("docs.yaml is invalid");
    expect(message).toContain("site.title");
    expect(message).toContain("site.basePath");
    expect(message).toContain("theme.primaryColor");
    expect(message).toMatch(/plugins|Unrecognized key/);
  });

  it("rejects an empty file", () => {
    expect(() => parseDocsYaml("")).toThrow(/empty/);
  });

  it("rejects alias expansion beyond the low limit", () => {
    const text = `${VALID}x: &a [1]\ny: [${Array.from({ length: 10 }, () => "*a").join(",")}]\n`;
    expect(() => parseDocsYaml(text)).toThrow(/docs\.yaml: invalid YAML/);
  });

  it("rejects duplicate keys and unsupported tags are not executed", () => {
    expect(() => parseDocsYaml("schemaVersion: 1\nschemaVersion: 1\nsite:\n  title: x\n")).toThrow(
      /docs\.yaml/,
    );
  });

  it("refuses a docs.yaml symlink that leaves the checkout", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "sources-outside-"));
    try {
      await writeFile(path.join(outside, "docs.yaml"), VALID);
      await symlink(path.join(outside, "docs.yaml"), path.join(dir, "docs.yaml"));
      await expect(loadDocsYaml(dir)).rejects.toThrow(/docs\.yaml.*outside the checkout/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("resolveContentPath", () => {
  it("resolves normal paths and normalizes dot segments", async () => {
    await writeFile(path.join(dir, "a.md"), "x");
    const real = await resolveContentPath(dir, "./a.md");
    expect(path.basename(real)).toBe("a.md");
  });

  it("rejects traversal, absolute paths and missing files", async () => {
    await expect(resolveContentPath(dir, "../etc/passwd")).rejects.toThrow(/Unsafe path/);
    await expect(resolveContentPath(dir, "a/../../x")).rejects.toThrow();
    await expect(resolveContentPath(dir, "/etc/passwd")).rejects.toThrow(/Unsafe path/);
    await expect(resolveContentPath(dir, "missing.md")).rejects.toThrow(/does not exist/);
  });

  it("rejects symlinks resolving outside the checkout but allows ones inside", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "sources-outside-"));
    try {
      await writeFile(path.join(outside, "secret.txt"), "s");
      await writeFile(path.join(dir, "real.md"), "r");
      await symlink(outside, path.join(dir, "linkdir"));
      await symlink(path.join(outside, "secret.txt"), path.join(dir, "link.md"));
      await symlink("real.md", path.join(dir, "inside.md"));
      await expect(resolveContentPath(dir, "link.md")).rejects.toThrow(/symlink escape/);
      await expect(resolveContentPath(dir, "linkdir/secret.txt")).rejects.toThrow(/symlink escape/);
      await expect(resolveContentPath(dir, "inside.md")).resolves.toMatch(/real\.md$/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
