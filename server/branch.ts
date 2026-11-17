// Branches: listing, creating, checking out, renaming, deleting, merging, rebasing onto, resetting, following an upstream.
//
// Every name is checked as git checks one (core/validate.ts) before it reaches a command line, and revisions go after
// `--end-of-options`. Nothing here forces: a checkout never discards local changes (they fail the switch, or are
// stashed and popped back), `-D` needs the host's allowForceDelete, a hard reset needs allowHardReset and never touches
// a protected branch, and a hard or keep reset records a safety snapshot of tracked changes first.

import type { output as ZodOutput } from "zod";
import { LIST_MAX } from "../shared/limits.ts";
import {
  branchCheckoutRpc,
  branchCreateRpc,
  branchDeleteRpc,
  branchListRpc,
  branchMergeRpc,
  branchRebaseRpc,
  branchRenameRpc,
  branchResetRpc,
  branchSetUpstreamRpc,
  type BranchList,
  type CheckoutTarget,
  type MergeResult,
} from "../shared/rpc/branch.ts";
import { GitError, isGitError } from "./core/errors.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { refuseProtected, requireSwitch } from "./core/safety.ts";
import { assertRefName, assertRevision, realOrSelf, samePathText } from "./core/validate.ts";
import {
  BRANCH_FORMAT,
  assertNoOperation,
  checkedOutElsewhere,
  currentBranch,
  hasLocalChanges,
  hasUnmerged,
  headHash,
  operationUnderWay,
  parseBranchRecords,
  refHash,
  remoteNames,
  splitRemoteRef,
  toLocalBranches,
  toRemoteBranches,
  type BranchRecord,
} from "./refs.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, branchListRpc, { kind: "read" }, (_input, ctx) => list(ctx));
  handle(server, deps, branchCreateRpc, { kind: "write" }, async (input, ctx) => {
    await create(ctx, input);
    return {};
  });
  handle(server, deps, branchCheckoutRpc, { kind: "write" }, (input, ctx) => checkout(ctx, input));
  handle(server, deps, branchRenameRpc, { kind: "write", index: false }, async (input, ctx) => {
    await rename(ctx, input.name, input.newName);
    return {};
  });
  handle(server, deps, branchDeleteRpc, { kind: "write", index: false }, async (input, ctx) => {
    await remove(ctx, input.name, input.force);
    return {};
  });
  handle(server, deps, branchMergeRpc, { kind: "write" }, async (input, ctx) => ({ result: await merge(ctx, input) }));
  handle(server, deps, branchRebaseRpc, { kind: "write" }, (input, ctx) => rebase(ctx, input));
  handle(server, deps, branchResetRpc, { kind: "write" }, (input, ctx) => reset(ctx, input));
  handle(server, deps, branchSetUpstreamRpc, { kind: "write", index: false }, async (input, ctx) => {
    await setUpstream(ctx, input.name, input.upstream);
    return {};
  });
}

/** git's refusal to use a branch another work tree has checked out, as INVALID_ARGUMENT with git's words. */
function elsewhere(error: unknown): unknown {
  if (isGitError(error) && error.code === "UNKNOWN" && checkedOutElsewhere(error.detail)) return new GitError("INVALID_ARGUMENT", error.detail, { cause: error });
  return error;
}

async function mustHaveBranch(ctx: HandlerContext, name: string): Promise<string> {
  const hash = await refHash(ctx, `refs/heads/${name}`);
  if (hash === null) throw new GitError("REF_NOT_FOUND", `No local branch '${name}'`);
  return hash;
}

// --- list ----------------------------------------------------------------------------------------------

/** Which %(worktreepath) values are this work tree, and the real path of each, compared as the file system does. */
async function worktreePaths(cwd: string, records: readonly BranchRecord[]): Promise<{ here: Set<string>; real: Map<string, string> }> {
  const own = await realOrSelf(cwd);
  const here = new Set<string>();
  const real = new Map<string, string>();
  for (const path of new Set(records.map((record) => record.worktree).filter((path) => path !== ""))) {
    const resolved = await realOrSelf(path);
    real.set(path, resolved);
    if (samePathText(resolved, own)) here.add(path);
  }
  return { here, real };
}

async function list(ctx: HandlerContext): Promise<BranchList> {
  const remotes = await remoteNames(ctx);
  const [localOut, remoteOut, current, policy] = await Promise.all([
    ctx.read(["for-each-ref", `--count=${LIST_MAX + 1}`, `--format=${BRANCH_FORMAT}`, "refs/heads"]),
    // Room for every `<remote>/HEAD`, which is not listed.
    ctx.read(["for-each-ref", `--count=${LIST_MAX + remotes.length + 1}`, `--format=${BRANCH_FORMAT}`, "refs/remotes"]),
    currentBranch(ctx),
    ctx.policy(),
  ]);
  const records = parseBranchRecords(localOut);
  const { here, real } = await worktreePaths(ctx.cwd, records);
  const local = toLocalBranches(records, { here, protectedBranches: policy.protectedBranches, max: LIST_MAX });
  const remote = toRemoteBranches(parseBranchRecords(remoteOut), remotes, LIST_MAX);
  return {
    current,
    local: local.entries.map((entry) => (entry.worktree === null ? entry : { ...entry, worktree: real.get(entry.worktree) ?? entry.worktree })),
    remote: remote.entries,
    truncated: local.truncated || remote.truncated,
  };
}

// --- create --------------------------------------------------------------------------------------------

/**
 * The full name of the remote-tracking branch `revision` names (`origin/main` or `refs/remotes/origin/main`), or null
 * when it names something else.
 */
async function remoteTrackingRef(ctx: HandlerContext, revision: string): Promise<string | null> {
  // By name, not through rev-parse: a short name like `origin/main` is a remote-tracking branch when
  // refs/remotes/origin/main exists (git's own lookup order puts a local branch of that name first, which create's
  // callers never mean when they ask to track).
  const full = revision.startsWith("refs/remotes/") ? revision : `refs/remotes/${revision}`;
  return (await refHash(ctx, full)) !== null ? full : null;
}

async function create(ctx: HandlerContext, input: ZodOutput<typeof branchCreateRpc.input>): Promise<void> {
  await assertRefName(ctx.cwd, input.name, "branch");
  if ((await refHash(ctx, `refs/heads/${input.name}`)) !== null) throw new GitError("REF_EXISTS", `A branch named '${input.name}' already exists`);
  const start: string[] = [];
  let track = false;
  if (input.startPoint !== undefined) {
    const hash = await assertRevision(ctx.cwd, input.startPoint);
    const tracked = input.track ? await remoteTrackingRef(ctx, input.startPoint) : null;
    // --track follows a name, so a remote-tracking start point goes by its full name; anything else by its commit.
    track = tracked !== null;
    start.push("--end-of-options", tracked ?? hash);
  }
  const trackFlag = track ? "--track" : "--no-track";
  const args = input.checkout ? ["switch", "--no-guess", "--create", input.name, trackFlag, ...start] : ["branch", trackFlag, "--end-of-options", input.name, ...start.slice(1)];
  await ctx.git(args);
}

// --- checkout ------------------------------------------------------------------------------------------

/** The `git switch` arguments for a target, after checking that it is there. */
async function switchArgs(ctx: HandlerContext, target: CheckoutTarget): Promise<string[]> {
  switch (target.kind) {
    case "branch": {
      await assertRefName(ctx.cwd, target.name, "branch");
      await mustHaveBranch(ctx, target.name);
      return ["switch", "--no-guess", "--end-of-options", target.name];
    }
    case "remote": {
      const short = target.name.replace(/^refs\/remotes\//, "");
      const full = `refs/remotes/${short}`;
      await assertRefName(ctx.cwd, full, "ref");
      if ((await refHash(ctx, full)) === null) throw new GitError("REF_NOT_FOUND", `No remote-tracking branch '${short}'`);
      const { branch } = splitRemoteRef(short, await remoteNames(ctx));
      if (branch === "" || branch === "HEAD") throw new GitError("INVALID_ARGUMENT", `'${short}' is not a branch on a remote`);
      const local = target.localName ?? branch;
      await assertRefName(ctx.cwd, local, "branch");
      if ((await refHash(ctx, `refs/heads/${local}`)) !== null) {
        const upstream = (await ctx.read(["for-each-ref", "--format=%(upstream)", `refs/heads/${local}`])).trim();
        if (upstream !== full) throw new GitError("REF_EXISTS", `A branch named '${local}' already exists and does not follow ${short}`);
        return ["switch", "--no-guess", "--end-of-options", local];
      }
      return ["switch", "--no-guess", "--create", local, "--track", "--end-of-options", full];
    }
    case "commit":
      return ["switch", "--detach", "--end-of-options", await assertRevision(ctx.cwd, target.hash)];
    case "tag": {
      await assertRefName(ctx.cwd, target.name, "tag");
      const hash = await refHash(ctx, `refs/tags/${target.name}^{commit}`);
      if (hash === null) throw new GitError("REF_NOT_FOUND", `No tag '${target.name}' on a commit`);
      return ["switch", "--detach", "--end-of-options", hash];
    }
  }
}

async function switchTo(ctx: HandlerContext, args: readonly string[]): Promise<void> {
  try {
    await ctx.git(args);
  } catch (error) {
    throw elsewhere(error);
  }
}

/** Where the stash `hash` is in the list (n of stash@{n}), or null when it is not there. */
async function stashIndex(ctx: HandlerContext, hash: string): Promise<number | null> {
  let index: number | null = null;
  let n = 0;
  await ctx.stream(["stash", "list", "--format=%H"], {
    delimiter: "\n",
    onRecord: (line) => {
      if (line.trim() === hash) {
        index = n;
        return false;
      }
      n++;
      return true;
    },
  });
  return index;
}

/** Stashes local changes, untracked files included; the stash's commit, or null when there was nothing to stash. */
async function stashLocal(ctx: HandlerContext): Promise<string | null> {
  if (!(await hasLocalChanges(ctx))) return null;
  const before = await refHash(ctx, "refs/stash");
  await ctx.git(["stash", "push", "--include-untracked", "--message", "advanced-git: local changes while switching"]);
  const after = await refHash(ctx, "refs/stash");
  return after !== null && after !== before ? after : null;
}

/** Pops the stash `hash`. True when it conflicted (or could not be applied) and git kept it. */
async function popStash(ctx: HandlerContext, hash: string): Promise<boolean> {
  const index = await stashIndex(ctx, hash);
  if (index === null) return false;
  try {
    await ctx.git(["stash", "pop", `stash@{${index}}`]);
    return false;
  } catch (error) {
    if ((await stashIndex(ctx, hash)) !== null) return true;
    throw error;
  }
}

async function checkout(ctx: HandlerContext, input: ZodOutput<typeof branchCheckoutRpc.input>): Promise<{ stashConflict: boolean }> {
  await assertNoOperation(ctx.cwd);
  const args = await switchArgs(ctx, input.target);
  if (input.dirty === "fail") {
    await switchTo(ctx, args);
    return { stashConflict: false };
  }
  const stash = await stashLocal(ctx);
  try {
    await switchTo(ctx, args);
  } catch (error) {
    // Nothing moved: the changes go back where they were.
    if (stash !== null) await popStash(ctx, stash).catch(() => true);
    throw error;
  }
  return { stashConflict: stash === null ? false : await popStash(ctx, stash) };
}

// --- rename, delete --------------------------------------------------------------------------------------

async function rename(ctx: HandlerContext, name: string, newName: string): Promise<void> {
  await assertRefName(ctx.cwd, name, "branch");
  await assertRefName(ctx.cwd, newName, "branch");
  // A branch not born yet (the checked-out one before its first commit) can be renamed too.
  if ((await refHash(ctx, `refs/heads/${name}`)) === null && (await currentBranch(ctx)) !== name) {
    throw new GitError("REF_NOT_FOUND", `No local branch '${name}'`);
  }
  // A change of case only is the same file on a case-insensitive file system: git tells.
  if (newName.toLowerCase() !== name.toLowerCase() && (await refHash(ctx, `refs/heads/${newName}`)) !== null) {
    throw new GitError("REF_EXISTS", `A branch named '${newName}' already exists`);
  }
  // Renaming takes the protected name away, as deleting would.
  refuseProtected(await ctx.policy(), name);
  await ctx.git(["branch", "--move", "--end-of-options", name, newName]);
}

async function remove(ctx: HandlerContext, name: string, force: boolean): Promise<void> {
  await assertRefName(ctx.cwd, name, "branch");
  if ((await currentBranch(ctx)) === name) throw new GitError("INVALID_ARGUMENT", `'${name}' is the checked-out branch: switch to another one first`);
  const policy = await ctx.policy();
  refuseProtected(policy, name);
  await mustHaveBranch(ctx, name);
  if (force) requireSwitch(policy, "allowForceDelete");
  try {
    await ctx.git(["branch", force ? "-D" : "-d", "--end-of-options", name]);
  } catch (error) {
    throw elsewhere(error);
  }
}

// --- merge -----------------------------------------------------------------------------------------------

const MERGE_FLAG = { ff: "--ff", "no-ff": "--no-ff", "ff-only": "--ff-only", squash: "--squash" } as const;

/** Whether the index holds staged changes against HEAD. */
async function staged(ctx: HandlerContext): Promise<boolean> {
  return (await ctx.git(["diff", "--cached", "--quiet"], { kind: "read", accept: [1] })).code === 1;
}

async function merge(ctx: HandlerContext, input: ZodOutput<typeof branchMergeRpc.input>): Promise<MergeResult> {
  await assertNoOperation(ctx.cwd);
  await assertRevision(ctx.cwd, input.ref);
  const before = await headHash(ctx);
  const message = input.message !== undefined && input.mode !== "squash" ? ["-m", input.message] : [];
  try {
    await ctx.git(["-c", "user.useConfigOnly=true", "merge", "--no-edit", MERGE_FLAG[input.mode], ...message, "--end-of-options", input.ref]);
  } catch (error) {
    if (isGitError(error) && error.code === "MERGE_CONFLICT" && ((await operationUnderWay(ctx.cwd)) === "merge" || (await hasUnmerged(ctx)))) return "conflict";
    throw error;
  }
  if (input.mode === "squash") return (await staged(ctx)) ? "squashed" : "up-to-date";
  const after = await headHash(ctx);
  if (after === null || after === before) return "up-to-date";
  if (before === null) return "fast-forward";
  const parents = (await ctx.read(["rev-list", "--parents", "-n", "1", after, "--"])).trim().split(" ").slice(1);
  return parents.length > 1 && parents[0] === before ? "merged" : "fast-forward";
}

// --- rebase ----------------------------------------------------------------------------------------------

/** How many commits of `range` there are, `--not --remotes` when `unpublished`. */
async function count(ctx: HandlerContext, range: string, unpublished: boolean): Promise<number> {
  const out = await ctx.read(["rev-list", "--count", range, ...(unpublished ? ["--not", "--remotes"] : []), "--"]);
  return Number(out.trim()) || 0;
}

async function rebase(ctx: HandlerContext, input: ZodOutput<typeof branchRebaseRpc.input>): Promise<{ conflicted: boolean }> {
  await assertNoOperation(ctx.cwd);
  const onto = await assertRevision(ctx.cwd, input.onto);
  const head = await headHash(ctx);
  if (head === null) throw new GitError("REF_NOT_FOUND", "There is no commit to rebase yet");
  const branch = await currentBranch(ctx);
  // The commits a rebase rewrites are those of onto..HEAD; any of them a remote-tracking branch has are published.
  const range = `${onto}..${head}`;
  const published = (await count(ctx, range, false)) > (await count(ctx, range, true));
  if (published) {
    if (branch !== null) refuseProtected(await ctx.policy(), branch);
    if (input.confirmPublished !== true) {
      throw new GitError("CONFIRMATION_REQUIRED", "Commits this rebase rewrites are already on a remote: rewriting them needs confirmPublished");
    }
  }
  await ctx.snapshot();
  try {
    await ctx.git(["-c", "user.useConfigOnly=true", "rebase", input.autostash ? "--autostash" : "--no-autostash", "--end-of-options", onto], {
      env: { GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" },
    });
  } catch (error) {
    if (isGitError(error) && error.code === "MERGE_CONFLICT" && (await operationUnderWay(ctx.cwd)) === "rebase") return { conflicted: true };
    throw error;
  }
  return { conflicted: false };
}

// --- reset -----------------------------------------------------------------------------------------------

/** What `git reset --keep` says when local changes would be lost: refused, nothing changed. */
const KEEP_REFUSED = /not uptodate|would be overwritten|Could not reset index file/i;

async function reset(ctx: HandlerContext, input: ZodOutput<typeof branchResetRpc.input>): Promise<{ snapshot: string | null }> {
  const target = await assertRevision(ctx.cwd, input.target);
  const branch = await currentBranch(ctx);
  const discards = input.mode === "hard" || input.mode === "keep";
  if (discards) {
    const policy = await ctx.policy();
    if (input.mode === "hard") requireSwitch(policy, "allowHardReset");
    // On a protected branch only soft and mixed are allowed; a detached HEAD has no branch to protect.
    if (branch !== null) refuseProtected(policy, branch);
  }
  const snapshot = discards ? await ctx.snapshot() : null;
  try {
    await ctx.git(["reset", "--quiet", `--${input.mode}`, "--end-of-options", target, "--"]);
  } catch (error) {
    if (input.mode === "keep" && isGitError(error) && (error.code === "UNKNOWN" || error.code === "WOULD_OVERWRITE_CHANGES") && KEEP_REFUSED.test(error.detail)) {
      throw new GitError("WOULD_OVERWRITE_CHANGES", error.detail, { cause: error });
    }
    throw error;
  }
  return { snapshot };
}

// --- upstream --------------------------------------------------------------------------------------------

async function setUpstream(ctx: HandlerContext, name: string, upstream: string | null): Promise<void> {
  await assertRefName(ctx.cwd, name, "branch");
  await mustHaveBranch(ctx, name);
  if (upstream === null) {
    // git refuses to unset what is not set; nothing to do is not a failure.
    const configured = (await ctx.read(["config", "--get", `branch.${name}.merge`], [1])).trim();
    if (configured !== "") await ctx.git(["branch", "--unset-upstream", "--end-of-options", name]);
    return;
  }
  const short = upstream.replace(/^refs\/remotes\//, "");
  const full = `refs/remotes/${short}`;
  await assertRefName(ctx.cwd, full, "ref");
  if ((await refHash(ctx, full)) === null) throw new GitError("REF_NOT_FOUND", `No remote-tracking branch '${short}'`);
  await ctx.git(["branch", `--set-upstream-to=${full}`, "--end-of-options", name]);
}
