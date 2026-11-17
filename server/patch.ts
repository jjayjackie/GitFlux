// Unified diffs as hunks, and patches built from a selection of them: what git.changes.hunks reads and
// git.changes.apply-hunks applies. Pure functions, no git and no file system: unit-tested in
// test/unit/server/patch.test.ts.
//
// Bytes. git's diff output is read as a Buffer and handed here as a "latin1" string: one character per byte, so that
// CRLF line ends, non-UTF-8 text and quoted paths survive the round trip to `git apply` byte for byte
// (`Buffer.from(patch, "latin1")`). Lines are split on "\n" only: a "\r" before it stays part of the line's text. Only
// `toHunk`, which builds what the client sees, decodes the bytes as UTF-8 and drops a line's trailing "\r" (it is part
// of the line break, which the client's `text` leaves out).
//
// API
//   parsePatch(text) → PatchFile[]        every file section of `git diff` output: its header lines as git printed them
//                                         (`diff --git`, mode and index lines, `---`, `+++`), whether git called it
//                                         binary, and its hunks with their line numbers and "\ No newline" markers.
//   additionHunks(text, section?) → PatchHunk[]
//                                         an untracked file's content as git would show it once added: one hunk that
//                                         adds every line (none for an empty file).
//   hunkId(section, hunk)                 the fingerprint of a hunk: its file section, both ranges, and every line's
//                                         kind, bytes and end-of-file marker (sha1, hex). The same hunk read again has
//                                         the same id; a hunk that changed in any way does not.
//   buildPatch(files, selections, direction) → { patch, missing }
//                                         a patch holding only the selected hunks, or lines of them, for `git apply`
//                                         ("forward") or `git apply --reverse` ("reverse"). `missing` lists ids no
//                                         hunk has (then `patch` is null); `patch` is null too when the selection
//                                         changes nothing.
//   toHunk(hunk) → Hunk                   the client's view of a hunk (shared/schemas.ts hunkSchema).

import { createHash } from "node:crypto";
import type { Hunk, HunkLine } from "../shared/schemas.ts";

export type LineKind = "context" | "add" | "delete";

export interface PatchLine {
  kind: LineKind;
  /** The line's bytes (latin1), without its leading ' ', '+' or '-' and without the "\n". A CRLF line keeps its "\r". */
  text: string;
  /** Followed by "\ No newline at end of file": the side(s) the line is on end with it, without a line break. */
  noNewline: boolean;
  oldLine?: number;
  newLine?: number;
}

export interface PatchHunk {
  id: string;
  /** Which file section of the diff it belongs to, from 0. */
  section: number;
  /** "@@ -a,b +c,d @@ …" as git printed it (latin1). */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: PatchLine[];
}

export interface PatchFile {
  /** The section's lines before its first hunk, verbatim: `diff --git …`, mode, similarity and index lines, `---`, `+++`. */
  header: string[];
  /** git printed "Binary files … differ" (or a binary patch) instead of hunks. */
  binary: boolean;
  hunks: PatchHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NO_NEWLINE = "\\ No newline at end of file";

export function hunkId(section: number, hunk: Pick<PatchHunk, "oldStart" | "oldLines" | "newStart" | "newLines" | "lines">): string {
  const hash = createHash("sha1");
  hash.update(`${section}|${hunk.oldStart},${hunk.oldLines}|${hunk.newStart},${hunk.newLines}\n`, "latin1");
  for (const line of hunk.lines) {
    const mark = line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " ";
    hash.update(`${mark}${line.text}\n${line.noNewline ? "\\\n" : ""}`, "latin1");
  }
  return hash.digest("hex");
}

function isSectionStart(line: string): boolean {
  return line.startsWith("diff --git ") || line.startsWith("diff --cc ") || line.startsWith("diff --combined ");
}

export function parsePatch(text: string): PatchFile[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let n = 0;
  while (n < lines.length) {
    const line = lines[n];
    if (isSectionStart(line)) {
      file = { header: [line], binary: false, hunks: [] };
      files.push(file);
      n++;
      continue;
    }
    if (file === null) {
      n++; // anything before the first section (there is nothing, with the options git is run with)
      continue;
    }
    const match = file.binary ? null : HUNK_HEADER.exec(line);
    if (match === null) {
      // A line of the section's header (or, once its hunks have begun, something that is not a hunk: ignored).
      if (file.hunks.length === 0) {
        file.header.push(line);
        if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
      }
      n++;
      continue;
    }
    const oldStart = Number(match[1]);
    const oldLines = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newLines = match[4] === undefined ? 1 : Number(match[4]);
    let oldLeft = oldLines;
    let newLeft = newLines;
    let oldNo = oldStart;
    let newNo = newStart;
    const body: PatchLine[] = [];
    n++;
    // The counts in the header say where the hunk ends; a "\ No newline" marker may follow its last line.
    while (n < lines.length && (oldLeft > 0 || newLeft > 0 || lines[n].startsWith("\\"))) {
      const current = lines[n];
      if (current.startsWith("\\")) {
        const last = body[body.length - 1];
        if (last !== undefined) last.noNewline = true;
        n++;
        continue;
      }
      const mark = current === "" ? " " : current[0];
      const rest = current.slice(1);
      if (mark === " " && oldLeft > 0 && newLeft > 0) {
        // An empty context line may have lost its space to a tool that trims lines; it is still a line of both sides.
        body.push({ kind: "context", text: rest, noNewline: false, oldLine: oldNo++, newLine: newNo++ });
        oldLeft--;
        newLeft--;
      } else if (mark === "-" && oldLeft > 0) {
        body.push({ kind: "delete", text: rest, noNewline: false, oldLine: oldNo++ });
        oldLeft--;
      } else if (mark === "+" && newLeft > 0) {
        body.push({ kind: "add", text: rest, noNewline: false, newLine: newNo++ });
        newLeft--;
      } else {
        break; // not a line of this hunk: the diff was cut or is malformed
      }
      n++;
    }
    const section = files.length - 1;
    const hunk: PatchHunk = { id: "", section, header: line, oldStart, oldLines, newStart, newLines, lines: body };
    hunk.id = hunkId(section, hunk);
    file.hunks.push(hunk);
  }
  return files;
}

/** A hunk's range in git's notation: the count is left out when it is 1. */
function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

export function additionHunks(text: string, section = 0): PatchHunk[] {
  if (text === "") return [];
  const parts = text.split("\n");
  const complete = parts[parts.length - 1] === "";
  if (complete) parts.pop();
  const lines = parts.map((part, index): PatchLine => ({ kind: "add", text: part, noNewline: false, newLine: index + 1 }));
  if (!complete) lines[lines.length - 1].noNewline = true;
  const hunk: PatchHunk = {
    id: "",
    section,
    header: `@@ -0,0 +${range(1, lines.length)} @@`,
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines,
  };
  hunk.id = hunkId(section, hunk);
  return [hunk];
}

// --- building a patch from a selection ------------------------------------------------------------

export interface HunkChoice {
  id: string;
  /** Indexes into the hunk's lines; omitted, the whole hunk. Context indexes mean nothing. */
  lines?: readonly number[];
}

/** "forward": `git apply` (staging). "reverse": `git apply --reverse` (unstaging, discarding). */
export type Direction = "forward" | "reverse";

interface OutLine {
  kind: LineKind;
  text: string;
  /** Ends the old side without a line break. */
  oldEnd: boolean;
  /** Ends the new side without a line break. */
  newEnd: boolean;
}

/**
 * The lines of a hunk as the patch carries them, keeping only the chosen add and delete lines. The side the patch is
 * applied to is never changed: applied forward, that is the old side, so every old line stays (an unchosen delete
 * becomes context) and an unchosen add is dropped; applied in reverse it is the new side, so an unchosen add becomes
 * context and an unchosen delete is dropped. Null when nothing is left to change.
 */
function rebuildLines(hunk: PatchHunk, chosen: ReadonlySet<number> | null, direction: Direction): OutLine[] | null {
  const reverse = direction === "reverse";
  const out: OutLine[] = [];
  hunk.lines.forEach((line, index) => {
    const picked = chosen === null || chosen.has(index);
    const end = line.noNewline;
    if (line.kind === "context") out.push({ kind: "context", text: line.text, oldEnd: end, newEnd: end });
    else if (line.kind === "add") {
      if (picked) out.push({ kind: "add", text: line.text, oldEnd: false, newEnd: end });
      else if (reverse) out.push({ kind: "context", text: line.text, oldEnd: end, newEnd: end });
    } else if (picked) out.push({ kind: "delete", text: line.text, oldEnd: end, newEnd: false });
    else if (!reverse) out.push({ kind: "context", text: line.text, oldEnd: end, newEnd: end });
  });
  if (!out.some((line) => line.kind !== "context")) return null;

  // Only the last line of a side can end it without a line break. The side applied to is as it was, so its marks
  // stand; on the other side, a line that something now follows (a line that joined it, or one that came before lines
  // that joined it) needs its break.
  let laterOld = false;
  let laterNew = false;
  for (let n = out.length - 1; n >= 0; n--) {
    const line = out[n];
    if (!reverse && line.kind !== "delete" && laterNew) line.newEnd = false;
    if (reverse && line.kind !== "add" && laterOld) line.oldEnd = false;
    if (line.kind !== "add") laterOld = true;
    if (line.kind !== "delete") laterNew = true;
  }
  // A line on both sides that ends one with a break and the other without is a change of its own: git writes it as a
  // delete and an add.
  const final: OutLine[] = [];
  for (const line of out) {
    if (line.kind === "context" && line.oldEnd !== line.newEnd) {
      final.push({ kind: "delete", text: line.text, oldEnd: line.oldEnd, newEnd: false });
      final.push({ kind: "add", text: line.text, oldEnd: false, newEnd: line.newEnd });
    } else final.push(line);
  }
  return final;
}

interface BuiltHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: OutLine[];
}

function renderHunk(hunk: BuiltHunk): string[] {
  const out = [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`];
  for (const line of hunk.lines) {
    const mark = line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " ";
    out.push(`${mark}${line.text}`);
    const end = line.kind === "add" ? line.newEnd : line.oldEnd;
    if (end) out.push(NO_NEWLINE);
  }
  return out;
}

/** `value` (a `---`/`+++` path, possibly C-quoted) with its prefix `from` replaced by `to`; null if it has not that prefix. */
function swapPrefix(value: string, from: string, to: string): string | null {
  if (value.startsWith(`"${from}`)) return `"${to}${value.slice(from.length + 1)}`;
  if (value.startsWith(from)) return `${to}${value.slice(from.length)}`;
  return null;
}

/**
 * The file's header for the patch. git's own lines are kept, except where only part of a created or deleted file is
 * taken: a creation applied in reverse in part, or a deletion applied forward in part, leaves the file in place, so
 * the section becomes a modification (no file mode or index line; /dev/null replaced by the file's other name, taken
 * from git's own line).
 */
function headerFor(file: PatchFile, direction: Direction, built: readonly BuiltHunk[]): string[] {
  const created = file.header.some((line) => line.startsWith("new file mode "));
  const deleted = file.header.some((line) => line.startsWith("deleted file mode "));
  const keepsOld = built.some((hunk) => hunk.oldLines > 0);
  const keepsNew = built.some((hunk) => hunk.newLines > 0);
  const partialCreation = created && direction === "reverse" && keepsOld;
  const partialDeletion = deleted && direction === "forward" && keepsNew;
  if (!partialCreation && !partialDeletion) return file.header;
  const minus = file.header.find((line) => line.startsWith("--- "));
  const plus = file.header.find((line) => line.startsWith("+++ "));
  if (minus === undefined || plus === undefined) return file.header;
  const replacement = partialCreation ? swapPrefix(plus.slice(4), "b/", "a/") : swapPrefix(minus.slice(4), "a/", "b/");
  if (replacement === null) return file.header;
  return file.header
    .filter((line) => !line.startsWith("new file mode ") && !line.startsWith("deleted file mode ") && !line.startsWith("index "))
    .map((line) => {
      if (partialCreation && line === minus) return `--- ${replacement}`;
      if (partialDeletion && line === plus) return `+++ ${replacement}`;
      return line;
    });
}

export function buildPatch(files: readonly PatchFile[], selections: readonly HunkChoice[], direction: Direction): { patch: string | null; missing: string[] } {
  const where = new Map<string, { file: number; hunk: number }>();
  files.forEach((file, fileIndex) => file.hunks.forEach((hunk, hunkIndex) => where.set(hunk.id, { file: fileIndex, hunk: hunkIndex })));
  const missing: string[] = [];
  // file → hunk → the chosen line indexes (null: all of them)
  const chosen = new Map<number, Map<number, Set<number> | null>>();
  for (const selection of selections) {
    const at = where.get(selection.id);
    if (at === undefined) {
      missing.push(selection.id);
      continue;
    }
    const hunks = chosen.get(at.file) ?? new Map<number, Set<number> | null>();
    chosen.set(at.file, hunks);
    const before = hunks.get(at.hunk);
    if (selection.lines === undefined || before === null) hunks.set(at.hunk, null);
    else hunks.set(at.hunk, new Set([...(before ?? []), ...selection.lines]));
  }
  if (missing.length > 0) return { patch: null, missing };

  const out: string[] = [];
  for (const fileIndex of [...chosen.keys()].sort((a, b) => a - b)) {
    const file = files[fileIndex];
    const hunks = chosen.get(fileIndex) ?? new Map<number, Set<number> | null>();
    const built: BuiltHunk[] = [];
    let delta = 0; // how far the side not applied to has moved, by the hunks already in the patch
    for (const hunkIndex of [...hunks.keys()].sort((a, b) => a - b)) {
      const hunk = file.hunks[hunkIndex];
      const lines = rebuildLines(hunk, hunks.get(hunkIndex) ?? null, direction);
      if (lines === null) continue; // nothing of it changes anything: left out, as git refuses an empty hunk
      const oldLines = lines.filter((line) => line.kind !== "add").length;
      const newLines = lines.filter((line) => line.kind !== "delete").length;
      let oldStart: number;
      let newStart: number;
      // A range of no lines is numbered by the line before it ("-0,0" for the top of a file).
      if (direction === "forward") {
        oldStart = hunk.oldStart;
        const first = (hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart) + delta;
        newStart = newLines === 0 ? first - 1 : first;
        delta += newLines - oldLines;
      } else {
        newStart = hunk.newStart;
        const first = (hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart) + delta;
        oldStart = oldLines === 0 ? first - 1 : first;
        delta += oldLines - newLines;
      }
      built.push({ oldStart, oldLines, newStart, newLines, lines });
    }
    if (built.length === 0) continue;
    out.push(...headerFor(file, direction, built));
    for (const hunk of built) out.push(...renderHunk(hunk));
  }
  return { patch: out.length === 0 ? null : `${out.join("\n")}\n`, missing: [] };
}

// --- the client's view --------------------------------------------------------------------------------

/** latin1 bytes → text, as UTF-8. */
export function decode(bytes: string): string {
  return Buffer.from(bytes, "latin1").toString("utf8");
}

export function toHunk(hunk: PatchHunk): Hunk {
  return {
    id: hunk.id,
    header: decode(hunk.header).replace(/\r$/, ""),
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    lines: hunk.lines.map((line) => {
      const out: HunkLine = { kind: line.kind, text: decode(line.text).replace(/\r$/, "") };
      if (line.oldLine !== undefined) out.oldLine = line.oldLine;
      if (line.newLine !== undefined) out.newLine = line.newLine;
      if (line.noNewline) out.noNewline = true;
      return out;
    }),
  };
}
