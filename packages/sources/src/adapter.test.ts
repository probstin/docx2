import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitMarkdownSourceAdapter } from "./adapter.js";
import { SourceValidationError } from "./errors.js";
import { redact } from "./git.js";

const DOCS_YAML = `schemaVersion: 1
site:
  title: Test Docs
  basePath: /team/
content:
  exclude:
    - "**/_drafts/**"
    - "private/*.md"
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

async function put(root: string, rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content);
}

let tmp: string;
let repo: string;
let work: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "sources-git-"));
  repo = path.join(tmp, "repo");
  work = path.join(tmp, "work");
  await mkdir(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function seed(): Promise<string> {
  await put(repo, "docs.yaml", DOCS_YAML);
  await put(repo, "docs/index.md", "---\ntitle: Home\n---\n# Home\n\n## Intro\n");
  await put(
    repo,
    "docs/guides/01-deploy.md",
    "# Deploy\n\n## Rolling back {#rollback}\n\n## Intro\n\n## Intro\n",
  );
  await put(repo, "docs/guides/notes.md", "No title or headings here.\n");
  await put(repo, "docs/_drafts/secret.md", "# Secret\n");
  await put(repo, "docs/private/hidden.md", "# Hidden\n");
  await put(repo, "docs/img/pic.png", "not really a png");
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "seed");
  return git(repo, "rev-parse", "HEAD");
}

const ref = (sha: string) => ({ type: "git" as const, url: repo, branch: "main", revision: sha });

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of it) out.push(item);
  return out;
}

describe("GitMarkdownSourceAdapter", () => {
  it("checks out the exact SHA, not the branch head", async () => {
    const first = await seed();
    await put(repo, "docs/later.md", "# Later\n");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "later");
    const head = git(repo, "rev-parse", "HEAD");
    expect(head).not.toBe(first);

    const adapter = new GitMarkdownSourceAdapter({ workDir: work });
    const snap = await adapter.fetch(ref(first));
    expect(snap.revision).toBe(first);
    expect(git(snap.checkoutDir, "rev-parse", "HEAD")).toBe(first);
    const docs = await collect(snap.documents);
    expect(docs.map((d) => d.path)).not.toContain("docs/later.md");

    // Re-using the work dir moves it forward to another exact SHA.
    const snap2 = await adapter.fetch(ref(head));
    expect(git(snap2.checkoutDir, "rev-parse", "HEAD")).toBe(head);
    expect((await collect(snap2.documents)).map((d) => d.path)).toContain("docs/later.md");
  });

  it("fails for an unknown SHA and for abbreviated SHAs", async () => {
    const sha = await seed();
    const adapter = new GitMarkdownSourceAdapter({ workDir: work });
    await expect(adapter.fetch(ref("0123456789012345678901234567890123456789"))).rejects.toThrow(
      /not found|failed/i,
    );
    await expect(adapter.fetch(ref(sha.slice(0, 10)))).rejects.toThrow(/full commit SHA/);
  });

  it("yields documents with titles, anchors, urls and checksums, honoring excludes", async () => {
    const sha = await seed();
    const snap = await new GitMarkdownSourceAdapter({ workDir: work }).fetch(ref(sha));
    const docs = await collect(snap.documents);
    expect(docs.map((d) => d.path)).toEqual([
      "docs/guides/01-deploy.md",
      "docs/guides/notes.md",
      "docs/index.md",
    ]);

    const deploy = docs.find((d) => d.path.endsWith("01-deploy.md"))!;
    expect(deploy.metadata.url).toBe("/team/docs/guides/deploy");
    expect(deploy.metadata.title).toBe("Deploy");
    expect(deploy.metadata.headings.map((h) => h.anchor)).toEqual(["rollback", "intro", "intro-1"]);
    expect(deploy.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(deploy.id).toBe(deploy.path);

    const notes = docs.find((d) => d.path.endsWith("notes.md"))!;
    expect(notes.metadata.title).toBe("notes");

    const home = docs.find((d) => d.path.endsWith("index.md"))!;
    expect(home.metadata.url).toBe("/team/docs/");
    expect(home.metadata.title).toBe("Home");
    expect(home.content.startsWith("# Home")).toBe(true);

    expect(snap.assetFiles).toEqual(["docs/img/pic.png"]);
  });

  it("rejects .mdx files and symlinks escaping the checkout, listing every problem", async () => {
    await seed();
    const outside = path.join(tmp, "outside.md");
    await writeFile(outside, "# stolen\n");
    await put(repo, "docs/page.mdx", "import X from './x'\n\n<X />\n");
    await symlink(outside, path.join(repo, "docs", "leak.md"));
    await symlink(tmp, path.join(repo, "docs", "dirlink"));
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "bad");
    const sha = git(repo, "rev-parse", "HEAD");

    const error = await new GitMarkdownSourceAdapter({ workDir: work })
      .fetch(ref(sha))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceValidationError);
    const issues = (error as SourceValidationError).issues;
    expect(issues.map((i) => i.path).sort()).toEqual(["docs/dirlink", "docs/leak.md", "docs/page.mdx"]);
    expect(issues.find((i) => i.path === "docs/page.mdx")?.message).toMatch(/MDX is not supported/);
    expect(issues.find((i) => i.path === "docs/leak.md")?.message).toMatch(/symlinks are not allowed/);
  });

  it("rejects symlinks even when they stay inside the checkout, or sit in excluded paths", async () => {
    await seed();
    await symlink("../index.md", path.join(repo, "docs", "guides", "alias.md"));
    await mkdir(path.join(repo, "docs", "_hidden"), { recursive: true });
    await symlink("../index.md", path.join(repo, "docs", "_hidden", "x.md"));
    await symlink("../index.md", path.join(repo, "docs", "img", "pic-link.png"));
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "alias");
    const sha = git(repo, "rev-parse", "HEAD");
    const error = await new GitMarkdownSourceAdapter({ workDir: work })
      .fetch(ref(sha))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SourceValidationError);
    expect((error as SourceValidationError).issues.map((i) => i.path).sort()).toEqual([
      "docs/_hidden/x.md",
      "docs/guides/alias.md",
      "docs/img/pic-link.png",
    ]);
  });

  it("ignores .mdx files that are excluded", async () => {
    await seed();
    await put(repo, "docs/_drafts/wip.mdx", "<Boom />");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "draft mdx");
    const sha = git(repo, "rev-parse", "HEAD");
    await expect(new GitMarkdownSourceAdapter({ workDir: work }).fetch(ref(sha))).resolves.toBeDefined();
  });

  it("fails clearly when the landing page is missing and when two docs share a route", async () => {
    await seed();
    await put(repo, "docs/guides/dup.md", "---\nslug: /guides/deploy\n---\n# Dup\n");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "dup");
    const sha = git(repo, "rev-parse", "HEAD");
    await expect(new GitMarkdownSourceAdapter({ workDir: work }).fetch(ref(sha))).rejects.toThrow(
      /share the route/,
    );

    git(repo, "rm", "--quiet", "docs/index.md");
    git(repo, "rm", "--quiet", "docs/guides/dup.md");
    git(repo, "commit", "--quiet", "-m", "no landing");
    const sha2 = git(repo, "rev-parse", "HEAD");
    await expect(new GitMarkdownSourceAdapter({ workDir: work }).fetch(ref(sha2))).rejects.toThrow(
      /landingPage/,
    );
  });

  it("reports docs.yaml errors naming the file", async () => {
    await put(repo, "docs.yaml", "schemaVersion: 2\n");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "bad yaml");
    const sha = git(repo, "rev-parse", "HEAD");
    await expect(new GitMarkdownSourceAdapter({ workDir: work }).fetch(ref(sha))).rejects.toThrow(
      /docs\.yaml is invalid/,
    );
  });

  it("supports file:// URLs", async () => {
    const sha = await seed();
    const snap = await new GitMarkdownSourceAdapter({ workDir: work }).fetch({
      ...ref(sha),
      url: `file://${repo}`,
    });
    expect(git(snap.checkoutDir, "rev-parse", "HEAD")).toBe(sha);
  });

  it("resolves a branch head with ls-remote", async () => {
    const sha = await seed();
    const adapter = new GitMarkdownSourceAdapter({ workDir: work });
    await expect(adapter.resolveBranchHead(repo, "main")).resolves.toBe(sha);
    await expect(adapter.resolveBranchHead(repo, "nope")).rejects.toThrow();
    await expect(adapter.resolveBranchHead(repo, "--upload-pack=evil")).rejects.toThrow(/Invalid branch/);
  });

  it("refuses URLs with embedded passwords or leading dashes", async () => {
    const adapter = new GitMarkdownSourceAdapter({ workDir: work });
    const sha = "a".repeat(40);
    await expect(
      adapter.fetch({ ...ref(sha), url: "https://user:secret@example.com/x.git" }),
    ).rejects.toThrow(/must not embed/);
    await expect(adapter.fetch({ ...ref(sha), url: "--upload-pack=touch /tmp/pwned" })).rejects.toThrow(
      /starts with/,
    );
  });
});

describe("redact", () => {
  it("masks URL userinfo and credentials", () => {
    const creds = { username: "bot", token: "s3cr3t-token" };
    const header = Buffer.from("bot:s3cr3t-token").toString("base64");
    const text = `fatal: https://bot:s3cr3t-token@host/x failed; Authorization: Basic ${header}; s3cr3t-token`;
    const out = redact(text, creds);
    expect(out).not.toContain("s3cr3t-token");
    expect(out).not.toContain(header);
  });
});
