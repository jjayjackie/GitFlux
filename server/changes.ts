// The working tree and the index: staging, unstaging, discarding, deleting and ignoring whole files or hunks and lines
// of them, and finding the conflict markers left in them.
//
// Paths come from the client relative to the repository's root; each is checked to stay inside it (core/validate.ts)
// and always goes after `--`, with `--literal-pathspecs` so that a file named like a pathspec (`:(glob)*`) is that
// file. A file the plugin reads or writes itself (.gitignore, a file searched for markers) must not lead out of the
// root through a symlink either.
//
// Hunks. A file's diff is read from `git diff` with every option that shapes its text pinned on the command line
// (no colour, no external diff or textconv, a/ and b/ prefixes, three lines of context, renames only when the client
// names a rename's two paths), as bytes: server/patch.ts keeps them as they are, so CRLF line ends and text in any
// encoding go back to `git apply` unchanged, and nothing here touches the user's line-ending configuration. Applying
// re-reads the diff, finds each hunk by its id (STALE_STATE when one is gone), builds a patch of the chosen hunks and
// lines with git's own file header, and feeds it to `git apply` on stdin:
//   stage    the unstaged diff, `git apply --cached`
//   unstage  the staged diff, `git apply --cached --reverse`
//   discard  the unstaged diff, a safety snapshot, then `git apply --reverse` on the work tree
// with `--whitespace=nowarn --recount`, and context kept so that git checks the patch still fits. A patch git refuses
// means the file changed meanwhile: STALE_STATE, with git's words.
// An untracked file shows as one hunk adding every line, read from the file (DIFF_MAX_BYTES at most). Staging all of it
// is `git add`; staging part of it is `git add --intent-to-add` first (the diff then has that hunk), undone when the
// rest fails. Discarding hunks of an untracked file is refused: git.changes.discard deletes it.
// A rename's section is applied as git wrote it: unstaging part of a staged rename also undoes the rename.

import { appendFile, lstat, open, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { BINARY_SNIFF_BYTES, CONFLICT_SIDE_MAX_BYTES, DIFF_MAX_BYTES, HUNKS_MAX } from "../shared/limits.ts";
import {
  changesApplyHunksRpc,
  changesDiscardRpc,
  changesHunksRpc,
  changesIgnoreRpc,
  changesMarkersRpc,
  changesRemoveRpc,
  changesStageRpc,
  changesUnstageRpc,
  type FileHunks,
  type HunkSelection,
} from "../shared/rpc/changes.ts";
import type { FileChange } from "../shared/schemas.ts";
import { GitError, isGitError } from "./core/errors.ts";
import { chunkPaths, onPaths, runTool, type GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { redact } from "./core/sanitize.ts";
import { assertInside, resolveInside } from "./core/validate.ts";
import { additionHunks, buildPatch, parsePatch, toHunk, type PatchFile, type PatchHunk } from "./patch.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, changesStageRpc, { kind: "write" }, async ({ files }, ctx) => {
    await onPaths(ctx.git, ["--literal-pathspecs", "add", "--all"], pathsOf(ctx, files));
    return {};
  });
  handle(server, deps, changesUnstageRpc, { kind: "write" }, async ({ files }, ctx) => {
    await unstage(ctx, files);
    return {};
  });
  handle(server, deps, changesDiscardRpc, { kind: "write" }, ({ files, trash }, ctx) => discard(ctx, files, trash));
  handle(server, deps, changesRemoveRpc, { kind: "write" }, async ({ files }, ctx) => {
    await onPaths(ctx.git, ["--literal-pathspecs", "rm", "--quiet"], pathsOf(ctx, files));
    return {};
  });
  handle(server, deps, changesIgnoreRpc, { kind: "write", index: false }, async ({ paths }, ctx) => {
    await ignore(ctx, paths);
    return {};
  });
  handle(server, deps, changesMarkersRpc, { kind: "read" }, async ({ paths }, ctx) => ({ paths: await markers(ctx, paths) }));
  handle(server, deps, changesHunksRpc, { kind: "read" }, ({ file, staged }, ctx) => hunks(ctx, file, staged));
  handle(server, deps, changesApplyHunksRpc, { kind: "write" }, async (input, ctx) => {
    await applyHunks(ctx, input);
    return {};
  });
}

/** A rename is two paths to git. Each is checked to stay inside the repository. */
export function pathsOf(ctx: { cwd: string }, files: readonly FileChange[]): string[] {
  const paths = files.flatMap((file) => (file.from ? [file.from, file.path] : [file.path]));
  for (const path of paths) assertInside(ctx.cwd, path);
  return paths;
}

async function unstage(ctx: HandlerContext, files: readonly FileChange[]): Promise<void> {
  const born = (await ctx.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim() !== "";
  // Before the first commit there is no HEAD to restore the index from.
  await onPaths(ctx.git, born ? ["--literal-pathspecs", "restore", "--staged"] : ["--literal-pathspecs", "rm", "--cached", "--quiet"], pathsOf(ctx, files));
}

async function discard(ctx: HandlerContext, files: readonly FileChange[], trash: boolean): Promise<{ trashFailed: boolean }> {
  const untracked = pathsOf(
    ctx,
    files.filter((file) => file.status === "?"),
  );
  const tracked = pathsOf(
    ctx,
    files.filter((file) => file.status !== "?"),
  );
  if (tracked.length) {
    await ctx.snapshot(); // tracked changes are recorded first (safetySnapshots)
    await onPaths(ctx.git, ["--literal-pathspecs", "restore", "--worktree"], tracked);
  }
  if (!untracked.length) return { trashFailed: false };
  if (!trash) {
    // Deleting for good, as VS Code does when there is no Trash: git removes only untracked, unignored files at these
    // paths. clean.requireForce is lifted for this one command instead of passing --force.
    await onPaths(ctx.git, ["--literal-pathspecs", "-c", "clean.requireForce=false", "clean", "--quiet"], untracked);
    return { trashFailed: false };
  }
  try {
    await toTrash(ctx, untracked);
  } catch (error) {
    // As in VS Code, the panel then asks whether to delete them for good.
    console.warn(`[gitflux] could not move to the Trash: ${redact(error instanceof Error ? error.message : String(error))}`);
    return { trashFailed: true };
  }
  return { trashFailed: false };
}

/** Moves files to the Trash with the `trash` command macOS has had since 15. No other system is known to have one. */
async function toTrash(ctx: HandlerContext, paths: readonly string[]): Promise<void> {
  if (process.platform !== "darwin") throw new GitError("UNKNOWN", `No Trash is known on ${process.platform}`);
  for (const path of paths) await resolveInside(ctx.cwd, path, { real: true, followLast: false });
  // Absolute paths: one can never be read as an option.
  const absolute = paths.map((path) => join(ctx.cwd, path));
  for (const chunk of chunkPaths(absolute)) await runTool("/usr/bin/trash", chunk, { cwd: ctx.cwd, timeoutMs: ctx.deps.deadlines.write });
}

/** Adds paths to the repository's .gitignore, a line each, as VS Code's Add to .gitignore writes them. */
async function ignore(ctx: HandlerContext, paths: readonly string[]): Promise<void> {
  for (const path of paths) assertInside(ctx.cwd, path);
  const file = await resolveInside(ctx.cwd, ".gitignore", { real: true });
  const end = await lastByte(file);
  const lines = paths.map((path) => path.replace(/\\|\[/g, (match) => (match === "\\" ? "/" : `\\${match}`)));
  await appendFile(file, (end === null || end === "\n" ? "" : "\n") + lines.join("\n") + "\n");
}

/** The last character of a file, or null when it is empty or not there. */
async function lastByte(path: string): Promise<string | null> {
  let file;
  try {
    file = await open(path, "r");
  } catch {
    return null;
  }
  try {
    const { size } = await file.stat();
    if (size === 0) return null;
    const buffer = Buffer.alloc(1);
    await file.read(buffer, 0, 1, size - 1);
    return buffer.toString("latin1");
  } finally {
    await file.close().catch(() => {});
  }
}

const MARKER = /^<{7}\s|^={7}$|^>{7}\s/m; // VS Code's test for a conflict left in a file

/** The paths whose files still hold a conflict marker, read up to CONFLICT_SIDE_MAX_BYTES each. A file not there holds none. */
async function markers(ctx: HandlerContext, paths: readonly string[]): Promise<string[]> {
  const marked: string[] = [];
  for (const path of paths) {
    const absolute = await resolveInside(ctx.cwd, path, { real: true });
    let text: string | null = null;
    try {
      const info = await stat(absolute);
      if (!info.isFile()) continue;
      const file = await open(absolute, "r");
      try {
        const buffer = Buffer.alloc(Math.min(info.size, CONFLICT_SIDE_MAX_BYTES));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        text = buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await file.close().catch(() => {});
      }
    } catch {
      text = null;
    }
    if (text !== null && MARKER.test(text.replace(/\r\n/g, "\n"))) marked.push(path);
  }
  return marked;
}

// --- hunks ---------------------------------------------------------------------------------------------

/** Room for both sides of a file at DIFF_MAX_BYTES each, and the diff's own marks. */
const DIFF_READ_MAX = 2 * DIFF_MAX_BYTES + 1024 * 1024;

/** `git diff` of some paths, its text pinned whatever the user's configuration says (see the top of this file). */
function diffArgs(staged: boolean, paths: readonly string[], renames: boolean): string[] {
  return [
    "--literal-pathspecs",
    "-c",
    "diff.relative=false",
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--submodule=short",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--unified=3",
    renames ? "-M" : "--no-renames",
    ...(staged ? ["--cached"] : []),
    "--",
    ...paths,
  ];
}

/** The file's diff as file sections, read as bytes (one latin1 character each: see server/patch.ts). */
async function readPatch(tools: GitTools, staged: boolean, file: { path: string; from?: string }): Promise<PatchFile[]> {
  const paths = pathsOf(tools, [{ path: file.path, from: file.from, status: "M" }]);
  const { stdout } = await tools.buffer(diffArgs(staged, paths, file.from !== undefined), { kind: "read", maxBytes: DIFF_READ_MAX });
  return parsePatch(stdout.toString("latin1"));
}

type Untracked = { binary: true } | { binary: false; text: string };

/**
 * An untracked file's content (latin1, as git's diff would carry it), or null when git tracks the path. A symlink is
 * its target's name, as git shows one; anything that is not a file (a nested repository) has no lines.
 */
async function untrackedContent(tools: GitTools, path: string): Promise<Untracked | null> {
  const tracked = await tools.read(["--literal-pathspecs", "ls-files", "-z", "--", path]);
  if (tracked !== "") return null;
  const absolute = await resolveInside(tools.cwd, path, { real: true, followLast: false });
  let info;
  try {
    info = await lstat(absolute);
  } catch {
    throw new GitError("STALE_STATE", `${path} is not in the working tree any more`);
  }
  if (info.isSymbolicLink()) return { binary: false, text: (await readlink(absolute, { encoding: "buffer" })).toString("latin1") };
  if (!info.isFile()) return { binary: false, text: "" };
  if (info.size > DIFF_MAX_BYTES) throw new GitError("OUTPUT_TOO_LARGE", `${path} is larger than ${DIFF_MAX_BYTES} bytes: stage it whole`);
  const fd = await open(absolute, "r");
  try {
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await fd.read(buffer, 0, info.size, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { binary: true }; // git's own test
    return { binary: false, text: bytes.toString("latin1") };
  } finally {
    await fd.close().catch(() => {});
  }
}

async function hunks(ctx: HandlerContext, file: FileChange, staged: boolean): Promise<FileHunks> {
  if (!staged && file.status === "?" && file.from === undefined) {
    const untracked = await untrackedContent(ctx, file.path);
    if (untracked !== null) {
      if (untracked.binary) return { hunks: [], binary: true, truncated: false };
      return { hunks: additionHunks(untracked.text).map(toHunk), binary: false, truncated: false };
    }
  }
  const files = await readPatch(ctx, staged, file);
  const all = files.flatMap((section) => section.hunks);
  return {
    hunks: all.slice(0, HUNKS_MAX).map(toHunk),
    binary: files.some((section) => section.binary),
    truncated: all.length > HUNKS_MAX,
  };
}

/** Whether the selections take every line of `hunk`. */
function takesAll(hunk: PatchHunk, selections: readonly HunkSelection[]): boolean {
  const chosen = new Set<number>();
  for (const selection of selections) {
    if (selection.id !== hunk.id) continue;
    if (selection.lines === undefined) return true;
    for (const index of selection.lines) chosen.add(index);
  }
  return hunk.lines.every((line, index) => line.kind === "context" || chosen.has(index));
}

const stale = (detail: string, cause?: unknown) =>
  new GitError("STALE_STATE", `${detail}: the file changed since its hunks were read; read them again`, cause === undefined ? {} : { cause });

interface ApplyInput {
  path: string;
  from?: string;
  hunks: HunkSelection[];
  action: "stage" | "unstage" | "discard";
}

async function applyHunks(ctx: HandlerContext, input: ApplyInput): Promise<void> {
  const file = { path: input.path, from: input.from };
  pathsOf(ctx, [{ ...file, status: "M" }]);
  let intent = false; // an untracked file was added with --intent-to-add for this call

  if (input.action !== "unstage" && input.from === undefined) {
    const untracked = await untrackedContent(ctx, input.path);
    if (untracked !== null) {
      if (input.action === "discard") throw new GitError("INVALID_ARGUMENT", `${input.path} is untracked: discard the whole file instead`);
      const synthetic = untracked.binary ? [] : additionHunks(untracked.text);
      const known = new Set(synthetic.map((hunk) => hunk.id));
      const unknown = input.hunks.find((selection) => !known.has(selection.id));
      if (unknown !== undefined) throw stale(`No hunk ${unknown.id} in ${input.path}`);
      if (synthetic.every((hunk) => takesAll(hunk, input.hunks))) {
        await ctx.git(["--literal-pathspecs", "add", "--", input.path]);
        return;
      }
      await ctx.git(["--literal-pathspecs", "add", "--intent-to-add", "--", input.path]);
      intent = true;
    }
  }

  const undoIntent = async () => {
    if (!intent) return;
    try {
      await ctx.git(["--literal-pathspecs", "rm", "--cached", "--quiet", "--", input.path]);
    } catch (error) {
      console.warn(`[gitflux] could not take ${input.path} out of the index again: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
  };

  try {
    const files = await readPatch(ctx, input.action === "unstage", file);
    const { patch, missing } = buildPatch(files, input.hunks, input.action === "stage" ? "forward" : "reverse");
    if (missing.length > 0) throw stale(`No hunk ${missing[0]} in ${input.path}`);
    if (patch === null) throw new GitError("INVALID_ARGUMENT", "The selection holds no added or deleted line");
    if (input.action === "discard") await ctx.snapshot(); // tracked changes are recorded first (safetySnapshots)
    const args =
      input.action === "stage"
        ? ["apply", "--cached", "--whitespace=nowarn", "--recount", "-"]
        : input.action === "unstage"
          ? ["apply", "--cached", "--reverse", "--whitespace=nowarn", "--recount", "-"]
          : ["apply", "--reverse", "--whitespace=nowarn", "--recount", "-"];
    try {
      await ctx.git(args, { stdin: Buffer.from(patch, "latin1") });
    } catch (error) {
      // git refuses a patch that no longer fits the index or the file: something changed them meanwhile.
      if (isGitError(error) && error.code === "UNKNOWN") throw stale(error.detail, error);
      throw error;
    }
  } catch (error) {
    await undoIntent();
    throw error;
  }
}
