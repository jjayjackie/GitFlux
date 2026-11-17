// A file in conflict, read as git wrote it: text, and conflict blocks of the current side (ours), the common base when
// git writes it (merge.conflictStyle diff3 or zdiff3), and the incoming side (theirs), between their markers:
//
//   <<<<<<< HEAD             ours
//   |||||||  base            (diff3 only)
//   =======
//   >>>>>>> feature          theirs
//
// Parsing keeps every byte: the parts joined again are the text it was given, line breaks (LF or CRLF) included, so a
// block resolved here changes that block only. What does not close as a block (a marker on its own, a block that runs
// to the end of the file, a block opened again before it closed) is left as text. Pure: unit-tested.
//
// `hasConflictMarkers` is VS Code's test for a conflict left in a file (extensions/git: `^<{7}\s|^={7}$|^>{7}\s`), the
// one the daemon applies in git.changes.markers (server/changes.ts).

/** Text outside any conflict, as it is. */
export interface TextPart {
  kind: "text";
  text: string;
}

/** A conflict block. Each side's text keeps its lines' breaks; `raw` is the whole block as it is in the file. */
export interface ConflictPart {
  kind: "conflict";
  /** Its place among the file's conflicts, from 0. */
  index: number;
  raw: string;
  ours: string;
  /** The common ancestor's lines (diff3), or null when git did not write them. */
  base: string | null;
  theirs: string;
  /** What git wrote after each marker ("HEAD", "feature", "a1b2c3d (Fix it)"); "" when nothing. */
  oursLabel: string;
  baseLabel: string | null;
  theirsLabel: string;
}

export type Part = TextPart | ConflictPart;

const MARKER = /^<{7}\s|^={7}$|^>{7}\s/m;

/** Whether `text` still holds a conflict marker, as VS Code and the daemon test it. */
export function hasConflictMarkers(text: string): boolean {
  return MARKER.test(text.replace(/\r\n/g, "\n"));
}

/** The lines of `text`, each with its line break ("\n" or "\r\n"); the last without one when the text does not end in one. */
export function splitKeepingBreaks(text: string): string[] {
  const lines: string[] = [];
  let at = 0;
  while (at < text.length) {
    const end = text.indexOf("\n", at);
    if (end === -1) {
      lines.push(text.slice(at));
      break;
    }
    lines.push(text.slice(at, end + 1));
    at = end + 1;
  }
  return lines;
}

/** A line without its break. */
const bare = (line: string) => line.replace(/\r?\n$/, "");

const START = /^<{7}(?:\s|$)/;
const BASE = /^\|{7}(?:\s|$)/;
const SEPARATOR = /^={7}$/;
const END = /^>{7}(?:\s|$)/;
const label = (line: string) => bare(line).slice(7).trim();

type Stage = "ours" | "base" | "theirs";

/** The text cut into its text and its conflict blocks, in order. Joined again (`joinParts`), they are `text` exactly. */
export function parseConflicts(text: string): Part[] {
  const parts: Part[] = [];
  let plain = "";
  let count = 0;
  // The block being read: its lines so far, and what each part holds.
  let block: { raw: string; stage: Stage; ours: string; base: string | null; theirs: string; oursLabel: string; baseLabel: string | null } | null = null;
  const flushText = () => {
    if (plain !== "") parts.push({ kind: "text", text: plain });
    plain = "";
  };
  for (const line of splitKeepingBreaks(text)) {
    const content = bare(line);
    if (block === null) {
      if (START.test(content)) block = { raw: line, stage: "ours", ours: "", base: null, theirs: "", oursLabel: label(line), baseLabel: null };
      else plain += line;
      continue;
    }
    if (START.test(content)) {
      // Opened again before it closed: what was read is text, and a block starts here.
      plain += block.raw;
      block = { raw: line, stage: "ours", ours: "", base: null, theirs: "", oursLabel: label(line), baseLabel: null };
      continue;
    }
    if (block.stage === "ours" && BASE.test(content)) {
      block = { ...block, raw: block.raw + line, stage: "base", base: "", baseLabel: label(line) };
      continue;
    }
    if (block.stage !== "theirs" && SEPARATOR.test(content)) {
      block = { ...block, raw: block.raw + line, stage: "theirs" };
      continue;
    }
    if (END.test(content)) {
      if (block.stage !== "theirs") {
        // Closed without its separator: not a block.
        plain += block.raw + line;
        block = null;
        continue;
      }
      flushText();
      parts.push({
        kind: "conflict",
        index: count++,
        raw: block.raw + line,
        ours: block.ours,
        base: block.base,
        theirs: block.theirs,
        oursLabel: block.oursLabel,
        baseLabel: block.baseLabel,
        theirsLabel: label(line),
      });
      block = null;
      continue;
    }
    block.raw += line;
    if (block.stage === "ours") block.ours += line;
    else if (block.stage === "base") block.base = (block.base ?? "") + line;
    else block.theirs += line;
  }
  if (block !== null) plain += block.raw; // runs to the end of the file: not a block
  flushText();
  return parts;
}

/** The text the parts were read from. */
export function joinParts(parts: readonly Part[]): string {
  return parts.map((part) => (part.kind === "text" ? part.text : part.raw)).join("");
}

/** How many conflict blocks there are. */
export function conflictCount(parts: readonly Part[]): number {
  return parts.reduce((count, part) => count + (part.kind === "conflict" ? 1 : 0), 0);
}

/** What a block becomes: one side, both (current first, as VS Code's "Accept Both Changes"), or the base. */
export type BlockChoice = "ours" | "theirs" | "both" | "base";

/** The line break a block's text uses: its marker line's, so that what is joined matches the file. */
function breakOf(part: ConflictPart): string {
  return /\r\n/.test(part.raw) ? "\r\n" : "\n";
}

/** The text that replaces a block. */
export function chosenText(part: ConflictPart, choice: BlockChoice): string {
  switch (choice) {
    case "ours":
      return part.ours;
    case "theirs":
      return part.theirs;
    case "base":
      return part.base ?? "";
    case "both": {
      const first = part.ours !== "" && !part.ours.endsWith("\n") && part.theirs !== "" ? part.ours + breakOf(part) : part.ours;
      return first + part.theirs;
    }
  }
}

/** `text` with conflict block `index` (from 0) replaced by `choice`; every other byte as it was. */
export function resolveBlock(text: string, index: number, choice: BlockChoice): string {
  const parts = parseConflicts(text);
  return parts.map((part) => (part.kind === "text" ? part.text : part.index === index ? chosenText(part, choice) : part.raw)).join("");
}

/** `text` with every conflict block replaced by `choice`. */
export function resolveAll(text: string, choice: BlockChoice): string {
  return parseConflicts(text)
    .map((part) => (part.kind === "text" ? part.text : chosenText(part, choice)))
    .join("");
}
