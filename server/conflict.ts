// Resolving conflicts: the sides of a file in conflict, and taking one of them (or the merged text).
//
// Sides come from the index (`git ls-files --unmerged` names each stage's blob, `git cat-file blob` reads it) and the
// work tree, each read up to CONFLICT_SIDE_MAX_BYTES. Their labels are git's own names for them:
//   merge         ours: the checked-out branch (or HEAD); theirs: the name MERGE_MSG gives ("Merge branch 'side'"),
//                 else the merged commit as "a1b2c3d (subject)"
//   rebase        ours: the commit being replayed onto, by a branch or tag that points at it when HEAD is still there,
//                 else HEAD as it is now (onto plus the commits already replayed); theirs: the commit being replayed
//   cherry-pick   ours: the branch (or HEAD); theirs: the commit being picked
//   revert        ours: the branch (or HEAD); theirs: "parent of a1b2c3d (subject)", as git's markers say
// and an empty theirs label when git keeps no name for it (a conflict left by `git stash apply`).
//
// Resolutions, for paths that are in conflict now (STALE_STATE for any that is not):
//   ours / theirs   `git checkout --ours|--theirs -- <paths>` then `git add`; where that side deleted the file (its
//                   stage is absent), `git rm` instead
//   mark-resolved   `git add --all -- <paths>` (a file deleted in the work tree is staged as deleted)
//   delete          `git rm -- <paths>`: git removes an unmerged path from the index and the work tree without
//                   `--force` (its check for local changes skips unmerged entries)
//   content         the text written as the file (inside the root, never through a symlink out of it; a temporary file
//                   in the same folder renamed over it), then `git add`

import { existsSync } from "node:fs";
import { lstat, mkdir, open, readlink, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { BINARY_SNIFF_BYTES, CONFLICT_SIDE_MAX_BYTES } from "../shared/limits.ts";
import { conflictResolveRpc, conflictSidesRpc, type ConflictSides } from "../shared/rpc/conflict.ts";
import { GitError } from "./core/errors.ts";
import { onPaths, type GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { assertInside, resolveInside } from "./core/validate.ts";
import { currentBranch, describeCommit, hashIn, operationNow, readGitFile, unmergedStages, type Stage, type UnmergedFile } from "./sequencer.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, conflictSidesRpc, { kind: "read" }, ({ path }, ctx) => sides(ctx, path));
  handle(server, deps, conflictResolveRpc, { kind: "write" }, async (input, ctx) => {
    if (input.resolution === "content") await writeResolution(ctx, input.path, input.content);
    else await resolve(ctx, input.paths, input.resolution);
    return {};
  });
}

/** The files among `paths` in conflict now, every one of them; STALE_STATE for the first that is not. */
async function inConflict(tools: GitTools, paths: readonly string[]): Promise<Map<string, UnmergedFile>> {
  for (const path of paths) assertInside(tools.cwd, path);
  const files = await unmergedStages(tools, paths);
  const missing = paths.find((path) => !files.has(path));
  if (missing !== undefined) throw new GitError("STALE_STATE", `${missing} is not in conflict`);
  return files;
}

// --- sides ---------------------------------------------------------------------------------------------

interface Text {
  text: string;
  binary: boolean;
  truncated: boolean;
}

const binaryBytes = (bytes: Buffer) => bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);

/** A stage's blob, read up to CONFLICT_SIDE_MAX_BYTES. A submodule's stage is a commit, shown as git shows one. */
async function readStage(tools: GitTools, stage: Stage | null): Promise<Text | null> {
  if (stage === null) return null;
  if (stage.mode === "160000") return { text: `Subproject commit ${stage.hash}\n`, binary: false, truncated: false };
  const size = Number((await tools.read(["cat-file", "-s", stage.hash])).trim());
  if (Number.isFinite(size) && size <= CONFLICT_SIDE_MAX_BYTES) {
    const { stdout } = await tools.buffer(["cat-file", "blob", stage.hash], { kind: "read", maxBytes: CONFLICT_SIDE_MAX_BYTES + 1 });
    return { text: stdout.toString("utf8"), binary: binaryBytes(stdout), truncated: false };
  }
  // Too large: its first lines only, git stopped once enough is read.
  let text = "";
  await tools.stream(["cat-file", "blob", stage.hash], {
    delimiter: "\n",
    onRecord: (record) => {
      text += `${record}\n`;
      return text.length < CONFLICT_SIDE_MAX_BYTES;
    },
  });
  return { text: text.slice(0, CONFLICT_SIDE_MAX_BYTES), binary: text.slice(0, BINARY_SNIFF_BYTES).includes("\0"), truncated: true };
}

/** The work-tree file with its markers, read up to CONFLICT_SIDE_MAX_BYTES; null when it is not there. */
async function readMerged(root: string, path: string): Promise<Text | null> {
  const absolute = await resolveInside(root, path, { real: true, followLast: false });
  let info;
  try {
    info = await lstat(absolute);
  } catch {
    return null;
  }
  if (info.isSymbolicLink()) return { text: await readlink(absolute), binary: false, truncated: false };
  if (!info.isFile()) return null;
  const file = await open(absolute, "r");
  try {
    const buffer = Buffer.alloc(Math.min(info.size, CONFLICT_SIDE_MAX_BYTES));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    return { text: bytes.toString("utf8"), binary: binaryBytes(bytes), truncated: info.size > CONFLICT_SIDE_MAX_BYTES };
  } finally {
    await file.close().catch(() => {});
  }
}

/** What the branches or commits a branch-like name points at are called: a branch, else a tag, else the commit. */
async function nameOf(tools: GitTools, hash: string): Promise<string> {
  const out = await tools.read(["for-each-ref", `--points-at=${hash}`, "--format=%(refname:short)", "refs/heads/", "refs/remotes/", "refs/tags/"]);
  const name = out.split(/\r?\n/).find((line) => line.trim() !== "" && !line.endsWith("/HEAD"));
  return name?.trim() ?? (await describeCommit(tools, hash));
}

const MERGED_NAME = /^Merge (?:remote-tracking )?(?:branch|tag|commit) '([^'\n]+)'/;

/** The labels of ours and theirs, in git's words, for the operation under way. */
export async function sideLabels(tools: GitTools): Promise<{ oursLabel: string; theirsLabel: string }> {
  const { gitDir, kind } = await operationNow(tools);
  const head = (await currentBranch(tools)) ?? "HEAD";
  const described = async (name: string) => {
    const hash = hashIn(await readGitFile(gitDir, name));
    return hash === null ? "" : describeCommit(tools, hash);
  };
  switch (kind) {
    case "merge": {
      const named = MERGED_NAME.exec((await readGitFile(gitDir, "MERGE_MSG")) ?? "");
      return { oursLabel: head, theirsLabel: named ? named[1] : await described("MERGE_HEAD") };
    }
    case "rebase": {
      const dir = existsSync(join(gitDir, "rebase-merge")) ? "rebase-merge" : "rebase-apply";
      const onto = hashIn(await readGitFile(gitDir, join(dir, "onto")));
      const now = (await tools.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim();
      let ours = "HEAD";
      if (onto !== null && now === onto) ours = await nameOf(tools, onto);
      else if (now !== "") ours = await describeCommit(tools, now);
      return { oursLabel: ours, theirsLabel: await described("REBASE_HEAD") };
    }
    case "cherry-pick":
      return { oursLabel: head, theirsLabel: await described("CHERRY_PICK_HEAD") };
    case "revert": {
      const reverted = await described("REVERT_HEAD");
      return { oursLabel: head, theirsLabel: reverted === "" ? "" : `parent of ${reverted}` };
    }
    default:
      return { oursLabel: head, theirsLabel: "" };
  }
}

async function sides(ctx: HandlerContext, path: string): Promise<ConflictSides> {
  const stages = (await inConflict(ctx, [path])).get(path);
  if (stages === undefined) throw new GitError("STALE_STATE", `${path} is not in conflict`);
  const [base, ours, theirs, merged, labels] = await Promise.all([
    readStage(ctx, stages.base),
    readStage(ctx, stages.ours),
    readStage(ctx, stages.theirs),
    readMerged(ctx.cwd, path),
    sideLabels(ctx),
  ]);
  const all = [base, ours, theirs, merged].filter((side): side is Text => side !== null);
  const binary = all.some((side) => side.binary);
  const text = (side: Text | null) => (side === null || binary ? null : side.text);
  return {
    base: text(base),
    ours: text(ours),
    theirs: text(theirs),
    merged: text(merged),
    ...labels,
    binary,
    truncated: !binary && all.some((side) => side.truncated),
  };
}

// --- resolving -------------------------------------------------------------------------------------------

async function resolve(ctx: HandlerContext, paths: readonly string[], resolution: "ours" | "theirs" | "mark-resolved" | "delete"): Promise<void> {
  const files = await inConflict(ctx, paths);
  if (resolution === "mark-resolved") {
    await onPaths(ctx.git, ["--literal-pathspecs", "add", "--all"], paths);
    return;
  }
  if (resolution === "delete") {
    await onPaths(ctx.git, ["--literal-pathspecs", "rm", "--quiet"], paths);
    return;
  }
  const kept = paths.filter((path) => files.get(path)?.[resolution] != null);
  const gone = paths.filter((path) => files.get(path)?.[resolution] == null);
  if (kept.length > 0) {
    await onPaths(ctx.git, ["--literal-pathspecs", "checkout", `--${resolution}`], kept);
    await onPaths(ctx.git, ["--literal-pathspecs", "add", "--all"], kept);
  }
  // That side deleted the file: taking it is deleting it.
  if (gone.length > 0) await onPaths(ctx.git, ["--literal-pathspecs", "rm", "--quiet"], gone);
}

let temporary = 0; // tells apart two temporary files made in the same millisecond

async function writeResolution(ctx: HandlerContext, path: string, content: string): Promise<void> {
  await inConflict(ctx, [path]);
  // The file itself is replaced, never followed: a symlink in conflict becomes the file written.
  const absolute = await resolveInside(ctx.cwd, path, { real: true, followLast: false });
  const folder = dirname(absolute);
  await mkdir(folder, { recursive: true });
  let mode = 0o666;
  try {
    const info = await lstat(absolute);
    if (info.isFile()) mode = info.mode & 0o777;
  } catch {
    // not in the work tree: a new file
  }
  const temp = join(folder, `.${basename(absolute)}.gitflux-${process.pid}-${Date.now()}-${temporary++}.tmp`);
  try {
    await writeFile(temp, content, { encoding: "utf8", mode, flag: "wx" });
    await rename(temp, absolute);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw new GitError("UNKNOWN", `${path} could not be written: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  await onPaths(ctx.git, ["--literal-pathspecs", "add", "--all"], [path]);
}
