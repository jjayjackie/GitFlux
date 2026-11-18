// Throwaway repositories for the integration tests, under the system's temporary folder (real paths, so that macOS's
// /var → /private/var and Windows' short names never make two names for one folder), removed when the test ends.
// Everything goes through `git` with an argv array; nothing assumes a POSIX shell, `/dev/null` or "\n" line ends.

import "./env.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { TestContext } from "node:test";

/** A new empty folder, removed (with retries for Windows' file locks) when the test ends. */
export function tempDir(t: TestContext, prefix = "gitflux-"): string {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return directory;
}

/** Runs git in `cwd` and returns its output, trimmed; throws on failure. `env` adds variables for this run. */
export function gitIn(cwd: string, args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } }).trim();
}

/** Runs git in `cwd` and returns whether it succeeded, for commands expected to fail (a merge that conflicts). */
export function gitTry(cwd: string, args: readonly string[]): boolean {
  return spawnSync("git", [...args], { cwd, stdio: "ignore", env: process.env }).status === 0;
}

export interface Repo {
  /** The repository's root: the `cwd` of every call. */
  cwd: string;
  git(...args: string[]): string;
  /** Whether `git <args>` succeeded. */
  tryGit(...args: string[]): boolean;
  /** Writes a file (folders made as needed), path relative to the root with `/`. */
  write(path: string, text: string | Buffer): void;
  read(path: string): string;
  path(relative: string): string;
  /** Stages everything and commits it, at `time` (seconds) when given; returns the new commit's hash. */
  commit(message: string, options?: { time?: number; all?: boolean }): string;
  head(): string;
}

/** Fixed author and committer dates: `@<seconds> +0000`. */
export function dates(time: number): Record<string, string> {
  return { GIT_AUTHOR_DATE: `@${time} +0000`, GIT_COMMITTER_DATE: `@${time} +0000` };
}

export function repoAt(cwd: string): Repo {
  const path = (relative: string) => join(cwd, ...relative.split("/"));
  const repo: Repo = {
    cwd,
    git: (...args) => gitIn(cwd, args),
    tryGit: (...args) => gitTry(cwd, args),
    write(relative, text) {
      const file = path(relative);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    read: (relative) => readFileSync(path(relative), "utf8"),
    path,
    commit(message, options = {}) {
      if (options.all !== false) gitIn(cwd, ["add", "--all"]);
      gitIn(cwd, ["commit", "--quiet", "--allow-empty", `--message=${message}`], options.time === undefined ? {} : dates(options.time));
      return gitIn(cwd, ["rev-parse", "HEAD"]);
    },
    head: () => gitIn(cwd, ["rev-parse", "HEAD"]),
  };
  return repo;
}

/** A new repository on `main`, with no commit. */
export function repository(t: TestContext, prefix = "gitflux-"): Repo {
  const cwd = tempDir(t, prefix);
  gitIn(cwd, ["init", "--quiet", "--initial-branch=main"]);
  return repoAt(cwd);
}

/** A new bare repository on `main`, to push to and fetch from; returns its folder. */
export function bareRemote(t: TestContext): string {
  const cwd = tempDir(t, "gitflux-remote-");
  gitIn(cwd, ["init", "--quiet", "--bare", "--initial-branch=main"]);
  return cwd;
}

/** A `file://` URL for a local folder (forward slashes, drive letter and all on Windows). */
export function fileUrl(folder: string): string {
  return pathToFileURL(folder).href;
}

/** A clone of `remote` (a folder or URL) in a new folder. */
export function clone(t: TestContext, remote: string): Repo {
  const parent = tempDir(t, "gitflux-clone-");
  const cwd = join(parent, "clone");
  gitIn(parent, ["clone", "--quiet", remote, cwd]);
  return repoAt(realpathSync.native(cwd));
}

/** A repository with one commit holding `a.txt`, pushed to a new bare remote it follows as origin/main. */
export function published(t: TestContext): { repo: Repo; remote: string } {
  const remote = bareRemote(t);
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.commit("root");
  repo.git("remote", "add", "origin", fileUrl(remote));
  repo.git("push", "--quiet", "--set-upstream", "origin", "main");
  return { repo, remote };
}

/**
 * Leaves `repo` in a merge that stopped on a conflict in `file`: main and `side` both changed it. Returns the commits
 * of both sides.
 */
export function mergeConflict(repo: Repo, file = "a.txt"): { main: string; side: string } {
  repo.write(file, "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "side");
  repo.write(file, "side\n");
  const side = repo.commit("side");
  repo.git("switch", "--quiet", "main");
  repo.write(file, "main\n");
  const main = repo.commit("main");
  if (repo.tryGit("merge", "--quiet", "side")) throw new Error("the merge was expected to conflict");
  return { main, side };
}

/** Registers `source` (a repository's folder) as a submodule of `parent` at `path`, and commits it. */
export function addSubmodule(parent: Repo, source: string, path: string): void {
  parent.git("submodule", "add", "--quiet", fileUrl(source), path);
  parent.commit(`add ${path}`);
}

/** Adds a linked worktree of `repo` on a new branch, in a new folder; returns the worktree's root. */
export function addWorktree(t: TestContext, repo: Repo, branch: string): string {
  const parent = tempDir(t, "gitflux-worktree-");
  const root = join(parent, branch.replace(/[^A-Za-z0-9]/g, "-"));
  repo.git("worktree", "add", "--quiet", "-b", branch, root);
  return realpathSync.native(root);
}

/** Text with Windows line ends turned into "\n", for comparing what a file holds. */
export const lf = (text: string) => text.replace(/\r\n/g, "\n");
