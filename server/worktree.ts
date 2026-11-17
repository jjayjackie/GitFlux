// Linked worktrees: listing, adding, removing, pruning.
//
// The list is `git worktree list --porcelain -z`, read by server/repo.ts parseWorktrees. A work tree to remove is
// looked up in that list and git is given git's own record of its path, never the caller's text: no other folder can
// be removed through this call. The main work tree and the one the call was made from are never removed.
//
// Exported for the unit tests: worktreeEntries.

import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { output as ZodOutput } from "zod";
import { LIST_MAX } from "../shared/limits.ts";
import { worktreeAddRpc, worktreeListRpc, worktreePruneRpc, worktreeRemoveRpc } from "../shared/rpc/worktree.ts";
import type { WorktreeEntry } from "../shared/schemas.ts";
import { GitError, isGitError } from "./core/errors.ts";
import { mapLimit, type GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { requireSwitch, snapshot } from "./core/safety.ts";
import { assertRefName, assertRevision, realOrSelf, repoDirs, samePathText, withinReal } from "./core/validate.ts";
import { parseWorktrees, type WorktreeRecord } from "./repo.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, worktreeListRpc, { kind: "read" }, (_input, ctx) => list(ctx));
  handle(server, deps, worktreeAddRpc, { kind: "write", index: false }, (input, ctx) => add(ctx, input));
  handle(server, deps, worktreeRemoveRpc, { kind: "write", index: false }, async (input, ctx) => {
    await remove(ctx, input.path, input.force);
    return {};
  });
  handle(server, deps, worktreePruneRpc, { kind: "write", index: false }, async (_input, ctx) => {
    await ctx.git(["worktree", "prune"]);
    return {};
  });
}

// --- the list ------------------------------------------------------------------------------------------

const UNBORN = /^0+$/;

/**
 * The records of `git worktree list --porcelain` as entries: the first is the main work tree, `isCurrent` says which
 * one the call was made from. A branch is given by its short name; the all-zero HEAD of a branch with no commit yet is
 * none.
 */
export function worktreeEntries(records: readonly WorktreeRecord[], isCurrent: (path: string) => boolean): WorktreeEntry[] {
  return records.map((record, index) => ({
    path: record.path,
    head: record.head === null || UNBORN.test(record.head) ? null : record.head,
    branch: record.branch === null ? null : record.branch.replace(/^refs\/heads\//, ""),
    detached: record.detached,
    bare: record.bare,
    locked: record.locked,
    prunable: record.prunable,
    main: index === 0,
    current: isCurrent(record.path),
  }));
}

/** Every work tree git records, paths made real (macOS /var → /private/var, Windows' forward slashes and short names). */
async function records(tools: GitTools): Promise<WorktreeRecord[]> {
  const parsed = parseWorktrees(await tools.read(["worktree", "list", "--porcelain", "-z"]));
  // A folder that is gone (prunable) keeps its recorded path, normalised.
  return mapLimit(parsed, 16, async (record) => ({ ...record, path: await realOrSelf(record.path) }));
}

async function list(tools: GitTools): Promise<{ worktrees: WorktreeEntry[]; truncated: boolean }> {
  const [all, here] = await Promise.all([records(tools), realOrSelf(tools.cwd)]);
  const entries = worktreeEntries(all.slice(0, LIST_MAX), (path) => samePathText(path, here));
  return { worktrees: entries, truncated: all.length > LIST_MAX };
}

// --- adding ---------------------------------------------------------------------------------------------

type AddInput = ZodOutput<typeof worktreeAddRpc.input>;

/** The folder a new work tree goes to: its parent exists, it is not inside a `.git`, and it is absent or empty. */
async function assertNewFolder(tools: GitTools, target: string): Promise<void> {
  const parent = dirname(target);
  let parentInfo;
  try {
    parentInfo = await stat(parent);
  } catch {
    throw new GitError("INVALID_ARGUMENT", `The folder ${parent} does not exist`);
  }
  if (!parentInfo.isDirectory()) throw new GitError("INVALID_ARGUMENT", `${parent} is not a folder`);
  const real = resolve(await realOrSelf(parent), basename(target));
  const { gitDir, commonDir } = await repoDirs(tools.cwd);
  if (real.split(/[\\/]/).some((part) => part.toLowerCase() === ".git") || withinReal(commonDir, real) || withinReal(gitDir, real)) {
    throw new GitError("INVALID_ARGUMENT", `${target} is inside a repository's .git folder`);
  }
  let info;
  try {
    info = await stat(target);
  } catch {
    return; // not there: git makes it
  }
  if (!info.isDirectory()) throw new GitError("REF_EXISTS", `'${target}' already exists`);
  if ((await readdir(target)).length > 0) throw new GitError("REF_EXISTS", `'${target}' already exists and is not empty`);
}

/** The work tree that has `branch` checked out, if any. */
async function checkedOutAt(tools: GitTools, branch: string): Promise<string | null> {
  const found = parseWorktrees(await tools.read(["worktree", "list", "--porcelain", "-z"])).find((record) => record.branch === `refs/heads/${branch}`);
  return found === undefined ? null : found.path;
}

async function branchExists(tools: GitTools, branch: string): Promise<boolean> {
  return (await tools.read(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], [1])).trim() !== "";
}

async function add(ctx: HandlerContext, input: AddInput): Promise<{ path: string }> {
  const target = resolve(input.path);
  await assertNewFolder(ctx, target);
  // Start points are resolved to commits first: what reaches git is a full hash, never read as an option.
  const start = input.startPoint === undefined ? [] : [await assertRevision(ctx.cwd, input.startPoint)];
  const args = ["worktree", "add"];
  if (input.branch !== undefined) {
    const branch = await assertRefName(ctx.cwd, input.branch, "branch");
    if (!(await branchExists(ctx, branch))) throw new GitError("REF_NOT_FOUND", `No local branch ${branch}`);
    const elsewhere = await checkedOutAt(ctx, branch);
    if (elsewhere !== null) throw new GitError("REF_EXISTS", `'${branch}' is already checked out at '${elsewhere}'`);
    args.push(target, branch);
  } else if (input.newBranch !== undefined) {
    const branch = await assertRefName(ctx.cwd, input.newBranch, "branch");
    if (await branchExists(ctx, branch)) throw new GitError("REF_EXISTS", `a branch named '${branch}' already exists`);
    args.push("-b", branch, target, ...start);
  } else if (input.detach) {
    args.push("--detach", target, ...start);
  } else {
    // git's default: a branch named after the folder, made at HEAD when it does not exist yet.
    args.push(target, ...start);
  }
  try {
    await ctx.git(args); // never --force
  } catch (error) {
    // Another work tree has the branch (git's words changed across versions), or a vanished one still holds the path.
    if (isGitError(error) && /is already (?:checked out|used by worktree)|already registered/i.test(error.detail)) {
      throw new GitError("REF_EXISTS", error.detail, { cause: error });
    }
    throw error;
  }
  return { path: await realOrSelf(target) };
}

// --- removing -----------------------------------------------------------------------------------------------

async function remove(ctx: HandlerContext, path: string, force: boolean): Promise<void> {
  const [all, here, wanted] = await Promise.all([records(ctx), realOrSelf(ctx.cwd), realOrSelf(resolve(path))]);
  const index = all.findIndex((record) => samePathText(record.path, wanted));
  if (index === -1) throw new GitError("REF_NOT_FOUND", `${path} is not a work tree of this repository`);
  const record = all[index];
  if (index === 0) throw new GitError("INVALID_ARGUMENT", `${record.path} is the main work tree: it cannot be removed`);
  if (samePathText(record.path, here)) throw new GitError("INVALID_ARGUMENT", `${record.path} is the work tree this was asked from: it cannot be removed from itself`);
  // git refuses a locked one unless forced twice, which this plugin never does.
  if (record.locked) throw new GitError("INVALID_ARGUMENT", `${record.path} is locked: unlock it first`);
  const args = ["worktree", "remove"];
  if (force) {
    const policy = await ctx.policy();
    requireSwitch(policy, "allowForceDelete");
    // The one --force of this plugin outside a push lease: `git worktree remove --force` deletes a work tree that has
    // local changes or untracked files. It is what the allowForceDelete switch documents ("removing a dirty
    // worktree", architecture §5), and the schema requires `confirm` too. A single --force: a locked work tree stays
    // refused. Its tracked changes are recorded first (safetySnapshots), like any other discard.
    if (!record.prunable && existsSync(record.path)) await snapshot(ctx.at(record.path), ctx.name, policy);
    args.push("--force");
  }
  // git's record of the path, real: never the text the call carried.
  await ctx.git([...args, record.path]);
}
