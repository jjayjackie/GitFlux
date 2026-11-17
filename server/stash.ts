// Stashes: listing, saving, applying, popping, dropping, clearing, showing.
//
// A stash is named by its commit hash (shared/rpc/stash.ts): every call that acts on one finds its current index in
// the list first, and fails with STALE_STATE when the hash is no longer there. The list is read with a NUL-free
// `--format` of its own (fields split by U+001F, records by U+001E), never git's human wording.
//
// Exported for the unit tests: parseStashList, describeStash, STASH_FORMAT.

import type { output as ZodOutput } from "zod";
import { COMMIT_FILES_MAX, LIST_MAX } from "../shared/limits.ts";
import { stashApplyRpc, stashClearRpc, stashDropRpc, stashListRpc, stashPopRpc, stashSaveRpc, stashShowRpc } from "../shared/rpc/stash.ts";
import type { FileChange, StashEntry } from "../shared/schemas.ts";
import { GitError, isGitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { requireSwitch } from "./core/safety.ts";
import { assertInside } from "./core/validate.ts";
import { changedFiles } from "./history.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, stashListRpc, { kind: "read" }, (_input, ctx) => list(ctx));
  handle(server, deps, stashSaveRpc, { kind: "write" }, (input, ctx) => save(ctx, input));
  handle(server, deps, stashApplyRpc, { kind: "write" }, (input, ctx) => apply(ctx, "apply", input.hash, input.index));
  handle(server, deps, stashPopRpc, { kind: "write" }, (input, ctx) => apply(ctx, "pop", input.hash, input.index));
  handle(server, deps, stashDropRpc, { kind: "write", index: false }, async (input, ctx) => {
    await drop(ctx, input.hash);
    return {};
  });
  handle(server, deps, stashClearRpc, { kind: "write", index: false }, async (_input, ctx) => {
    requireSwitch(await ctx.policy(), "allowForceDelete");
    await ctx.git(["stash", "clear"]);
    return {};
  });
  handle(server, deps, stashShowRpc, { kind: "read" }, (input, ctx) => show(ctx, input.hash));
}

// --- the list --------------------------------------------------------------------------------------

const FIELD = "\x1f";
const RECORD = "\x1e";
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** `git stash list --format=`: the stash commit, its committer time and its reflog subject. */
export const STASH_FORMAT = ["%H", "%ct", "%gs"].join("%x1f") + "%x1e";

/** git's own prefix of a stash's subject: `WIP on <branch>: <commit>` without a message, `On <branch>: <message>` with one. */
const PREFIX = /^(?:WIP on|On) (.*?): ([\s\S]*)$/;

/**
 * A stash's reflog subject read into the message without git's prefix and the branch it was made on: null when it was
 * made on a detached HEAD (`(no branch)`) or the subject has no prefix (`git stash store -m`).
 * A branch name cannot hold ':' (git check-ref-format), so the first ": " ends it.
 */
export function describeStash(subject: string): { message: string; branch: string | null } {
  const match = PREFIX.exec(subject);
  if (!match) return { message: subject, branch: null };
  return { message: match[2], branch: match[1] === "(no branch)" ? null : match[1] };
}

/** Reads `git stash list --format=STASH_FORMAT`, newest first: the n-th record is stash@{n}. */
export function parseStashList(out: string): StashEntry[] {
  const entries: StashEntry[] = [];
  let index = 0;
  for (const raw of out.split(RECORD)) {
    const record = raw.replace(/^[\r\n]+/, "");
    if (record === "") continue;
    const position = index++;
    const [hash = "", time = "", ...rest] = record.split(FIELD);
    if (!HASH.test(hash)) continue;
    const { message, branch } = describeStash(rest.join(FIELD));
    entries.push({ index: position, ref: `stash@{${position}}`, hash, message, branch, time: Number(time) || 0 });
  }
  return entries;
}

async function list(tools: GitTools): Promise<{ stashes: StashEntry[]; truncated: boolean }> {
  // Without refs/stash, `git stash list` prints nothing and succeeds.
  const out = await tools.read(["stash", "list", `--format=${STASH_FORMAT}`, `--max-count=${LIST_MAX + 1}`]);
  const stashes = parseStashList(out);
  return { stashes: stashes.slice(0, LIST_MAX), truncated: stashes.length > LIST_MAX };
}

/** The current index of the stash `hash` (n in stash@{n}), read as the list comes; STALE_STATE when it is not there. */
async function indexOf(tools: GitTools, hash: string): Promise<number> {
  let found = -1;
  let position = 0;
  await tools.stream(["stash", "list", "--format=%H"], {
    delimiter: "\n",
    onRecord: (record) => {
      const value = record.trim();
      if (value === "") return true;
      if (value === hash) {
        found = position;
        return false;
      }
      position++;
      return true;
    },
  });
  if (found === -1) throw new GitError("STALE_STATE", `The stash ${hash} is no longer in the stash list`);
  return found;
}

// --- small facts -------------------------------------------------------------------------------------

/** The commit refs/stash names, or null when there is no stash. */
async function stashTip(tools: GitTools): Promise<string | null> {
  const hash = (await tools.read(["rev-parse", "--verify", "--quiet", "refs/stash"], [1])).trim();
  return hash === "" ? null : hash;
}

async function born(tools: GitTools): Promise<boolean> {
  return (await tools.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim() !== "";
}

/** Whether the index has files in conflict (reads one record at most). */
async function hasUnmerged(tools: GitTools): Promise<boolean> {
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

// --- saving --------------------------------------------------------------------------------------------

type SaveInput = ZodOutput<typeof stashSaveRpc.input>;

async function save(ctx: HandlerContext, input: SaveInput): Promise<{ created: boolean }> {
  // git's own refusal, in git's words, before anything runs.
  if (input.staged && input.includeUntracked) throw new GitError("INVALID_ARGUMENT", "Can't use --staged and --include-untracked or --all at the same time");
  const paths = input.paths ?? [];
  for (const path of paths) assertInside(ctx.cwd, path);
  if (!(await born(ctx))) throw new GitError("REF_NOT_FOUND", "You do not have the initial commit yet");
  if (await hasUnmerged(ctx)) throw new GitError("MERGE_CONFLICT", "Files are in conflict: resolve them before stashing");
  const before = await stashTip(ctx);
  const args = [
    "--literal-pathspecs",
    "stash",
    "push",
    ...(input.message === undefined ? [] : [`--message=${input.message}`]),
    ...(input.includeUntracked ? ["--include-untracked"] : []),
    ...(input.keepIndex ? ["--keep-index"] : []),
    ...(input.staged ? ["--staged"] : []),
  ];
  if (paths.length === 0) await ctx.git(args);
  // One stash for any number of paths: they go on stdin, NUL-separated, never on the command line (so no chunks,
  // which would make one stash per chunk).
  else await ctx.git([...args, "--pathspec-from-file=-", "--pathspec-file-nul"], { stdin: paths.join("\0") });
  // "No local changes to save" succeeds too: whether refs/stash moved is the answer, not git's wording.
  const after = await stashTip(ctx);
  return { created: after !== null && after !== before };
}

// --- applying, popping, dropping ------------------------------------------------------------------------

async function apply(ctx: HandlerContext, verb: "apply" | "pop", hash: string, index: boolean): Promise<{ conflicted: boolean }> {
  // Conflicts already in the index would be taken for this stash's.
  if (await hasUnmerged(ctx)) throw new GitError("MERGE_CONFLICT", "Files are in conflict: resolve them before applying a stash");
  const position = await indexOf(ctx, hash);
  try {
    await ctx.git(["stash", verb, ...(index ? ["--index"] : []), `stash@{${position}}`]);
    return { conflicted: false };
  } catch (error) {
    if (!isGitError(error)) throw error;
    // It applied, with conflicts left in the index; `pop` then keeps the stash, as git does.
    if (await hasUnmerged(ctx)) return { conflicted: true };
    // An untracked file the stash holds is in the way in the work tree.
    if (/already exists, no checkout|could not restore untracked files/i.test(error.detail)) {
      throw new GitError("WOULD_OVERWRITE_CHANGES", error.detail, { cause: error });
    }
    // --index: what was staged does not apply to the index as it is.
    if (/conflicts in index/i.test(error.detail)) throw new GitError("MERGE_CONFLICT", error.detail, { cause: error });
    throw error;
  }
}

async function drop(ctx: HandlerContext, hash: string): Promise<void> {
  const position = await indexOf(ctx, hash);
  const ref = `stash@{${position}}`;
  // Inside the repository's lock, but another git (the user's own) may have moved the list since it was read.
  const now = (await ctx.read(["rev-parse", "--verify", "--quiet", ref], [1])).trim();
  if (now !== hash) throw new GitError("STALE_STATE", `${ref} is no longer the stash ${hash}`);
  await ctx.git(["stash", "drop", "--quiet", ref]);
}

// --- showing ----------------------------------------------------------------------------------------------

/** REF_NOT_FOUND unless `hash` is a stash-like commit: two or three parents, the second the index git recorded. */
async function assertStash(tools: GitTools, hash: string): Promise<void> {
  const commit = (await tools.read(["rev-parse", "--verify", "--quiet", "--end-of-options", `${hash}^{commit}`], [1])).trim();
  if (commit === "") throw new GitError("REF_NOT_FOUND", `${hash} is not a stash-like commit`);
  const parents = (await tools.read(["log", "-1", "--format=%P", "--end-of-options", commit, "--"])).trim().split(" ").filter(Boolean);
  if (parents.length < 2 || parents.length > 3) throw new GitError("REF_NOT_FOUND", `${hash} is not a stash-like commit`);
  const index = (await tools.read(["log", "-1", "--format=%s", "--end-of-options", parents[1], "--"])).trim();
  if (!index.startsWith("index on ")) throw new GitError("REF_NOT_FOUND", `${hash} is not a stash-like commit`);
}

async function show(ctx: HandlerContext, hash: string): Promise<{ files: FileChange[]; truncated: boolean }> {
  await assertStash(ctx, hash);
  // Its tracked changes: the work tree it recorded against the commit it was made on.
  const tracked = await changedFiles(ctx, ["diff", "--find-renames", "--end-of-options", `${hash}^1`, hash, "--"]);
  let files = tracked.files;
  let truncated = tracked.truncated;
  // Stashed with --include-untracked, the untracked files are in a third parent, a commit with no parent of its own.
  // They are listed as added (A): git.diff.file with `{ kind: "stash", hash }` reads an added file from <hash>, and,
  // when <hash> does not have it, from <hash>^3 (server/diff.ts, `sides`).
  const third = (await ctx.read(["rev-parse", "--verify", "--quiet", "--end-of-options", `${hash}^3^{commit}`], [1])).trim();
  if (third !== "" && files.length < COMMIT_FILES_MAX) {
    // The empty tree in this repository's hash function, computed (nothing is written).
    const empty = (await ctx.git(["hash-object", "-t", "tree", "--stdin"], { kind: "read", stdin: "" })).stdout.trim();
    const untracked = await changedFiles(ctx, ["diff", "--no-renames", "--end-of-options", empty, third, "--"]);
    files = [...files, ...untracked.files.map((file): FileChange => ({ ...file, status: "A" }))];
    truncated ||= untracked.truncated;
  } else if (third !== "") {
    truncated = true;
  }
  if (files.length > COMMIT_FILES_MAX) {
    files = files.slice(0, COMMIT_FILES_MAX);
    truncated = true;
  }
  return { files, truncated };
}
