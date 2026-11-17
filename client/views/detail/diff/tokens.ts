// Syntax colours over the diff's own marks: the stretch of a line drawn in one row, cut into runs that each have one
// syntax scope and are either inside or outside a changed stretch (the word-level highlight). The daemon tokenises
// each side (git.diff.file with `highlight`), and sends a line's tokens flat: `[length, scope, length, scope, …]`,
// lengths in UTF-16 code units from the start of the line, as JavaScript counts a string, so offsets here are plain
// string offsets and a surrogate pair counts as two. Pure: unit-tested.

import { TOKEN_SCOPES } from "../../../../shared/schemas.ts";
import type { TokenLine, TokenScope, Tokens } from "../../../../shared/schemas.ts";
import type { Marks } from "./diffRows.ts";

/** A stretch `[start, end)` of a line drawn in one style: its syntax scope, and whether it is in a changed stretch. */
export interface StyledRun {
  start: number;
  end: number;
  scope: TokenScope;
  marked: boolean;
}

/** The scope a token's number stands for; one the table does not have is plain text. */
export function scopeName(index: number): TokenScope {
  return (TOKEN_SCOPES as readonly TokenScope[])[index] ?? "none";
}

/** A side's tokens for line `number` (from 1); undefined when the side has none, or none for that line. */
export function tokensOf(tokens: Tokens | null | undefined, number: number | null | undefined): TokenLine | undefined {
  if (!tokens || number === null || number === undefined || number < 1) return undefined;
  return tokens[number - 1];
}

/** The marks within `[from, to)`, in order, without overlaps. */
function normalise(marks: Marks, from: number, to: number): [number, number][] {
  const inside = marks
    .map(([start, end]): [number, number] => [Math.max(start, from), Math.min(end, to)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const mark of inside) {
    const last = merged[merged.length - 1];
    if (last && mark[0] <= last[1]) last[1] = Math.max(last[1], mark[1]);
    else merged.push([mark[0], mark[1]]);
  }
  return merged;
}

/**
 * The runs `text[from, to)` is drawn in. `tokens` may be missing (no highlighting: one plain scope), shorter than the
 * line (the rest is plain) or longer (cut at the line's end). `marks` are the changed stretches of the whole line. Runs
 * are contiguous, cover the slice exactly, and two neighbours never share both scope and marking. An empty slice has
 * no runs.
 */
export function styledRuns(text: string, tokens: TokenLine | null | undefined, marks: Marks, from = 0, to = text.length): StyledRun[] {
  const start = Math.max(0, Math.min(from, text.length));
  const end = Math.max(start, Math.min(to, text.length));
  const runs: StyledRun[] = [];
  if (end <= start) return runs;
  const marked = normalise(marks, start, end);
  let next = 0; // the first mark that may still matter: segments come in order
  const push = (left: number, right: number, scope: TokenScope, inMark: boolean) => {
    if (right <= left) return;
    const last = runs[runs.length - 1];
    if (last && last.end === left && last.scope === scope && last.marked === inMark) last.end = right;
    else runs.push({ start: left, end: right, scope, marked: inMark });
  };
  const emit = (left: number, right: number, scope: TokenScope) => {
    let at = left;
    while (at < right) {
      while (next < marked.length && marked[next][1] <= at) next++;
      const mark = marked[next];
      if (!mark || mark[0] >= right) {
        push(at, right, scope, false);
        return;
      }
      if (mark[0] > at) {
        push(at, mark[0], scope, false);
        at = mark[0];
      }
      const stop = Math.min(mark[1], right);
      push(at, stop, scope, true);
      at = stop;
    }
  };
  let position = 0;
  if (tokens)
    for (let i = 0; i + 1 < tokens.length && position < end; i += 2) {
      const after = position + Math.max(0, tokens[i]);
      const [left, right] = [Math.max(position, start), Math.min(after, end)];
      if (right > left) emit(left, right, scopeName(tokens[i + 1]));
      position = after;
    }
  if (position < end) emit(Math.max(position, start), end, "none");
  return runs;
}
