import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { copyFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Workspace packages the Docusaurus site bundles, in dependency order (see ADR 0006). */
const PACKAGES = [
  { name: "contracts", marker: "index.js" },
  { name: "chat-react", marker: "index.js", extra: "styles.css" },
] as const;

async function mtimeMs(p: string): Promise<number | undefined> {
  return stat(p).then(
    (s) => s.mtimeMs,
    () => undefined,
  );
}

async function newestSource(dir: string): Promise<number> {
  let newest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, await newestSource(full));
    else newest = Math.max(newest, (await stat(full)).mtimeMs);
  }
  return newest;
}

/**
 * Makes sure `dist/` of the workspace packages the template bundles (contracts, chat-react) exists
 * and is not older than their sources, building them with `tsc` otherwise. The Docusaurus build
 * consumes them from `dist` (the template aliases them there), because webpack does not resolve the
 * `development` export condition that points at TypeScript sources.
 *
 * In a production builder image `dist` is produced at image build time and no compiler is needed:
 * when `dist` exists and no `src` is shipped, nothing runs.
 */
export async function ensureWorkspaceDist(templateDir: string): Promise<void> {
  for (const pkg of PACKAGES) {
    const dir = await realpath(path.join(templateDir, "node_modules", "@docs-platform", pkg.name));
    const marker = await mtimeMs(path.join(dir, "dist", pkg.marker));
    const srcExists = await stat(path.join(dir, "src")).then(
      () => true,
      () => false,
    );
    const fresh =
      marker !== undefined &&
      (!("extra" in pkg) || (await mtimeMs(path.join(dir, "dist", pkg.extra))) !== undefined) &&
      (!srcExists || (await newestSource(path.join(dir, "src"))) <= marker);
    if (fresh) continue;
    if (!srcExists) throw new Error(`${dir}/dist is missing and there is no source to build it from`);
    const tsc = createRequire(path.join(dir, "package.json")).resolve("typescript/bin/tsc");
    await run(process.execPath, [tsc, "-p", "tsconfig.build.json"], { cwd: dir });
    if ("extra" in pkg) {
      await copyFile(path.join(dir, "src", pkg.extra), path.join(dir, "dist", pkg.extra));
    }
  }
}
