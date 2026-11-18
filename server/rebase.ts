// Interactive rebase: the plan (todo list) and starting it.
//
// The plan is what `git rebase -i <base>` would list: the commits from `base` (exclusive) to HEAD, merges left out,
// oldest first (`git log --topo-order --no-merges`, read newest first and turned round), each marked `pushed` when a
// remote-tracking branch has it (`git rev-list <base>..HEAD --not --remotes` lists those none has).
//
// Starting it writes the user's todo list to a file and has git take it: GIT_SEQUENCE_EDITOR is `cp '<that file>'`,
// which git runs through its shell (Git for Windows' sh too) as `cp '<file>' <git's todo file>`, and GIT_EDITOR is
// `true`, so a squash keeps git's combined message and nothing waits on an editor. Todo lines are
// `pick|edit|squash|fixup|drop <full hash>`; a reword is `pick <hash>` followed by
// `exec git commit --amend --allow-empty --quiet --file='<message file>'`, its message in a file of its own, so that
// hooks run as for any commit (`--no-verify` is never used).
//
// Those files must outlive a rebase that stops (on a conflict, at an `edit`) and is continued later: they live in
// `<git dir>/gitflux/rebase-<id>/` (the work tree's own git dir, files 0600), and `cleanupRebaseFiles` removes
// every such folder once no rebase is under way, after git.rebase.start and after every git.operation.control (and
// before a new start, for a rebase that ended outside the plugin). The `gitflux` folder goes when it is empty.
//
// Refusals: OPERATION_IN_PROGRESS when anything is under way; STALE_STATE when the todo does not name exactly the
// commits the plan lists now; PROTECTED_BRANCH when the checked-out branch is protected and a commit that would be
// rewritten is pushed; CONFIRMATION_REQUIRED for that without `confirmPublished`. The commits rewritten are those from
// the first item that is not the original commit picked in its original place (all of them when the range holds a
// merge, which a rebase flattens). A plan that rewrites nothing is done without running git.

import { mkdir, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { output as ZodOutput } from "zod";
import { REBASE_TODO_MAX } from "../shared/limits.ts";
import { rebasePlanRpc, rebaseStartRpc, type RebaseCommit, type RebasePlan } from "../shared/rpc/rebase.ts";
import { isProtectedBranch } from "../shared/settings.ts";
import { GitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { assertRevision } from "./core/validate.ts";
import { assertNoOperation, currentBranch, hasUnmerged, operationNow } from "./sequencer.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, rebasePlanRpc, { kind: "read" }, ({ base }, ctx) => plan(ctx, base));
  handle(server, deps, rebaseStartRpc, { kind: "write" }, (input, ctx) => start(ctx, input));
}

// --- the plan -------------------------------------------------------------------------------------------

const FIELD = "\x1f";
const RECORD = "\x1e";

/** Reads `git log --format=%H%x1f%an%x1f%at%x1f%s%x1e` records. */
export function parsePlanLog(out: string): Array<Omit<RebaseCommit, "pushed">> {
  const commits: Array<Omit<RebaseCommit, "pushed">> = [];
  for (const record of out.split(RECORD)) {
    const fields = record.replace(/^\n+/, "").split(FIELD);
    if (fields.length < 4 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(fields[0])) continue;
    commits.push({ hash: fields[0], author: fields[1], time: Number(fields[2]) || 0, subject: fields.slice(3).join(FIELD) });
  }
  return commits;
}

async function headHash(tools: GitTools): Promise<string> {
  const head = (await tools.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim();
  if (head === "") throw new GitError("INVALID_ARGUMENT", "There is no commit yet to rebase");
  return head;
}

export async function plan(tools: GitTools, base: string): Promise<RebasePlan> {
  const baseHash = await assertRevision(tools.cwd, base);
  const head = await headHash(tools);
  const ancestor = (await tools.git(["merge-base", "--is-ancestor", baseHash, head], { kind: "read", accept: [1] })).code === 0;
  if (!ancestor) throw new GitError("INVALID_ARGUMENT", `${base} is not an ancestor of HEAD: an interactive rebase rewrites the commits after it`);
  const range = `${baseHash}..${head}`;
  const limit = `--max-count=${REBASE_TODO_MAX + 1}`;
  const [logOut, unpushedOut, mergesOut] = await Promise.all([
    tools.read(["log", "--topo-order", "--no-merges", limit, "--no-show-signature", `--format=%H%x1f%an%x1f%at%x1f%s%x1e`, range, "--"]),
    tools.read(["rev-list", "--topo-order", limit, range, "--not", "--remotes", "--"]),
    tools.read(["rev-list", "--merges", "--max-count=1", range, "--"]),
  ]);
  const newestFirst = parsePlanLog(logOut);
  const truncated = newestFirst.length > REBASE_TODO_MAX;
  const unpushed = new Set(unpushedOut.split(/\r?\n/).map((line) => line.trim()));
  const commits = newestFirst
    .slice(0, REBASE_TODO_MAX)
    .reverse()
    .map((commit) => ({ ...commit, pushed: !unpushed.has(commit.hash) }));
  return { base: baseHash, commits, pushed: commits.some((commit) => commit.pushed), merges: mergesOut.trim() !== "", truncated };
}

// --- the files a rebase keeps ---------------------------------------------------------------------------------

const FOLDER = "gitflux";
const PREFIX = "rebase-";

/** Removes every rebase-* folder this plugin left in the work tree's git dir, unless a rebase is under way. */
export async function cleanupRebaseFiles(tools: GitTools): Promise<void> {
  const { gitDir, kind } = await operationNow(tools);
  if (kind === "rebase") return;
  const folder = join(gitDir, FOLDER);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch {
    return; // none
  }
  for (const name of names) if (name.startsWith(PREFIX)) await rm(join(folder, name), { recursive: true, force: true });
  await rmdir(folder).catch(() => {}); // only when nothing else is in it
}

/** `text` quoted for sh: single quotes, a single quote inside written as '\''. */
export function shQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** A path as sh takes it on every system: forward slashes (Git for Windows' sh reads C:/x/y). */
const forSh = (path: string) => path.replace(/\\/g, "/");

type TodoItem = ZodOutput<typeof rebaseStartRpc.input>["todo"][number];

/** The todo list git is given, and the message files its rewords read, written into `folder`. */
export async function writeTodo(folder: string, todo: readonly TodoItem[]): Promise<string> {
  const lines: string[] = [];
  for (const [index, item] of todo.entries()) {
    if (item.action === "reword") {
      const file = join(folder, `message-${index}`);
      await writeFile(file, item.message, { encoding: "utf8", mode: 0o600 });
      lines.push(`pick ${item.hash}`, `exec git commit --amend --allow-empty --quiet --file=${shQuote(forSh(file))}`);
    } else {
      lines.push(`${item.action} ${item.hash}`);
    }
  }
  const todoFile = join(folder, "todo");
  await writeFile(todoFile, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  return todoFile;
}

let sequence = 0; // tells apart two folders made in the same millisecond

// --- starting it ------------------------------------------------------------------------------------------

type StartInput = ZodOutput<typeof rebaseStartRpc.input>;

async function start(ctx: HandlerContext, input: StartInput): Promise<{ state: "done" | "conflict" | "stopped" }> {
  await assertNoOperation(ctx);
  await cleanupRebaseFiles(ctx); // what a rebase that ended outside the plugin left
  const current = await plan(ctx, input.base);
  if (current.truncated) throw new GitError("INVALID_ARGUMENT", `More than ${REBASE_TODO_MAX} commits to rebase at once`);

  const planned = new Map(current.commits.map((commit) => [commit.hash, commit]));
  const named = new Set(input.todo.map((item) => item.hash));
  if (named.size !== input.todo.length || named.size !== planned.size || [...named].some((hash) => !planned.has(hash))) {
    throw new GitError("STALE_STATE", "The plan does not name exactly the commits between the base and HEAD now: read it again");
  }
  const first = input.todo.find((item) => item.action !== "drop");
  if (first !== undefined && (first.action === "squash" || first.action === "fixup")) {
    throw new GitError("INVALID_ARGUMENT", "A squash or fixup needs a commit before it");
  }

  // What is rewritten: everything from the first item that is not the original commit picked in its original place.
  const changedAt = current.merges ? 0 : input.todo.findIndex((item, index) => item.action !== "pick" || item.hash !== current.commits[index]?.hash);
  if (changedAt === -1) return { state: "done" }; // the plan is the history as it is
  const rewritten = input.todo.slice(changedAt).map((item) => planned.get(item.hash));
  if (rewritten.some((commit) => commit?.pushed === true)) {
    const branch = await currentBranch(ctx);
    if (branch !== null && isProtectedBranch(branch, (await ctx.policy()).protectedBranches)) {
      throw new GitError("PROTECTED_BRANCH", `${branch} is a protected branch (protectedBranches): its published history is never rewritten through the plugin`);
    }
    if (input.confirmPublished !== true) {
      throw new GitError("CONFIRMATION_REQUIRED", "Commits a remote already has would be rewritten: this rewrites published history (confirmPublished)");
    }
  }

  await ctx.snapshot();
  const { gitDir } = await operationNow(ctx);
  const folder = join(gitDir, FOLDER, `${PREFIX}${Date.now()}-${process.pid}-${sequence++}`);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  let failure: unknown = null;
  try {
    const todoFile = await writeTodo(folder, input.todo);
    await ctx.git(["rebase", "--interactive", input.autostash ? "--autostash" : "--no-autostash", "--end-of-options", current.base], {
      env: { GIT_SEQUENCE_EDITOR: `cp ${shQuote(forSh(todoFile))}`, GIT_EDITOR: "true" },
    });
  } catch (error) {
    failure = error;
  }
  const { kind } = await operationNow(ctx);
  if (kind === "rebase") {
    if (await hasUnmerged(ctx)) return { state: "conflict" };
    // Stopped without a conflict: at an `edit` (git exits 0), or an exec that failed (a hook refused a new message).
    if (failure !== null) throw failure;
    return { state: "stopped" };
  }
  await cleanupRebaseFiles(ctx);
  if (failure !== null) throw failure;
  return { state: "done" };
}
