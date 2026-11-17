// What branch.ts, tag.ts and remote.ts share: the readers of `git for-each-ref` output for branches and tags (pure,
// unit-tested in test/unit/server/refs.test.ts), and small questions asked of a repository before acting on its refs.
//
// API
//   BRANCH_FORMAT, BRANCH_FIELDS          the for-each-ref format parseBranchRecords reads (fields NUL-terminated).
//   parseBranchRecords(out)               its records, raw: refname, hash, upstream, track, head, worktree, time,
//                                         symref, subject. Records with a malformed object name are left out.
//   parseTrack("[ahead 1, behind 2]")     → { ahead, behind, gone } from %(upstream:track).
//   splitRemoteRef(name, remotes)         `origin/feat/x` → { remote, branch } by the longest configured remote name
//                                         that prefixes it (remote names may hold `/`); the first segment otherwise.
//   toLocalBranches(records, options)     records of refs/heads → BranchEntry[] (at most `max`, `truncated` past it).
//   toRemoteBranches(records, remotes, max) records of refs/remotes → RemoteBranchEntry[]: `<remote>/HEAD` left out,
//                                         `isHead` set on the branch it points at.
//   TAG_FORMAT, TAG_FIELDS, parseTags(out, max)  tags as git.tag.list returns them; `hash` is the peeled object.
//   currentBranch(tools) → name | null    the checked-out branch (also before its first commit); null when detached.
//   headHash(tools) → hash | null         the commit HEAD is at; null before the first commit.
//   refHash(tools, fullRef) → hash | null the object a full ref names, or null when there is no such ref.
//   remoteNames(tools) → string[]         the configured remotes.
//   operationUnderWay(cwd) → kind | null  a merge, rebase, am, cherry-pick or revert under way (bisect is not: one
//                                         switches branches while bisecting); read from the git dir's files.
//   assertNoOperation(cwd)                OPERATION_IN_PROGRESS when operationUnderWay says one is.
//   hasUnmerged(tools), hasLocalChanges(tools)  whether files are in conflict / anything (untracked too) would be
//                                         stashed; each reads one record at most.
//   checkedOutElsewhere(detail)           whether git refused because the branch is checked out in another work tree.
//   deleteOnRemote(tools, remote, ref)    `git push --delete`; REF_NOT_FOUND when the remote has no such ref.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BranchEntry, RemoteBranchEntry, TagEntry } from "../shared/schemas.ts";
import { isProtectedBranch } from "../shared/settings.ts";
import { GitError, isGitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { repoDirs } from "./core/validate.ts";

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Splits for-each-ref output whose format ends every field with `%00` into records of `fields` fields. A commit
 * subject cannot hold NUL, so counting fields is exact; git's newline after each record is left at the start of the
 * next record's first field (a ref name, which never starts with one) and is removed there.
 */
export function splitRecords(out: string, fields: number): string[][] {
  const tokens = out.split("\0");
  const records: string[][] = [];
  for (let start = 0; start + fields <= tokens.length; start += fields) {
    const record = tokens.slice(start, start + fields);
    record[0] = record[0].replace(/^\r?\n/, "");
    if (record[0] === "") continue;
    records.push(record);
  }
  return records;
}

const seconds = (text: string) => {
  const value = Number(text.trim());
  return Number.isFinite(value) && text.trim() !== "" ? value : 0;
};

// --- branches ---------------------------------------------------------------------------------------

/** The fields read for every branch, in order; the subject comes last. */
export const BRANCH_FIELDS = [
  "%(refname)",
  "%(objectname)",
  "%(upstream:short)",
  "%(upstream:track)",
  "%(HEAD)",
  "%(worktreepath)",
  "%(committerdate:unix)",
  "%(symref)",
  "%(contents:subject)",
] as const;

export const BRANCH_FORMAT = BRANCH_FIELDS.map((field) => `${field}%00`).join("");

export interface BranchRecord {
  refname: string;
  hash: string;
  upstream: string; // short, "" without one
  track: string; // %(upstream:track): "[ahead 1, behind 2]", "[gone]" or ""
  head: boolean; // checked out in this work tree
  worktree: string; // the work tree that has it checked out, "" when none
  time: number;
  symref: string; // what a symbolic ref (`refs/remotes/origin/HEAD`) points at, "" otherwise
  subject: string;
}

export function parseBranchRecords(out: string): BranchRecord[] {
  const records: BranchRecord[] = [];
  for (const [refname, hash, upstream, track, head, worktree, time, symref, subject] of splitRecords(out, BRANCH_FIELDS.length)) {
    if (!HASH.test(hash)) continue;
    records.push({ refname, hash, upstream, track, head: head === "*", worktree, time: seconds(time), symref, subject });
  }
  return records;
}

export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const ahead = /\bahead (\d+)/.exec(track);
  const behind = /\bbehind (\d+)/.exec(track);
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: /\bgone\b/.test(track) };
}

export function splitRemoteRef(name: string, remotes: readonly string[]): { remote: string; branch: string } {
  let best = "";
  for (const remote of remotes) if (remote.length > best.length && name.startsWith(`${remote}/`)) best = remote;
  if (best !== "") return { remote: best, branch: name.slice(best.length + 1) };
  const slash = name.indexOf("/");
  return slash === -1 ? { remote: name, branch: "" } : { remote: name.slice(0, slash), branch: name.slice(slash + 1) };
}

export interface LocalOptions {
  /** Paths, as %(worktreepath) prints them, that are this work tree. */
  here: ReadonlySet<string>;
  /** The host's protectedBranches. */
  protectedBranches: readonly string[];
  max: number;
}

export function toLocalBranches(records: readonly BranchRecord[], options: LocalOptions): { entries: BranchEntry[]; truncated: boolean } {
  const entries: BranchEntry[] = [];
  for (const record of records) {
    if (!record.refname.startsWith("refs/heads/")) continue;
    const name = record.refname.slice("refs/heads/".length);
    const { ahead, behind, gone } = parseTrack(record.track);
    entries.push({
      name,
      hash: record.hash,
      upstream: record.upstream === "" ? null : record.upstream,
      upstreamGone: record.upstream !== "" && gone,
      ahead,
      behind,
      current: record.head,
      worktree: !record.head && record.worktree !== "" && !options.here.has(record.worktree) ? record.worktree : null,
      time: record.time,
      subject: record.subject,
      protected: isProtectedBranch(name, options.protectedBranches),
    });
  }
  return { entries: entries.slice(0, options.max), truncated: entries.length > options.max };
}

export function toRemoteBranches(records: readonly BranchRecord[], remotes: readonly string[], max: number): { entries: RemoteBranchEntry[]; truncated: boolean } {
  const heads = new Set<string>();
  const entries: Array<RemoteBranchEntry & { refname: string }> = [];
  for (const record of records) {
    if (!record.refname.startsWith("refs/remotes/")) continue;
    const name = record.refname.slice("refs/remotes/".length);
    const { remote, branch } = splitRemoteRef(name, remotes);
    if (branch === "HEAD" || branch === "") {
      if (record.symref.startsWith("refs/remotes/")) heads.add(record.symref);
      continue;
    }
    entries.push({ refname: record.refname, name, remote, branch, hash: record.hash, time: record.time, subject: record.subject, isHead: false });
  }
  const listed = entries.slice(0, max).map(({ refname, ...entry }) => ({ ...entry, isHead: heads.has(refname) }));
  return { entries: listed, truncated: entries.length > max };
}

// --- tags ---------------------------------------------------------------------------------------------

/** The fields read for every tag, in order; the subject comes last. */
export const TAG_FIELDS = [
  "%(refname)",
  "%(objecttype)",
  "%(objectname)",
  "%(*objectname)", // what an annotated tag points at, peeled through tags
  "%(taggername)",
  "%(taggerdate:unix)",
  "%(committerdate:unix)", // a lightweight tag's commit
  "%(*committerdate:unix)", // an annotated tag's commit, for a tag object without a tagger
  "%(contents:subject)",
] as const;

export const TAG_FORMAT = TAG_FIELDS.map((field) => `${field}%00`).join("");

/** Tags, in the order git listed them, at most `max` (`truncated` past it). */
export function parseTags(out: string, max: number): { tags: TagEntry[]; truncated: boolean } {
  const tags: TagEntry[] = [];
  let seen = 0;
  for (const [refname, type, object, peeled, tagger, taggerTime, commitTime, peeledTime, subject] of splitRecords(out, TAG_FIELDS.length)) {
    if (!refname.startsWith("refs/tags/")) continue;
    const annotated = type === "tag";
    const hash = annotated ? peeled : object;
    if (!HASH.test(hash)) continue;
    seen++;
    if (tags.length >= max) continue;
    const entry: TagEntry = {
      name: refname.slice("refs/tags/".length),
      hash,
      annotated,
      time: annotated ? seconds(taggerTime) || seconds(peeledTime) : seconds(commitTime),
    };
    if (annotated) {
      entry.message = subject;
      if (tagger !== "") entry.tagger = tagger;
    }
    tags.push(entry);
  }
  return { tags, truncated: seen > max };
}

// --- questions asked of a repository ------------------------------------------------------------------

export async function currentBranch(tools: GitTools): Promise<string | null> {
  const branch = (await tools.read(["symbolic-ref", "--quiet", "--short", "HEAD"], [1])).trim();
  return branch === "" ? null : branch;
}

export async function headHash(tools: GitTools): Promise<string | null> {
  const hash = (await tools.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim();
  return HASH.test(hash) ? hash : null;
}

export async function refHash(tools: GitTools, fullRef: string): Promise<string | null> {
  const hash = (await tools.read(["rev-parse", "--verify", "--quiet", "--end-of-options", fullRef], [1])).trim();
  return HASH.test(hash) ? hash : null;
}

export async function remoteNames(tools: GitTools): Promise<string[]> {
  return (await tools.read(["remote"]))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export type UnderWay = "merge" | "rebase" | "am" | "cherry-pick" | "revert";

export async function operationUnderWay(cwd: string): Promise<UnderWay | null> {
  const { gitDir } = await repoDirs(cwd);
  const at = (name: string) => existsSync(join(gitDir, name));
  if (at("rebase-merge")) return "rebase";
  if (at("rebase-apply")) return at(join("rebase-apply", "applying")) ? "am" : "rebase";
  if (at("MERGE_HEAD")) return "merge";
  if (at("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (at("REVERT_HEAD")) return "revert";
  if (at(join("sequencer", "todo"))) return "cherry-pick";
  return null;
}

export async function assertNoOperation(cwd: string): Promise<void> {
  const kind = await operationUnderWay(cwd);
  if (kind !== null) throw new GitError("OPERATION_IN_PROGRESS", `A ${kind} is under way in this work tree: continue or abort it first`);
}

/** Whether `git <args>` prints at least one non-empty NUL-terminated record (it is stopped at the first). */
async function anyRecord(tools: GitTools, args: readonly string[]): Promise<boolean> {
  let found = false;
  await tools.stream(args, {
    delimiter: "\0",
    onRecord: (record) => {
      if (record === "") return true;
      found = true;
      return false;
    },
  });
  return found;
}

export function hasUnmerged(tools: GitTools): Promise<boolean> {
  return anyRecord(tools, ["ls-files", "--unmerged", "-z"]);
}

/** Changes `git stash push --include-untracked` would record: tracked changes, staged or not, and untracked files. */
export function hasLocalChanges(tools: GitTools): Promise<boolean> {
  return anyRecord(tools, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
}

// `'x' is already used by worktree at '…'` (git 2.42 on), `'x' is already checked out at '…'` (before), and for a
// deletion `cannot delete branch 'x' used by worktree at '…'` / `Cannot delete branch 'x' checked out at '…'`.
const ELSEWHERE = /used by worktree at|checked out at '/i;

export function checkedOutElsewhere(detail: string): boolean {
  return ELSEWHERE.test(detail);
}

/**
 * `git push --delete <remote> <full ref>`. A ref the remote does not have is REF_NOT_FOUND: git words that as a
 * failure of its own ("remote ref does not exist") that the shared table does not read.
 */
export async function deleteOnRemote(tools: GitTools, remote: string, ref: string): Promise<void> {
  try {
    await tools.git(["push", "--delete", "--end-of-options", remote, ref], { kind: "network" });
  } catch (error) {
    if (isGitError(error) && error.code === "UNKNOWN" && /remote ref does not exist/i.test(error.detail)) {
      throw new GitError("REF_NOT_FOUND", error.detail, { cause: error });
    }
    throw error;
  }
}
