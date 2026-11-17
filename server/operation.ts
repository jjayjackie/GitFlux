// Continuing, skipping or aborting a merge, rebase, cherry-pick, revert, am or bisect under way.
//
// What is under way is read from the files git keeps (server/repo.ts operationKindOf): NO_OPERATION when nothing is,
// STALE_STATE when it is another operation than the client named. Nothing waits on an editor (GIT_EDITOR=true, from
// core/env.ts): git's prepared message is kept as git would keep it after an editor, comments stripped.
//
//   merge         continue: `git commit --no-edit --cleanup=strip` (what `git merge --continue` does, with the
//                 "# Conflicts:" comments taken out), or `git commit --file=-` with the message given; skip:
//                 INVALID_ARGUMENT (a merge has nothing to skip); abort: `git merge --abort`
//   cherry-pick,  continue: `git <op> --continue`; with a message, the commit being applied is first made with it
//   revert        (`git commit --file=-`: git keeps a picked commit's author), then `--continue` if more are left;
//                 skip / abort: `git <op> --skip|--abort`
//   rebase        continue: `git rebase --continue`; with a message, the step is first committed with it: stopped
//                 at an `edit`, `git commit --amend --file=-`; stopped on a conflict, `git commit --file=-` with the
//                 author and date of the commit being replayed; skip / abort: `git rebase --skip|--abort`
//   am            `git am --continue|--skip|--abort` (a message is not taken)
//   bisect        skip: `git bisect skip`; abort: `git bisect reset`; continue: INVALID_ARGUMENT
//
// `continue` with files still in conflict is MERGE_CONFLICT before git runs. `abort` takes a safety snapshot first.
// After `continue` or `skip` an operation may stop again on the next commit: `{ conflicted, done: false }` is then the
// answer, not a failure. Files a plugin rebase kept are removed once no rebase is under way (server/rebase.ts).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { operationControlRpc } from "../shared/rpc/operation.ts";
import type { Operation } from "../shared/schemas.ts";
import { GitError } from "./core/errors.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { cleanupRebaseFiles } from "./rebase.ts";
import { hasUnmerged, hashIn, operationNow, readGitFile } from "./sequencer.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, operationControlRpc, { kind: "write" }, (input, ctx) => control(ctx, input));
}

interface ControlInput {
  operation: Operation;
  action: "continue" | "skip" | "abort";
  message?: string;
}

const COMMIT = ["-c", "user.useConfigOnly=true", "commit"];

/** Whether anything is staged against HEAD. */
async function staged(ctx: HandlerContext): Promise<boolean> {
  return (await ctx.git(["diff", "--cached", "--quiet"], { kind: "read", accept: [1] })).code === 1;
}

/** The step a rebase stopped on, committed with `message`. */
async function commitRebaseStep(ctx: HandlerContext, message: string): Promise<void> {
  const { gitDir } = await operationNow(ctx);
  if (existsSync(join(gitDir, "rebase-merge", "amend"))) {
    // Stopped at an `edit`: the commit is made; the message (and anything staged) amends it.
    await ctx.git([...COMMIT, "--amend", "--file=-"], { stdin: message });
    return;
  }
  if (!(await staged(ctx))) return; // nothing to commit: `git rebase --continue` says what it makes of that
  const replayed = hashIn(await readGitFile(gitDir, "REBASE_HEAD"));
  const author: string[] = [];
  if (replayed !== null) {
    const [who = "", when = ""] = (await ctx.read(["log", "-1", "--no-show-signature", "--format=%an <%ae>%x00%ad", "--date=raw", "--end-of-options", replayed, "--"])).trim().split("\0");
    if (who.trim() !== "<>") author.push(`--author=${who}`);
    if (/^\d+ [+-]\d{4}$/.test(when)) author.push(`--date=@${when}`); // git's raw form: seconds and zone
  }
  await ctx.git([...COMMIT, ...author, "--file=-"], { stdin: message });
}

async function run(ctx: HandlerContext, kind: Operation, action: ControlInput["action"], message: string | undefined): Promise<void> {
  switch (kind) {
    case "merge":
      if (action === "abort") await ctx.git(["merge", "--abort"]);
      else if (message !== undefined) await ctx.git([...COMMIT, "--file=-"], { stdin: message });
      else await ctx.git([...COMMIT, "--no-edit", "--cleanup=strip"]);
      return;
    case "cherry-pick":
    case "revert":
      if (action === "continue" && message !== undefined) {
        if (await staged(ctx)) await ctx.git([...COMMIT, "--file=-"], { stdin: message });
        // A single pick is over once committed; a sequence of them goes on.
        if ((await operationNow(ctx)).kind !== kind) return;
      }
      await ctx.git(["-c", "user.useConfigOnly=true", kind, `--${action}`]);
      return;
    case "rebase":
      if (action === "continue" && message !== undefined) await commitRebaseStep(ctx, message);
      await ctx.git(["-c", "user.useConfigOnly=true", "rebase", `--${action}`]);
      return;
    case "am":
      await ctx.git(["-c", "user.useConfigOnly=true", "am", `--${action}`]);
      return;
    case "bisect":
      await ctx.git(["bisect", action === "abort" ? "reset" : "skip"]);
      return;
  }
}

async function control(ctx: HandlerContext, input: ControlInput): Promise<{ conflicted: boolean; done: boolean }> {
  const { kind } = await operationNow(ctx);
  if (kind === null) {
    await cleanupRebaseFiles(ctx);
    throw new GitError("NO_OPERATION", `No ${input.operation} is under way`);
  }
  if (kind !== input.operation) throw new GitError("STALE_STATE", `A ${kind} is under way, not a ${input.operation}`);
  if (input.action === "continue" && kind === "bisect") throw new GitError("INVALID_ARGUMENT", "A bisect has no continue: mark the commit good or bad");
  if (input.action === "skip" && kind === "merge") throw new GitError("INVALID_ARGUMENT", "A merge has nothing to skip: continue or abort it");
  if (input.action === "continue" && (await hasUnmerged(ctx))) {
    throw new GitError("MERGE_CONFLICT", "Files are still in conflict: resolve and stage them first");
  }
  if (input.action === "abort") await ctx.snapshot();

  let failure: unknown = null;
  try {
    await run(ctx, kind, input.action, input.action === "continue" ? input.message : undefined);
  } catch (error) {
    failure = error;
  }
  const after = await operationNow(ctx);
  await cleanupRebaseFiles(ctx);
  const underWay = after.kind !== null;
  if (failure !== null) {
    // Stopped again, on the next commit's conflicts: that is the answer, not a failure.
    if (underWay && input.action !== "abort" && (await hasUnmerged(ctx))) return { conflicted: true, done: false };
    throw failure;
  }
  if (!underWay) return { conflicted: false, done: true };
  return { conflicted: await hasUnmerged(ctx), done: false };
}
