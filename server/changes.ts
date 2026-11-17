// The working tree and the index: staging, unstaging, discarding, deleting and ignoring whole files, and finding the
// conflict markers left in them.
//
// Paths come from the client relative to the repository's root; each is checked to stay inside it (core/validate.ts)
// and always goes after `--`, with `--literal-pathspecs` so that a file named like a pathspec (`:(glob)*`) is that
// file. A file the plugin reads or writes itself (.gitignore, a file searched for markers) must not lead out of the
// root through a symlink either.
//
// Still to write (registered with notImplemented): git.changes.hunks, git.changes.apply-hunks.

import { appendFile, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { CONFLICT_SIDE_MAX_BYTES } from "../shared/limits.ts";
import { changesApplyHunksRpc, changesDiscardRpc, changesHunksRpc, changesIgnoreRpc, changesMarkersRpc, changesRemoveRpc, changesStageRpc, changesUnstageRpc } from "../shared/rpc/changes.ts";
import type { FileChange } from "../shared/schemas.ts";
import { GitError } from "./core/errors.ts";
import { chunkPaths, onPaths, runTool } from "./core/exec.ts";
import { handle, notImplemented, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { redact } from "./core/sanitize.ts";
import { assertInside, resolveInside } from "./core/validate.ts";

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
  notImplemented(server, deps, changesHunksRpc);
  notImplemented(server, deps, changesApplyHunksRpc);
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
    console.warn(`[advanced-git] could not move to the Trash: ${redact(error instanceof Error ? error.message : String(error))}`);
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
