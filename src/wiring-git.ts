// Git access for the wiring map. Two bare partial clones per repository,
// cached under one folder:
//   tip/<owner>/<repo>    depth 1, no blobs: the file list and file contents
//                         (blobs are fetched when read).
//   graph/<owner>/<repo>  full history, no trees: commit counts and
//                         ancestry. Other repositories' branches are fetched
//                         into it the same way to compare with upstreams.
// Repositories that cannot be cloned (private, gone) raise an error; the
// caller marks what depends on them unknown.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** The partial clone filter of the graph clones: commits only. */
const NO_TREES = "tree:0";

/** The partial clone filter of the tip clones: trees, no blobs. */
const NO_BLOBS = "blob:none";

/** Runs git and returns its trimmed output. */
function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/** The clone URL of `owner/repo` on GitHub. */
export function cloneUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

/** Cached clones of GitHub repositories, read through git. */
export class Clones {
  private readonly root: string;
  private readonly failed = new Map<string, string>();

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  /** The commit `ref` (a branch, or HEAD) points to on GitHub, or undefined. */
  head(repo: string, ref = "HEAD"): string | undefined {
    const name = ref === "HEAD" ? "HEAD" : `refs/heads/${ref}`;
    try {
      return git(["ls-remote", cloneUrl(repo), name]).split(/\s/)[0] || undefined;
    } catch {
      return undefined;
    }
  }

  /** Why `repo` could not be cloned, if it could not. */
  failure(repo: string): string | undefined {
    return this.failed.get(repo);
  }

  /** A bare partial clone of `repo` at `dir`, made once. */
  private clone(dir: string, repo: string, extra: string[]): string {
    const path = join(this.root, dir, repo);
    if (existsSync(path)) {
      return path;
    }
    const known = this.failed.get(repo);
    if (known !== undefined) {
      throw new Error(known);
    }
    try {
      git(["clone", "--quiet", "--bare", ...extra, cloneUrl(repo), path]);
    } catch (error) {
      const message = `cannot clone ${repo}: ${String((error as { stderr?: string }).stderr ?? error).split("\n")[0]}`;
      this.failed.set(repo, message);
      throw new Error(message);
    }
    return path;
  }

  /** The latest commit of `repo`'s default branch, from its tip clone. */
  tipCommit(repo: string): string {
    return git(["rev-parse", "--verify", "HEAD"], this.clone("tip", repo, ["--depth", "1", `--filter=${NO_BLOBS}`]));
  }

  /** Every file path at the tip of `repo`'s default branch. */
  files(repo: string): string[] {
    const path = this.clone("tip", repo, ["--depth", "1", `--filter=${NO_BLOBS}`]);
    return git(["ls-tree", "-r", "--name-only", "HEAD"], path).split("\n").filter(Boolean);
  }

  /** A file at the tip of `repo`'s default branch, or undefined. */
  read(repo: string, file: string): string | undefined {
    const path = this.clone("tip", repo, ["--depth", "1", `--filter=${NO_BLOBS}`]);
    try {
      return execFileSync("git", ["show", `HEAD:${file}`], { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
    } catch {
      return undefined;
    }
  }

  /** The tree entry of `file` at the tip: its mode and object, or undefined. */
  entry(repo: string, file: string): { mode: string; object: string } | undefined {
    const path = this.clone("tip", repo, ["--depth", "1", `--filter=${NO_BLOBS}`]);
    const line = git(["ls-tree", "HEAD", "--", file], path);
    const match = /^(\d+) \w+ ([0-9a-f]+)\t/.exec(line);
    return match ? { mode: match[1], object: match[2] } : undefined;
  }

  /** The graph clone of `repo`: full history, no trees. */
  private graph(repo: string): string {
    return this.clone("graph", repo, [`--filter=${NO_TREES}`]);
  }

  /**
   * Fetches `branch` of `source` into `repo`'s graph clone, as
   * refs/wiring/<source>/<branch>, and returns that ref. The source is a
   * promisor remote, so its files can be read lazily too.
   */
  fetch(repo: string, source: string, branch: string): string {
    const path = this.graph(repo);
    const remote = source.replace(/[^\w-]/g, "_");
    const ref = `refs/wiring/${source}/${branch}`;
    try {
      git(["config", `remote.${remote}.url`, cloneUrl(source)], path);
      git(["config", `remote.${remote}.promisor`, "true"], path);
      git(["config", `remote.${remote}.partialclonefilter`, NO_TREES], path);
      git(["fetch", "--quiet", `--filter=${NO_TREES}`, remote, `+refs/heads/${branch}:${ref}`], path);
    } catch (error) {
      throw new Error(`cannot fetch ${source} ${branch}: ${String((error as { stderr?: string }).stderr ?? error).split("\n")[0]}`);
    }
    return ref;
  }

  /** The commit `ref` names in `repo`'s graph clone. */
  resolve(repo: string, ref: string): string {
    return git(["rev-parse", ref], this.graph(repo));
  }

  /** Commits reachable from `to` and not from `from`, or undefined when either is missing. */
  count(repo: string, from: string, to: string): number | undefined {
    try {
      return Number(git(["rev-list", "--count", `${from}..${to}`], this.graph(repo)));
    } catch {
      return undefined;
    }
  }

  /** Whether `commit` is an ancestor of `ref` (or equal), or undefined when unknown. */
  contains(repo: string, commit: string, ref: string): boolean | undefined {
    try {
      git(["merge-base", "--is-ancestor", commit, ref], this.graph(repo));
      return true;
    } catch (error) {
      return (error as { status?: number }).status === 1 ? false : undefined;
    }
  }

  /** The newest common ancestor of two refs, or undefined. */
  mergeBase(repo: string, a: string, b: string): string | undefined {
    try {
      return git(["merge-base", a, b], this.graph(repo));
    } catch {
      return undefined;
    }
  }

  /** A file at `ref` in `repo`'s graph clone (fetched lazily), or undefined. */
  readAt(repo: string, ref: string, file: string): string | undefined {
    try {
      return execFileSync("git", ["show", `${ref}:${file}`], { cwd: this.graph(repo), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return undefined;
    }
  }

  /** The commit a submodule at `file` points to at `ref` in the graph clone. */
  gitlinkAt(repo: string, ref: string, file: string): string | undefined {
    try {
      const line = git(["ls-tree", ref, "--", file], this.graph(repo));
      return /^160000 commit ([0-9a-f]+)\t/.exec(line)?.[1];
    } catch {
      return undefined;
    }
  }
}
