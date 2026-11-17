// Small builders for the branch, tag and remote tests: a repository with a first commit, a branch with a commit of
// its own, and questions about refs and stashes asked of git directly.

import "./env.ts";
import type { TestContext } from "node:test";
import { gitTry, repository, type Repo } from "./repo.ts";

/** A new repository on `main` with one commit holding `a.txt` ("a\n"), at `time` (seconds) when given. */
export function started(t: TestContext, time?: number): Repo {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.commit("root", time === undefined ? {} : { time });
  return repo;
}

/**
 * Makes branch `name` from the checked-out one, commits `text` to `file` on it, and switches back. Returns the commit.
 * The work tree must be clean.
 */
export function sideBranch(repo: Repo, name: string, file: string, text: string): string {
  const back = repo.git("symbolic-ref", "--short", "HEAD");
  repo.git("switch", "--quiet", "--create", name);
  repo.write(file, text);
  const hash = repo.commit(`${name}: ${file}`);
  repo.git("switch", "--quiet", back);
  return hash;
}

/** Whether `ref` resolves in the repository at `cwd` (a work tree or a bare remote). */
export function hasRef(cwd: string, ref: string): boolean {
  return gitTry(cwd, ["rev-parse", "--verify", "--quiet", ref]);
}

/** The checked-out branch, or null when HEAD is detached. */
export function branchOf(repo: Repo): string | null {
  return repo.tryGit("symbolic-ref", "--quiet", "HEAD") ? repo.git("symbolic-ref", "--short", "HEAD") : null;
}

/** The stash commits, newest first. */
export function stashes(repo: Repo): string[] {
  const out = repo.git("stash", "list", "--format=%H");
  return out === "" ? [] : out.split(/\r?\n/);
}

/** The short name of what `branch` follows, or null. */
export function upstreamOf(repo: Repo, branch: string): string | null {
  return repo.tryGit("rev-parse", "--verify", "--quiet", `${branch}@{upstream}`) ? repo.git("rev-parse", "--abbrev-ref", `${branch}@{upstream}`) : null;
}
