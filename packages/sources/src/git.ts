import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { GitShaSchema } from "@docs-platform/contracts";
import { GitError } from "./errors.js";

export interface GitCredentials {
  username?: string;
  token: string;
}

export interface GitRunnerOptions {
  /** Path or name of the system `git` binary. */
  gitBinary?: string;
  /** Per-command timeout. */
  timeoutMs?: number;
  /** HTTPS basic-auth credentials. Never placed in argv, URLs, or error messages. */
  credentials?: GitCredentials | undefined;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Reads `SOURCE_GIT_USERNAME` / `SOURCE_GIT_TOKEN`. */
export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): GitCredentials | undefined {
  const token = env["SOURCE_GIT_TOKEN"];
  if (!token) return undefined;
  const username = env["SOURCE_GIT_USERNAME"];
  return username ? { username, token } : { token };
}

/** Where a remote lives: a local path (dev/tests) or a URL. */
export function normalizeRemote(urlOrPath: string): { remote: string; origin: string | undefined } {
  if (urlOrPath.startsWith("-")) throw new GitError("Refusing a Git URL that starts with '-'");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrPath)) {
    let parsed: URL;
    try {
      parsed = new URL(urlOrPath);
    } catch {
      throw new GitError("Invalid Git URL");
    }
    if (parsed.password !== "") {
      throw new GitError(
        "Git URLs must not embed a password or token; use SOURCE_GIT_USERNAME / SOURCE_GIT_TOKEN instead",
      );
    }
    if (!["http:", "https:", "file:", "ssh:"].includes(parsed.protocol)) {
      throw new GitError(`Unsupported Git URL protocol ${parsed.protocol}`);
    }
    const origin =
      parsed.protocol === "http:" || parsed.protocol === "https:" ? `${parsed.origin}/` : undefined;
    return { remote: urlOrPath, origin };
  }
  // scp-like (`git@host:org/repo`) and plain paths are passed through; relative paths are made absolute.
  if (/^[\w.-]+@[\w.-]+:/.test(urlOrPath)) return { remote: urlOrPath, origin: undefined };
  return { remote: path.resolve(urlOrPath), origin: undefined };
}

/** Masks secrets and URL userinfo before text is logged or put in an error. */
export function redact(text: string, credentials?: GitCredentials): string {
  let out = text.replace(/(\/\/)[^/@\s]+@/g, "$1***@");
  if (credentials) {
    const basic = Buffer.from(`${credentials.username ?? "git"}:${credentials.token}`).toString("base64");
    for (const secret of [credentials.token, basic]) {
      if (secret) out = out.split(secret).join("***");
    }
  }
  return out;
}

export class GitRunner {
  private readonly gitBinary: string;
  private readonly timeoutMs: number;
  private readonly credentials: GitCredentials | undefined;

  constructor(options: GitRunnerOptions = {}) {
    this.gitBinary = options.gitBinary ?? "git";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.credentials = options.credentials;
  }

  /**
   * Environment for every Git call. Credentials travel as a URL-scoped `http.extraHeader` in
   * `GIT_CONFIG_*` variables: they are not in argv (visible in `ps`), not in the remote URL
   * (persisted in `.git/config`), and not echoed by Git. Interactive prompts are disabled, hooks
   * and credential helpers are off, and the `ext::` transport is forbidden.
   */
  private env(origin: string | undefined): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_")) delete env[key];
    }
    const config: Array<[string, string]> = [
      ["protocol.ext.allow", "never"],
      ["core.hooksPath", "/dev/null"],
      ["core.fsmonitor", "false"],
      ["credential.helper", ""],
      ["advice.detachedHead", "false"],
    ];
    if (this.credentials && origin) {
      const basic = Buffer.from(`${this.credentials.username ?? "git"}:${this.credentials.token}`).toString(
        "base64",
      );
      config.push([`http.${origin}.extraHeader`, `Authorization: Basic ${basic}`]);
    }
    env["GIT_CONFIG_COUNT"] = String(config.length);
    config.forEach(([key, value], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = key;
      env[`GIT_CONFIG_VALUE_${i}`] = value;
    });
    env["GIT_TERMINAL_PROMPT"] = "0";
    env["GCM_INTERACTIVE"] = "never";
    env["GIT_ASKPASS"] = "";
    env["SSH_ASKPASS"] = "";
    env["LC_ALL"] = "C";
    return env;
  }

  async run(args: string[], options: { cwd?: string; origin?: string | undefined } = {}): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      execFile(
        this.gitBinary,
        args,
        {
          cwd: options.cwd,
          env: this.env(options.origin),
          timeout: this.timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error) {
            const detail = redact((stderr || error.message).trim(), this.credentials);
            const verb = args.find((a) => !a.startsWith("-")) ?? "command";
            reject(new GitError(`git ${verb} failed: ${detail}`));
            return;
          }
          resolve(stdout);
        },
      );
    });
  }
}

/** `git ls-remote`: resolves a branch to the commit it currently points at. */
export async function resolveBranchHead(
  url: string,
  branch: string,
  options: GitRunnerOptions = {},
): Promise<string> {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new GitError(`Invalid branch name ${JSON.stringify(branch)}`);
  }
  const { remote, origin } = normalizeRemote(url);
  const runner = new GitRunner({ ...options, credentials: options.credentials ?? credentialsFromEnv() });
  const out = await runner.run(["ls-remote", "--exit-code", "--", remote, `refs/heads/${branch}`], {
    origin,
  });
  const sha = out.split(/\s+/)[0] ?? "";
  if (!GitShaSchema.safeParse(sha).success) {
    throw new GitError(`Branch ${branch} not found in remote`);
  }
  return sha;
}

/**
 * Makes `dir` a work tree of `remote` at exactly `sha` (detached) and verifies it.
 * Reuses `dir` if it already holds a repository, so repeated builds only fetch the delta.
 */
export async function checkoutExactSha(
  runner: GitRunner,
  args: { remote: string; origin: string | undefined; branch: string; sha: string; dir: string },
): Promise<void> {
  const { remote, origin, branch, sha, dir } = args;
  if (!GitShaSchema.safeParse(sha).success) {
    throw new GitError(`Revision ${JSON.stringify(sha)} is not a full commit SHA`);
  }
  await mkdir(dir, { recursive: true });
  const git = (a: string[]) => runner.run(a, { cwd: dir, origin });

  await git(["init", "--quiet"]);
  await git(["remote", "remove", "origin"]).catch(() => undefined);
  await git(["remote", "add", "origin", "--", remote]);

  let fetched = false;
  try {
    await git(["fetch", "--quiet", "--no-tags", "--depth=1", "origin", sha]);
    fetched = true;
  } catch {
    // Some servers refuse by-SHA fetches; fall back to fetching the branch the SHA was queued from.
  }
  if (!fetched) {
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
      throw new GitError(`Invalid branch name ${JSON.stringify(branch)}`);
    }
    await git([
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
  }

  try {
    await git(["cat-file", "-e", `${sha}^{commit}`]);
  } catch {
    throw new GitError(`Commit ${sha} was not found in the remote (branch ${branch})`);
  }
  await git(["checkout", "--quiet", "--detach", "--force", sha]);
  await git(["clean", "--quiet", "-ffdx"]);

  const head = (await git(["rev-parse", "HEAD"])).trim();
  if (head !== sha) {
    throw new GitError(`Checked out ${head} but expected ${sha}`);
  }
}
