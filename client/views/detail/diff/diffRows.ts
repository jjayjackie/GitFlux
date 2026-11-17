// Lays a diff out in rows as VS Code's diff editor draws it: inline, the lines taken out above the lines put in, or side
// by side, the two versions facing each other with room left where one has fewer lines.

import type { LineChange } from "../../../../shared/schemas.ts";

/** Stretches of a line's text that changed, as [start, end) offsets. */
export type Marks = [number, number][];

/** One line of one version: its number, its text, and what changed in it. */
export interface Cell {
  number: number;
  text: string;
  marks: Marks;
}

/** A row of the inline view. A line the same in both versions has both numbers; a removed or added one, its own. */
export interface InlineRow {
  kind: "same" | "remove" | "add";
  original: number | null;
  modified: number | null;
  text: string;
  marks: Marks;
}

/** A row of the side-by-side view: the original on the left, the modified on the right, null where one side has no line. */
export interface PairRow {
  changed: boolean;
  left: Cell | null;
  right: Cell | null;
}

type Range = [number, number, number, number]; // start line and column, end line and the column after, from 1

/** The changed stretches of each line, from ranges that can run over several lines. */
function marksByLine(ranges: Range[], lines: string[]) {
  const marks = new Map<number, Marks>();
  for (const [startLine, startColumn, endLine, endColumn] of ranges)
    for (let line = startLine; line <= endLine && line <= lines.length; line++) {
      const start = line === startLine ? startColumn - 1 : 0;
      const end = line === endLine ? endColumn - 1 : lines[line - 1].length;
      if (end > start) marks.set(line, [...(marks.get(line) ?? []), [start, end]]);
    }
  return marks;
}

interface Diff {
  original: string[];
  modified: string[];
  changes: LineChange[];
}

/**
 * Walks the two versions, calling `same` for each line the same in both, by its numbers in each, and `change` for each
 * change. Between changes the two versions keep in step, a line for a line.
 */
function walk({ original, modified, changes }: Diff, same: (from: number, to: number) => void, change: (change: LineChange, before: Map<number, Marks>, after: Map<number, Marks>) => void) {
  let from = 1;
  let to = 1;
  for (const each of changes) {
    for (; from < each.original[0]; from++, to++) same(from, to);
    change(
      each,
      marksByLine(
        each.inner.map((inner) => inner.original),
        original,
      ),
      marksByLine(
        each.inner.map((inner) => inner.modified),
        modified,
      ),
    );
    [from, to] = [each.original[1], each.modified[1]];
  }
  for (; to <= modified.length; from++, to++) same(from, to);
}

/** Lines in a range, as [start, end) from 1. */
const span = ([start, end]: [number, number]) => Array.from({ length: end - start }, (_, n) => start + n);

export function inlineRows(diff: Diff): InlineRow[] {
  const rows: InlineRow[] = [];
  walk(
    diff,
    // With leading and trailing whitespace ignored, as VS Code does by default, a line the same can differ in it: the modified one is shown.
    (from, to) => rows.push({ kind: "same", original: from, modified: to, text: diff.modified[to - 1], marks: [] }),
    (change, before, after) => {
      for (const line of span(change.original)) rows.push({ kind: "remove", original: line, modified: null, text: diff.original[line - 1], marks: before.get(line) ?? [] });
      for (const line of span(change.modified)) rows.push({ kind: "add", original: null, modified: line, text: diff.modified[line - 1], marks: after.get(line) ?? [] });
    },
  );
  return rows;
}

export function pairRows(diff: Diff): PairRow[] {
  const rows: PairRow[] = [];
  const cell = (lines: string[], marks: Map<number, Marks>, line: number | undefined): Cell | null =>
    line === undefined ? null : { number: line, text: lines[line - 1], marks: marks.get(line) ?? [] };
  walk(
    diff,
    (from, to) => rows.push({ changed: false, left: { number: from, text: diff.original[from - 1], marks: [] }, right: { number: to, text: diff.modified[to - 1], marks: [] } }),
    (change, before, after) => {
      const [left, right] = [span(change.original), span(change.modified)];
      for (let n = 0; n < Math.max(left.length, right.length); n++) rows.push({ changed: true, left: cell(diff.original, before, left[n]), right: cell(diff.modified, after, right[n]) });
    },
  );
  return rows;
}
