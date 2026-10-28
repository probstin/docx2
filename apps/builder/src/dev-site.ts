/**
 * Local preview: assembles the site from a docs directory (no build) and runs `docusaurus start`
 * in it. `/api` is proxied to http://localhost:8080 (override with DOCS_PLATFORM_API_URL).
 *
 *   pnpm dev:site [path-to-docs-dir]      # default: examples/sample-docs
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCheckout } from "@docs-platform/sources";
import { prepareSite } from "./site.js";
import { ensureWorkspaceDist } from "./workspace-dist.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = path.resolve(
  process.env["INIT_CWD"] ?? process.cwd(),
  process.argv[2] ?? "examples/sample-docs",
);
const workDir = path.join(repoRoot, ".data", "dev-site");

await mkdir(workDir, { recursive: true });
const content = await readCheckout(source);
const { siteDir, templateDir } = await prepareSite({
  checkoutDir: source,
  content,
  // The API rejects this id (RELEASE_UNKNOWN); a real one needs a built and indexed release.
  releaseId: process.env["DEV_RELEASE_ID"] ?? "dev-preview",
  publicUrl: "http://localhost:3000",
  workDir,
});
await ensureWorkspaceDist(templateDir);

const bin = path.join(templateDir, "node_modules", "@docusaurus", "core", "bin", "docusaurus.mjs");
const child = spawn(process.execPath, [bin, "start", "--no-open", "--port", "3000"], {
  cwd: siteDir,
  stdio: "inherit",
  env: { ...process.env, DOCUSAURUS_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
