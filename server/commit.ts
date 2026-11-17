// Making commits.
//
// git.commit.create commits as VS Code does: with the identity git is told (user.useConfigOnly: never one guessed from
// the machine), the message on stdin (`-F -`, so a long message never meets a command-line limit), hooks run
// (`--no-verify` is never used). Amending a commit a remote-tracking branch already has rewrites published history and
// needs `confirmAmendPushed`. It concludes a merge, cherry-pick or revert under way, as `git commit` does, and never
// continues a rebase (that is git.operation.control).
//
// git.commit.revert and git.commit.cherry-pick run `git revert|cherry-pick --no-edit` on the commits in the order
// given (each resolved with `rev-parse --verify` first, passed after `--end-of-options`), with `--no-commit`, `-m <n>`
// and `-x` as asked. A merge commit needs `mainline` (INVALID_ARGUMENT before git runs, naming the commit), and a
// mainline must be one of the commit's parents. OPERATION_IN_PROGRESS when anything is under way already. A stop on
// conflicts is the answer `{ conflicted: true }`: the operation stays under way for git.operation.control. A commit
// that turns out empty (its change is already there) is left out as `--empty=drop` would (`git <op> --skip`, then on
// with the rest), so the sequencer is never left stuck on it and no empty commit is made.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { commitCherryPickRpc, commitCreateRpc, commitRevertRpc } from "../shared/rpc/commit.ts";
import { GitError, isGitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { assertRevision } from "./core/validate.ts";
import { assertNoOperation, hasUnmerged, operationNow } from "./sequencer.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, commitCreateRpc, { kind: "write" }, (input, ctx) => create(ctx, input));
  handle(server, deps, commitRevertRpc, { kind: "write" }, (input, ctx) => replay(ctx, "revert", input));
  handle(server, deps, commitCherryPickRpc, { kind: "write" }, (input, ctx) => replay(ctx, "cherry-pick", input));
}

/** Whether HEAD is on a remote-tracking branch already: amending it would rewrite what was pushed. */
export async function headPushed(tools: GitTools): Promise<boolean> {
  const out = await tools.read(["for-each-ref", "--count=1", "--contains", "HEAD", "--format=%(refname)", "refs/remotes/"]);
  return out.trim() !== "";
}

/** The hooks a commit runs that exist in this repository (core.hooksPath honoured). */
async function commitHooks(tools: GitTools): Promise<string[]> {
  const hooks = (await tools.read(["rev-parse", "--git-path", "hooks"])).trim();
  const folder = resolve(tools.cwd, hooks);
  return ["pre-commit", "prepare-commit-msg", "commit-msg"].filter((name) => existsSync(join(folder, name)));
}

interface CreateInput {
  message: string;
  amend: boolean;
  all: boolean;
  signoff: boolean;
  allowEmpty: boolean;
  confirmAmendPushed?: true;
}

async function create(ctx: HandlerContext, input: CreateInput): Promise<{ hash: string }> {
  const born = (await ctx.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim() !== "";
  if (input.amend) {
    if (!born) throw new GitError("NOTHING_TO_COMMIT", "There is no commit to amend yet");
    if (input.confirmAmendPushed !== true && (await headPushed(ctx))) {
      throw new GitError("CONFIRMATION_REQUIRED", "The last commit is already on a remote: amending it rewrites published history (confirmAmendPushed)");
    }
  }
  // As VS Code's smart commit: everything, untracked files included, when the client asks for it.
  if (input.all) await ctx.git(["add", "--all"]);
  if (!input.amend && !input.allowEmpty) {
    // Said here in so many words: git's own refusal is a status listing, worded differently by version.
    const staged = (await ctx.git(["diff", "--cached", "--quiet"], { kind: "read", accept: [1] })).code === 1;
    const merging = (await ctx.read(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], [1])).trim() !== "";
    if (!staged && !merging) throw new GitError("NOTHING_TO_COMMIT", "nothing to commit: nothing is staged");
  }
  const message = input.message.trim() === "" ? null : input.message;
  const args = [
    "-c",
    "user.useConfigOnly=true",
    "commit",
    ...(input.amend ? ["--amend"] : []),
    ...(input.signoff ? ["--signoff"] : []),
    ...(input.allowEmpty ? ["--allow-empty"] : []),
    ...(message === null ? ["--no-edit"] : ["--file=-"]),
  ];
  try {
    await ctx.git(args, message === null ? {} : { stdin: message });
  } catch (error) {
    // A hook that refuses says so in its own words, which git does not add to: when nothing else explains the failure
    // and a commit hook is there, the hook it was.
    if (isGitError(error) && error.code === "UNKNOWN" && (await commitHooks(ctx)).length > 0) {
      throw new GitError("HOOK_FAILED", error.detail, { cause: error });
    }
    throw error;
  }
  const hash = (await ctx.read(["rev-parse", "--verify", "HEAD"])).trim();
  return { hash };
}

// --- revert and cherry-pick -------------------------------------------------------------------------------

interface ReplayInput {
  hashes: string[];
  noCommit: boolean;
  mainline?: number;
  recordOrigin?: boolean;
}

/** How many parents each commit has, from `git rev-list --no-walk --parents`. */
async function parentCounts(tools: GitTools, hashes: readonly string[]): Promise<Map<string, number>> {
  const out = await tools.read(["rev-list", "--no-walk=unsorted", "--parents", "--end-of-options", ...hashes, "--"]);
  const counts = new Map<string, number>();
  for (const line of out.split(/\r?\n/)) {
    const [hash, ...parents] = line.trim().split(" ");
    if (hash) counts.set(hash, parents.filter(Boolean).length);
  }
  return counts;
}

async function attempt(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

async function replay(ctx: HandlerContext, kind: "revert" | "cherry-pick", input: ReplayInput): Promise<{ conflicted: boolean }> {
  await assertNoOperation(ctx);
  const hashes: string[] = [];
  for (const hash of input.hashes) hashes.push(await assertRevision(ctx.cwd, hash));
  const parents = await parentCounts(ctx, hashes);
  for (const hash of hashes) {
    const count = parents.get(hash) ?? 1;
    if (count > 1 && input.mainline === undefined) {
      throw new GitError("INVALID_ARGUMENT", `${hash.slice(0, 7)} is a merge commit: choose the parent to compare it with (mainline)`);
    }
    if (input.mainline !== undefined && input.mainline > count) {
      throw new GitError("INVALID_ARGUMENT", `${hash.slice(0, 7)} has ${count} parent(s): there is no parent ${input.mainline}`);
    }
  }
  const args = [
    "-c",
    "user.useConfigOnly=true",
    kind,
    "--no-edit",
    ...(input.noCommit ? ["--no-commit"] : []),
    ...(input.mainline !== undefined ? ["-m", String(input.mainline)] : []),
    ...(kind === "cherry-pick" && input.recordOrigin === true ? ["-x"] : []),
    "--end-of-options",
    ...hashes,
  ];
  let failure = await attempt(() => ctx.git(args));
  // Each round leaves out one commit that turned out empty; there cannot be more rounds than commits.
  for (let round = 0; failure !== null && round <= hashes.length; round++) {
    if (await hasUnmerged(ctx)) return { conflicted: true };
    if ((await operationNow(ctx)).kind !== kind) throw failure; // it failed before it began (local changes in the way…)
    const empty = (await ctx.git(["diff", "--cached", "--quiet"], { kind: "read", accept: [1] })).code === 0;
    if (!empty) throw failure; // stopped for another reason: a hook, say
    failure = await attempt(() => ctx.git(["-c", "user.useConfigOnly=true", kind, "--skip"]));
  }
  if (failure !== null) throw failure;
  return { conflicted: false };
}
