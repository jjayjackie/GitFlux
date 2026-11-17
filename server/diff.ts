// Compares two versions of a file as VS Code's diff editor does: with its own algorithm, from the vscode-diff package
// (the same results as VS Code 1.142's on the files tried), and the editor's defaults. A file that is there on one side
// only is shown as itself, as VS Code opens it.
//
// Each side is read up to DIFF_MAX_BYTES (`too-large` past it) and compared up to DIFF_MAX_LINES lines (`truncated`).
// A work-tree file is read only inside the repository's root: a symlink is shown as its target's name, as git shows it,
// never followed. With `highlight`, sides up to HIGHLIGHT_MAX_BYTES come with syntax tokens (server/highlight.ts).

import { lstat, open, readlink } from "node:fs/promises";
import { DefaultLinesDiffComputer } from "vscode-diff";
import { BINARY_SNIFF_BYTES, DIFF_MAX_BYTES, DIFF_MAX_LINES, HIGHLIGHT_MAX_BYTES } from "../shared/limits.ts";
import { diffFileRpc, type FileDiff } from "../shared/rpc/diff.ts";
import type { DiffSource, FileChange, Tokens, WhitespaceMode } from "../shared/schemas.ts";
import { GitError, isGitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { handle, type Registrar, type ServerDeps } from "./core/handler.ts";
import { assertRevision, resolveInside } from "./core/validate.ts";
import { highlightLines, languageFor } from "./highlight.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, diffFileRpc, { kind: "read" }, async (input, ctx) => {
    const source = input.source.kind === "compare" ? await resolveCompare(ctx, input.source.from, input.source.to) : input.source;
    return diffFile(ctx, source, input.file, { highlight: input.highlight, whitespace: input.whitespace });
  });
}

/** A compare source with both revisions resolved to commits, as the other sources carry them. */
async function resolveCompare(tools: GitTools, from: string, to: string): Promise<DiffSource> {
  const [fromHash, toHash] = await Promise.all([assertRevision(tools.cwd, from), assertRevision(tools.cwd, to)]);
  return { kind: "compare", from: fromHash, to: toHash };
}

// diffEditor.maxComputationTime and diffEditor.experimental.showMoves, as VS Code sets them.
const OPTIONS = { maxComputationTimeMs: 5000, computeMoves: false };

/** Where one side of a file is read: a revision of it ("" being the index), or the working tree. */
export type Side = { revision: string; path: string; fallback?: string } | { worktree: string };

/** The two sides VS Code compares for a file; null where the file is not on that side. */
export function sides(source: DiffSource, file: FileChange): [Side | null, Side | null] {
  const { path, status } = file;
  const before = file.from ?? path; // a rename's old path
  const at = (revision: string, where = path): Side => ({ revision, path: where });
  const between = (from: string, to: Side): [Side | null, Side | null] =>
    status === "A" || status === "?" ? [null, to] : status === "D" ? [at(from, before), null] : [at(from, before), to];
  switch (source.kind) {
    case "changes":
      // An untracked file, and one in conflict with its markers, open as they are in the working tree.
      if (status === "?" || status === "U") return [null, { worktree: path }];
      return status === "D" ? [at("", before), null] : [at("", before), { worktree: path }];
    case "staged":
      return between("HEAD", at(""));
    case "commit":
      return between(`${source.hash}^1`, at(source.hash)); // a merge against its first parent
    case "stash":
      // Its tracked changes against the commit it was made on; an untracked file it kept is in its third parent.
      return between(`${source.hash}^1`, { revision: source.hash, path, fallback: `${source.hash}^3` });
    case "incoming":
    case "outgoing":
    case "compare":
      return between(source.from, at(source.to));
  }
}

type Content = { kind: "text"; bytes: Buffer } | { kind: "too-large"; size: number };

async function readRevision(tools: GitTools, revision: string, path: string): Promise<Content> {
  const spec = `${revision}:${path}`;
  const size = Number((await tools.read(["cat-file", "-s", spec])).trim());
  if (!Number.isFinite(size)) throw new GitError("UNKNOWN", `git cat-file -s answered no size for ${path}`);
  if (size > DIFF_MAX_BYTES) return { kind: "too-large", size };
  const { stdout } = await tools.buffer(["cat-file", "blob", spec], { kind: "read", maxBytes: DIFF_MAX_BYTES + 1 });
  return { kind: "text", bytes: stdout };
}

async function readWorktree(root: string, path: string): Promise<Content> {
  // The file itself may be a symlink (read as one); the folders on the way may not lead out of the root.
  const absolute = await resolveInside(root, path, { real: true, followLast: false });
  let info;
  try {
    info = await lstat(absolute);
  } catch {
    throw new GitError("STALE_STATE", `${path} is not in the working tree any more`);
  }
  if (info.isSymbolicLink()) return { kind: "text", bytes: Buffer.from(await readlink(absolute), "utf8") };
  if (!info.isFile()) throw new GitError("STALE_STATE", `${path} is not a file in the working tree`);
  if (info.size > DIFF_MAX_BYTES) return { kind: "too-large", size: info.size };
  const file = await open(absolute, "r");
  try {
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await file.read(buffer, 0, info.size, 0);
    return { kind: "text", bytes: buffer.subarray(0, bytesRead) };
  } finally {
    await file.close().catch(() => {});
  }
}

async function read(tools: GitTools, side: Side): Promise<Content> {
  if ("worktree" in side) return readWorktree(tools.cwd, side.worktree);
  try {
    return await readRevision(tools, side.revision, side.path);
  } catch (error) {
    if (side.fallback === undefined || !isGitError(error)) throw error;
    return readRevision(tools, side.fallback, side.path);
  }
}

const isBinary = (bytes: Buffer) => bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0); // git's own test
const splitLines = (text: string) => text.split(/\r\n|\r|\n/);

export interface DiffOptions {
  highlight: boolean;
  whitespace: WhitespaceMode;
}

export async function diffFile(tools: GitTools, source: DiffSource, file: FileChange, options: DiffOptions): Promise<FileDiff> {
  const [from, to] = sides(source, file);
  const [original, modified] = await Promise.all([from && read(tools, from), to && read(tools, to)]);
  const present = [original, modified].filter((side): side is Content => side !== null);
  const large = present.filter((side): side is { kind: "too-large"; size: number } => side.kind === "too-large");
  if (large.length > 0) return { kind: "too-large", bytes: Math.max(...large.map((side) => side.size)) };
  const texts = present as Array<{ kind: "text"; bytes: Buffer }>;
  if (texts.some((side) => isBinary(side.bytes))) return { kind: "binary", size: Math.max(0, ...texts.map((side) => side.bytes.length)) };

  const decode = (side: Content | null) => (side === null || side.kind !== "text" ? null : side.bytes);
  const [beforeBytes, afterBytes] = [decode(original), decode(modified)];
  let truncated = false;
  const linesOf = (bytes: Buffer) => {
    const lines = splitLines(bytes.toString("utf8"));
    if (lines.length <= DIFF_MAX_LINES) return lines;
    truncated = true;
    return lines.slice(0, DIFF_MAX_LINES);
  };
  const language = options.highlight ? languageFor(file.path) : null;
  const highlightable = language !== null && texts.every((side) => side.bytes.length <= HIGHLIGHT_MAX_BYTES);
  const tokensOf = (lines: string[]): Tokens | null => (highlightable && language !== null ? highlightLines(lines, language) : null);

  if (beforeBytes === null || afterBytes === null) {
    const lines = linesOf(beforeBytes ?? afterBytes ?? Buffer.alloc(0));
    const tokens = tokensOf(lines);
    return { kind: "file", lines, truncated, ...(tokens !== null && language !== null && { tokens, language }) };
  }

  const [before, after] = [linesOf(beforeBytes), linesOf(afterBytes)];
  const result = new DefaultLinesDiffComputer().computeDiff(before, after, { ...OPTIONS, ignoreTrimWhitespace: options.whitespace === "ignore-trim" });
  const range = (r: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) =>
    [r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn] as [number, number, number, number];
  const tokensBefore = tokensOf(before);
  const tokensAfter = tokensBefore === null ? null : tokensOf(after);
  return {
    kind: "diff",
    original: before,
    modified: after,
    hitTimeout: result.hitTimeout,
    changes: result.changes.map((change) => ({
      original: [change.original.startLineNumber, change.original.endLineNumberExclusive] as [number, number],
      modified: [change.modified.startLineNumber, change.modified.endLineNumberExclusive] as [number, number],
      inner: (change.innerChanges ?? []).map((inner) => ({ original: range(inner.originalRange), modified: range(inner.modifiedRange) })),
    })),
    truncated,
    ...(tokensBefore !== null && tokensAfter !== null && language !== null && { tokens: { original: tokensBefore, modified: tokensAfter }, language }),
  };
}
