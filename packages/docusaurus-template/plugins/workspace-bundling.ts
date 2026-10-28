/**
 * Makes the Docusaurus (webpack) build consume workspace packages from their built `dist/`.
 *
 * Why: the workspace packages' `exports` list a `development` condition that points at TypeScript
 * sources (for tsc, tsx and vitest). webpack adds that same condition in development mode
 * (`docusaurus start`), so it would pick the sources, whose `./x.js` imports of `./x.ts` files it
 * cannot resolve. Pinning exact aliases to `dist/` gives identical behaviour for `build` and `start`.
 * `apps/builder` guarantees `dist/` exists and is fresh before building. See ADR 0006.
 *
 * Also, in `docusaurus start` only, proxies `/api` to a locally running API.
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "@docusaurus/types";

const PACKAGES = ["contracts", "chat-react"] as const;

function packageDir(name: string): string {
  // Through node_modules so it also works from the builder's work copy (symlinked node_modules).
  return fs.realpathSync(path.join(__dirname, "..", "node_modules", "@docs-platform", name));
}

export default function workspaceBundling(): Plugin {
  return {
    name: "docs-platform-workspace-bundling",
    configureWebpack(_config, _isServer) {
      const alias: Record<string, string> = {};
      for (const name of PACKAGES) {
        const dist = path.join(packageDir(name), "dist");
        alias[`@docs-platform/${name}$`] = path.join(dist, "index.js");
      }
      // chat-react's dist would otherwise resolve React from its own node_modules (its dev
      // dependency), bundling a second React and breaking hooks. Pin to the site's copy.
      for (const name of ["react", "react-dom"]) {
        alias[name] = path.dirname(
          require.resolve(`${name}/package.json`, { paths: [path.join(__dirname, "..")] }),
        );
      }
      alias["@docs-platform/chat-react/styles.css"] = path.join(
        packageDir("chat-react"),
        "dist",
        "styles.css",
      );

      const result: Record<string, unknown> = { resolve: { alias } };
      if (process.env["NODE_ENV"] !== "production") {
        // Only `docusaurus start` uses devServer; `build` ignores it.
        result["devServer"] = {
          proxy: [
            { context: ["/api"], target: process.env["DOCS_PLATFORM_API_URL"] ?? "http://localhost:8080" },
          ],
        };
      }
      return result;
    },
  };
}
