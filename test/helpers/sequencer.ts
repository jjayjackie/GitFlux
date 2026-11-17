// Helpers for the tests of hunks, conflicts, operations under way, cherry-pick / revert and interactive rebase:
// a file's bytes in the index, the git dir, and histories built commit by commit. Everything through `git` with an
// argv array, in throwaway repositories (test/helpers/repo.ts).

import "./env.ts";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Repo } from "./repo.ts";

/** The bytes git keeps for `spec` (`:path` for the index, `HEAD:path`), exactly: no trimming, no decoding. */
export function blobBytes(repo: Repo, spec: string): Buffer {
  return execFileSync("git", ["cat-file", "blob", spec], { cwd: repo.cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
}

/** The index's version of a file, as text. */
export function indexText(repo: Repo, path: string): string {
  return blobBytes(repo, `:${path}`).toString("utf8");
}

/** The work tree's own git dir (absolute). */
export function gitDirOf(repo: Repo): string {
  return repo.git("rev-parse", "--absolute-git-dir");
}

/** Whether the plugin left its folder in the git dir. */
export function pluginFolderLeft(repo: Repo): boolean {
  return existsSync(join(gitDirOf(repo), "advanced-git"));
}

/** Commits that each add a file of their own (`<name>.txt`), with their names as subjects; returns their hashes. */
export function commitsAdding(repo: Repo, names: readonly string[]): string[] {
  return names.map((name) => {
    repo.write(`${name}.txt`, `${name}\n`);
    return repo.commit(name);
  });
}

/** Subjects from `from` (exclusive) to HEAD, oldest first. */
export function subjectsSince(repo: Repo, from: string): string[] {
  const out = repo.git("log", "--reverse", "--format=%s", `${from}..HEAD`);
  return out === "" ? [] : out.split(/\r?\n/);
}

/** Paths in conflict now. */
export function conflicted(repo: Repo): string[] {
  const out = repo.git("diff", "--name-only", "--diff-filter=U");
  return out === "" ? [] : out.split(/\r?\n/);
}
