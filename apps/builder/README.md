# @docs-platform/builder

Build Job entrypoint. This wave implements the **site build** only (checkout, validation, Docusaurus
build, manifest `site` section). Database access, indexing and Kubernetes orchestration come later.

## What it does

`buildSite()` turns a checked-out team repository (`docs.yaml` + Markdown + `assets/`) into a static
site, entirely offline:

1. `readCheckout()` (from `@docs-platform/sources`) validates `docs.yaml`, rejects `.mdx` files and
   symlinks that leave the checkout, and computes every document's URL and heading anchors.
2. The platform-owned template (`packages/docusaurus-template`) is copied to `<workDir>/site`, with a
   `node_modules` made of symlinks to the template's install.
3. Content is copied **mirroring the repository layout** (`repo/<content.root>/**.md`, `repo/assets/**`),
   so `![x](../../assets/images/x.png)` resolves exactly as authors wrote it. Markdown is never
   rewritten, except that a configured landing page which is not naturally served at `/docs/` gets
   `slug: /` added to the _copy_.
4. `platform.generated.json` (title, url, baseUrl, logo, theme, `releaseId`, assistant settings) and
   `src/css/theme.generated.css` (Infima primary shades) are written.
5. `docusaurus build --out-dir <outDir>` runs with the template's own binary through `execFile`, with a
   timeout and captured output. Telemetry and update checks are disabled; nothing needs the network.

`collectManifestSite(outDir, documents, { title, basePath })` then produces `ReleaseManifest["site"]` and
**cross-checks** that every document URL and every heading anchor computed from the source exists in the
generated HTML. A mismatch fails with a precise list, so citations can never point at a dead anchor.

## Content restrictions (enforced)

Repository content is data. `markdown.format` is `md`, so `import`, `export`, `{expressions}` and JSX are
never compiled; they render as literal text. Additionally the build **fails** (naming file and line) on
raw HTML other than comments and on `javascript:`/`data:` link or image URLs, because `format: md` would
otherwise copy a `<script>` straight into the output page. `.mdx` files fail source validation.

## CLI

From the repository root:

```bash
pnpm install
pnpm --filter @docs-platform/builder site \
  --source "$PWD/examples/sample-docs" \
  --out "$PWD/.data/sample-site"
```

`--source` is either a directory containing `docs.yaml` (used as-is) or a Git URL / repository path
(checked out at `--sha`, default: the head of `--branch`, via the system `git`). Run
`pnpm --filter @docs-platform/builder site --help` for all options. Git credentials come from
`SOURCE_GIT_USERNAME` / `SOURCE_GIT_TOKEN` and are never written to argv, URLs or logs.

## Preview the output

```bash
# any static file server works (the sample uses basePath "/")
python3 -m http.server 3000 --directory .data/sample-site
# or: npx serve .data/sample-site        (downloads `serve` once)
# or, honoring baseUrl, from a kept work dir (add `--work-dir "$PWD/.data/work"` to the build):
cd .data/work/site && node node_modules/@docusaurus/core/bin/docusaurus.mjs serve --dir ../../sample-site
```

Open <http://localhost:3000/> (redirects to `/docs/`).

## Tests

`pnpm test` includes `src/site.integration.test.ts`, which runs real Docusaurus builds (about a minute in
total). Set `SKIP_SLOW_TESTS=1` to skip it.
