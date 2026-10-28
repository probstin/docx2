import { cp, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCheckout } from "@docs-platform/sources";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SiteBuildError, buildSite } from "./site.js";

const SAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/sample-docs");

let tmp: string;
let checkout: string;
beforeAll(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "builder-safety-"));
  checkout = path.join(tmp, "checkout");
  await cp(SAMPLE, checkout, { recursive: true });
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

async function attempt(outDir: string, workDir: string, checkoutDir = checkout) {
  return await buildSite({
    checkoutDir,
    content: await readCheckout(checkoutDir),
    releaseId: "20260101000000-abcdef123456",
    publicUrl: "https://docs.example.com",
    workDir,
    outDir,
  }).catch((e: unknown) => e);
}

describe("buildSite outDir safety", () => {
  it("refuses an outDir that equals, contains or is inside the checkout or workDir", async () => {
    const work = path.join(tmp, "work-a");
    await mkdir(work, { recursive: true });
    const marker = path.join(checkout, "docs", "index.md");
    for (const outDir of [
      checkout,
      path.join(checkout, "docs"),
      tmp, // contains the checkout and the work dir
      path.dirname(tmp),
      work,
      path.join(work, "nested"),
    ]) {
      const error = await attempt(outDir, work);
      expect(error, outDir).toBeInstanceOf(SiteBuildError);
      expect((error as Error).message, outDir).toMatch(/outDir/);
    }
    expect(await exists(marker)).toBe(true);
    expect(await exists(work)).toBe(true);
  });

  it("refuses the filesystem root and the home directory", async () => {
    const work = path.join(tmp, "work-b");
    for (const outDir of [path.parse(tmp).root, homedir()]) {
      const error = await attempt(outDir, work);
      expect(error, outDir).toBeInstanceOf(SiteBuildError);
      expect((error as Error).message, outDir).toMatch(/root|home/);
    }
  });

  it("compares realpaths: a symlink to the checkout is refused", async () => {
    const work = path.join(tmp, "work-c");
    const alias = path.join(tmp, "alias-to-checkout");
    await symlink(checkout, alias);
    const error = await attempt(alias, work);
    expect(error).toBeInstanceOf(SiteBuildError);
    expect(await exists(path.join(checkout, "docs", "index.md"))).toBe(true);
  });
});

describe("buildSite assets", () => {
  it("rejects symlinks in assets/ without copying them", async () => {
    const dir = path.join(tmp, "checkout-links");
    await cp(SAMPLE, dir, { recursive: true });
    const secret = path.join(tmp, "secret.txt");
    await writeFile(secret, "top secret");
    await symlink(secret, path.join(dir, "assets", "leak.txt"));
    await symlink("logo.svg", path.join(dir, "assets", "logo-alias.svg"));
    const work = path.join(tmp, "work-d");
    const error = await attempt(path.join(tmp, "out-d"), work, dir);
    expect(error).toBeInstanceOf(SiteBuildError);
    expect((error as Error).message).toContain("assets/leak.txt");
    expect((error as Error).message).toContain("assets/logo-alias.svg");
    expect(await exists(path.join(work, "site", "repo", "assets", "leak.txt"))).toBe(false);
  });
});
