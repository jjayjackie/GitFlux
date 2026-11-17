// Making commits.
//
// git.commit.create commits as VS Code does: with the identity git is told (user.useConfigOnly: never one guessed from
// the machine), the message on stdin (`-F -`, so a long message never meets a command-line limit), hooks run
// (`--no-verify` is never used). Amending a commit a remote-tracking branch already has rewrites published history and
// needs `confirmAmendPushed`. It concludes a merge, cherry-pick or revert under way, as `git commit` does, and never
// continues a rebase (that is git.operation.control).
//
// Still to write (registered with notImplemented): git.commit.revert, git.commit.cherry-pick.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { commitCherryPickRpc, commitCreateRpc, commitRevertRpc } from "../shared/rpc/commit.ts";
import { GitError, isGitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { handle, notImplemented, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, commitCreateRpc, { kind: "write" }, (input, ctx) => create(ctx, input));
  notImplemented(server, deps, commitRevertRpc);
  notImplemented(server, deps, commitCherryPickRpc);
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
