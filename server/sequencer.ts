// What the operations that stop on conflicts (merge, rebase, cherry-pick, revert) share: knowing what is under way,
// whether files are in conflict, and naming commits as git names them in its own messages.
//
// API
//   operationNow(tools) → { gitDir, kind }   the work tree's git dir and the operation under way (server/repo.ts
//                                            operationKindOf: read from the files git keeps, no git run), or null.
//   assertNoOperation(tools)                 OPERATION_IN_PROGRESS when anything is under way.
//   hasUnmerged(tools) → boolean             whether any file is in conflict (stops reading at the first).
//   unmergedStages(tools, paths?) → Map<path, UnmergedFile>
//                                            the index stages of the files in conflict (all, or those of `paths`):
//                                            stage 1 base, 2 ours, 3 theirs, each with its mode and blob, or absent.
//   currentBranch(tools) → name | null       the checked-out branch's short name; null when HEAD is detached.
//   describeCommit(tools, hash) → "a1b2c3d (subject)"
//                                            as git labels a commit in conflict markers and messages.
//   readGitFile(gitDir, name) → text | null  a small file git keeps in its dir (MERGE_MSG, rebase-merge/onto…).

import { join } from "node:path";
import type { Operation } from "../shared/schemas.ts";
import { GitError } from "./core/errors.ts";
import { chunkPaths, type GitTools } from "./core/exec.ts";
import { repoDirs } from "./core/validate.ts";
import { operationKindOf, readSmall } from "./repo.ts";

export async function operationNow(tools: GitTools): Promise<{ gitDir: string; kind: Operation | null }> {
  const { gitDir } = await repoDirs(tools.cwd);
  return { gitDir, kind: operationKindOf(gitDir) };
}

export async function assertNoOperation(tools: GitTools): Promise<void> {
  const { kind } = await operationNow(tools);
  if (kind !== null) throw new GitError("OPERATION_IN_PROGRESS", `A ${kind} is under way in this work tree: continue or abort it first`);
}

export async function hasUnmerged(tools: GitTools): Promise<boolean> {
  let found = false;
  await tools.stream(["ls-files", "--unmerged", "-z"], {
    delimiter: "\0",
    onRecord: (record) => {
      if (record === "") return true;
      found = true;
      return false;
    },
  });
  return found;
}

export interface Stage {
  mode: string;
  hash: string;
}

export interface UnmergedFile {
  base: Stage | null;
  ours: Stage | null;
  theirs: Stage | null;
}

/** Reads `git ls-files --unmerged -z` records ("<mode> <hash> <stage>\t<path>") into files by path. */
export function parseUnmerged(out: string, into: Map<string, UnmergedFile> = new Map()): Map<string, UnmergedFile> {
  for (const record of out.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [mode, hash, stage] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (mode === undefined || hash === undefined || stage === undefined || path === "") continue;
    const file = into.get(path) ?? { base: null, ours: null, theirs: null };
    const entry = { mode, hash };
    if (stage === "1") file.base = entry;
    else if (stage === "2") file.ours = entry;
    else if (stage === "3") file.theirs = entry;
    into.set(path, file);
  }
  return into;
}

export async function unmergedStages(tools: GitTools, paths?: readonly string[]): Promise<Map<string, UnmergedFile>> {
  const files = new Map<string, UnmergedFile>();
  if (paths === undefined) {
    parseUnmerged(await tools.read(["ls-files", "--unmerged", "-z"]), files);
    return files;
  }
  for (const chunk of chunkPaths(paths)) {
    parseUnmerged(await tools.read(["--literal-pathspecs", "ls-files", "--unmerged", "-z", "--", ...chunk]), files);
  }
  return files;
}

export async function currentBranch(tools: GitTools): Promise<string | null> {
  const branch = (await tools.read(["symbolic-ref", "--quiet", "--short", "HEAD"], [1])).trim();
  return branch === "" ? null : branch;
}

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export async function describeCommit(tools: GitTools, hash: string): Promise<string> {
  if (!HASH.test(hash)) return hash;
  try {
    const out = (await tools.read(["log", "-1", "--no-show-signature", "--format=%h (%s)", "--end-of-options", hash, "--"])).trim();
    return out === "" ? hash.slice(0, 7) : out;
  } catch {
    return hash.slice(0, 7);
  }
}

export async function readGitFile(gitDir: string, name: string): Promise<string | null> {
  return readSmall(join(gitDir, name));
}

/** A full hash read from a file git keeps, or null. */
export function hashIn(text: string | null): string | null {
  const value = (text ?? "").trim();
  return HASH.test(value) ? value : null;
}
