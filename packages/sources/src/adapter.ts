import path from "node:path";
import type {
  DocsYaml,
  SourceAdapter,
  SourceDocument,
  SourceReference,
  SourceSnapshot,
} from "@docs-platform/contracts";
import { readCheckout } from "./checkout.js";
import {
  GitRunner,
  checkoutExactSha,
  credentialsFromEnv,
  normalizeRemote,
  resolveBranchHead,
  type GitCredentials,
} from "./git.js";

export interface GitMarkdownSourceAdapterOptions {
  /** Directory the repository is checked out under (`<workDir>/checkout`). Reused between runs. */
  workDir: string;
  /** Defaults to `SOURCE_GIT_USERNAME` / `SOURCE_GIT_TOKEN` from the environment. */
  credentials?: GitCredentials | undefined;
  gitBinary?: string;
  timeoutMs?: number;
}

/** What `fetch` returns: the contract's `SourceSnapshot` plus what the site builder needs. */
export interface GitMarkdownSnapshot extends SourceSnapshot {
  checkoutDir: string;
  docsYaml: DocsYaml;
  /** Eagerly parsed documents (same items `documents` yields). */
  documentList: SourceDocument[];
  /** Non-Markdown files under the content root (repo-relative). */
  assetFiles: string[];
  /** Drafts skipped on purpose (repo-relative). */
  skipped: string[];
}

/**
 * Source adapter for a Git repository containing Markdown and `docs.yaml`.
 *
 * `fetch` checks out the exact `reference.revision` with the system `git` binary and verifies
 * `HEAD`, then validates and parses the content. It throws `SourceValidationError` listing every
 * problem if the content contains anything the platform refuses to build (MDX, escaping
 * symlinks, ...), so a snapshot that is returned is always safe to hand to the site builder.
 */
export class GitMarkdownSourceAdapter implements SourceAdapter {
  private readonly options: GitMarkdownSourceAdapterOptions;

  constructor(options: GitMarkdownSourceAdapterOptions) {
    this.options = options;
  }

  private credentials(): GitCredentials | undefined {
    return this.options.credentials ?? credentialsFromEnv();
  }

  async fetch(reference: SourceReference): Promise<GitMarkdownSnapshot> {
    const { remote, origin } = normalizeRemote(reference.url);
    const runner = new GitRunner({
      credentials: this.credentials(),
      ...(this.options.gitBinary !== undefined && { gitBinary: this.options.gitBinary }),
      ...(this.options.timeoutMs !== undefined && { timeoutMs: this.options.timeoutMs }),
    });
    const checkoutDir = path.resolve(this.options.workDir, "checkout");
    await checkoutExactSha(runner, {
      remote,
      origin,
      branch: reference.branch,
      sha: reference.revision,
      dir: checkoutDir,
    });

    const content = await readCheckout(checkoutDir);
    return {
      revision: reference.revision,
      documents: toAsyncIterable(content.documents),
      checkoutDir,
      docsYaml: content.docsYaml,
      documentList: content.documents,
      assetFiles: content.assetFiles,
      skipped: content.skipped,
    };
  }

  /** Current commit of `branch` on the remote, via `git ls-remote`. */
  async resolveBranchHead(url: string, branch: string): Promise<string> {
    return await resolveBranchHead(url, branch, {
      credentials: this.credentials(),
      ...(this.options.gitBinary !== undefined && { gitBinary: this.options.gitBinary }),
      ...(this.options.timeoutMs !== undefined && { timeoutMs: this.options.timeoutMs }),
    });
  }
}

async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}
