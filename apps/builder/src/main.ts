import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ReleaseIdSchema, createReleaseId } from "@docs-platform/contracts";
import { GitMarkdownSourceAdapter, readCheckout, type CheckoutContent } from "@docs-platform/sources";
import { runIndex } from "./index-cli.js";
import { collectManifestSite } from "./manifest-site.js";
import { buildSite } from "./site.js";

const USAGE = `Usage:
  builder site --source <dir-or-git-url> --out <dir> [options]
  builder index --source <dir> --release-id <id> [--activate]   (see "builder index --help")

Builds the static documentation site for a docs repository (offline).

Options:
  --source <x>        A directory containing docs.yaml (used as-is), or a Git URL / path of a
                      Git repository (checked out at --sha with the system git).
  --sha <sha>         Full commit SHA to build. For Git sources it defaults to the head of
                      --branch. For plain directories it is only used to name the release.
  --branch <name>     Branch for Git sources (default: main).
  --release-id <id>   Release id to bake into the site (default: derived from the SHA and now).
  --out <dir>         Output directory for the static site (replaced if present).
  --public-url <url>  Origin the site will be served from (default: http://localhost:3000).
  --work-dir <dir>    Scratch directory (default: a fresh temp directory, removed afterwards).
  --manifest <file>   Also write the manifest "site" section as JSON to this file.
  --help              Show this help.

Git credentials, if needed, come from SOURCE_GIT_USERNAME / SOURCE_GIT_TOKEN.`;

function isGitLocation(source: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(source) || /^[\w.-]+@[\w.-]+:/.test(source);
}

async function runSite(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string" },
      sha: { type: "string" },
      "release-id": { type: "string" },
      branch: { type: "string", default: "main" },
      out: { type: "string" },
      "public-url": { type: "string", default: "http://localhost:3000" },
      "work-dir": { type: "string" },
      manifest: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (!values.source || !values.out) {
    console.error(`--source and --out are required.\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const ownWorkDir = values["work-dir"] === undefined;
  const workDir = values["work-dir"]
    ? path.resolve(values["work-dir"])
    : await mkdtemp(path.join(tmpdir(), "docs-platform-builder-"));
  const outDir = path.resolve(values.out);

  try {
    let checkoutDir: string;
    let revision: string;
    let content: Pick<CheckoutContent, "docsYaml" | "documents" | "assetFiles">;

    const plainDir =
      !isGitLocation(values.source) &&
      existsSync(values.source) &&
      statSync(values.source).isDirectory() &&
      !existsSync(path.join(values.source, ".git"));

    if (plainDir) {
      checkoutDir = path.resolve(values.source);
      revision = values.sha ?? "0".repeat(40);
      console.log(`Using directory ${checkoutDir} as the checkout`);
      content = await readCheckout(checkoutDir);
    } else {
      const adapter = new GitMarkdownSourceAdapter({ workDir });
      const sha = values.sha ?? (await adapter.resolveBranchHead(values.source, values.branch));
      console.log(`Checking out ${sha}`);
      const snapshot = await adapter.fetch({
        type: "git",
        url: values.source,
        branch: values.branch,
        revision: sha,
      });
      checkoutDir = snapshot.checkoutDir;
      revision = snapshot.revision;
      content = {
        docsYaml: snapshot.docsYaml,
        documents: snapshot.documentList,
        assetFiles: snapshot.assetFiles,
      };
    }

    const { docsYaml } = content;
    const releaseId = values["release-id"]
      ? ReleaseIdSchema.parse(values["release-id"])
      : createReleaseId(revision);
    console.log(`Building "${docsYaml.site.title}" as release ${releaseId} (this takes a minute)...`);
    const built = await buildSite({
      checkoutDir,
      content,
      releaseId,
      publicUrl: values["public-url"],
      workDir,
      outDir,
    });
    const site = await collectManifestSite(built.outDir, built.documents, {
      title: docsYaml.site.title,
      basePath: docsYaml.site.basePath,
    });
    if (values.manifest) await writeFile(path.resolve(values.manifest), `${JSON.stringify(site, null, 2)}\n`);

    console.log(
      `Built ${site.pages.length} documents (${site.fileCount} files, ${site.hashedAssets.length} hashed assets) ` +
        `in ${(built.durationMs / 1000).toFixed(1)}s -> ${outDir}`,
    );
    console.log("All document URLs and heading anchors verified in the generated HTML.");
  } finally {
    if (ownWorkDir) await rm(workDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "site") {
    await runSite(rest);
  } else if (command === "index") {
    await runIndex(rest);
  } else {
    console.log(USAGE);
    process.exitCode = command === undefined || command === "--help" ? 0 : 2;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
