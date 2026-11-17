// Which lines of a file's hunks are chosen to stage, unstage or discard (the hunk view, ./HunkView.tsx), and what is
// sent for them to git.changes.apply-hunks. Only add and delete lines can be chosen: context lines stay as they are.
// A hunk whose every changed line is chosen is sent whole. Pure: unit-tested.

import type { HunkSelection } from "../../../../shared/rpc/changes.ts";
import type { Hunk, HunkLine } from "../../../../shared/schemas.ts";

/** The chosen lines of each hunk, by the hunk's id: indexes into its `lines`. Never holds an empty set. */
export type LineSelection = ReadonlyMap<string, ReadonlySet<number>>;

export const NO_SELECTION: LineSelection = new Map();

/** A line of a hunk, by the hunk's id and the line's index in it. */
export interface LinePoint {
  id: string;
  index: number;
}

/** Whether a line can be chosen: an added or a deleted one. */
export const isChange = (line: HunkLine | undefined) => line !== undefined && line.kind !== "context";

/** The indexes of a hunk's added and deleted lines. */
export function changeIndexes(hunk: Hunk): number[] {
  const indexes: number[] = [];
  hunk.lines.forEach((line, index) => {
    if (isChange(line)) indexes.push(index);
  });
  return indexes;
}

export function isSelected(selection: LineSelection, id: string, index: number): boolean {
  return selection.get(id)?.has(index) === true;
}

/** How many lines are chosen in all. */
export function countSelected(selection: LineSelection): number {
  let count = 0;
  for (const lines of selection.values()) count += lines.size;
  return count;
}

/** `indexes` of `hunk` chosen (`on`) or not; context lines are ignored. */
export function setLines(selection: LineSelection, hunk: Hunk, indexes: readonly number[], on: boolean): LineSelection {
  const before = selection.get(hunk.id);
  const lines = new Set(before);
  for (const index of indexes) {
    if (!isChange(hunk.lines[index])) continue;
    if (on) lines.add(index);
    else lines.delete(index);
  }
  if (before !== undefined && lines.size === before.size && [...lines].every((index) => before.has(index))) return selection;
  if (before === undefined && lines.size === 0) return selection;
  const next = new Map(selection);
  if (lines.size === 0) next.delete(hunk.id);
  else next.set(hunk.id, lines);
  return next;
}

/** A press on a line: chosen if it was not, and not if it was. A context line changes nothing. */
export function toggleLine(selection: LineSelection, hunk: Hunk, index: number): LineSelection {
  return setLines(selection, hunk, [index], !isSelected(selection, hunk.id, index));
}

/** Whether every changed line of `hunk` is chosen (a hunk with none never is). */
export function isWholeHunk(selection: LineSelection, hunk: Hunk): boolean {
  const changes = changeIndexes(hunk);
  const lines = selection.get(hunk.id);
  return changes.length > 0 && lines !== undefined && changes.every((index) => lines.has(index));
}

/** The hunk's checkbox: every changed line chosen, or, when they all were, none. */
export function toggleHunk(selection: LineSelection, hunk: Hunk): LineSelection {
  return setLines(selection, hunk, changeIndexes(hunk), !isWholeHunk(selection, hunk));
}

/**
 * A Shift-press: every changed line from `anchor` to `target`, both included, in the order the hunks are shown, is
 * chosen. Either end that names no line of `hunks` chooses only the other's line, or nothing.
 */
export function selectRange(selection: LineSelection, hunks: readonly Hunk[], anchor: LinePoint | null, target: LinePoint): LineSelection {
  const order = (point: LinePoint | null) => {
    if (!point) return -1;
    let at = 0;
    for (const hunk of hunks) {
      if (hunk.id === point.id) return point.index >= 0 && point.index < hunk.lines.length ? at + point.index : -1;
      at += hunk.lines.length;
    }
    return -1;
  };
  const [from, to] = [order(anchor), order(target)];
  if (to === -1) return selection;
  const [low, high] = from === -1 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
  let next = selection;
  let at = 0;
  for (const hunk of hunks) {
    const start = Math.max(low - at, 0);
    const end = Math.min(high - at, hunk.lines.length - 1);
    if (start <= end) {
      const indexes: number[] = [];
      for (let index = start; index <= end; index++) indexes.push(index);
      next = setLines(next, hunk, indexes, true);
    }
    at += hunk.lines.length;
  }
  return next;
}

/** The selection kept to the hunks there are now: a hunk gone (the file changed), or a line no longer a change, drops out. */
export function prune(selection: LineSelection, hunks: readonly Hunk[]): LineSelection {
  if (selection.size === 0) return selection;
  const byId = new Map(hunks.map((hunk) => [hunk.id, hunk]));
  let changed = false;
  const next = new Map<string, ReadonlySet<number>>();
  for (const [id, lines] of selection) {
    const hunk = byId.get(id);
    const kept = hunk ? new Set([...lines].filter((index) => isChange(hunk.lines[index]))) : new Set<number>();
    if (kept.size !== lines.size) changed = true;
    if (kept.size > 0) next.set(id, kept);
  }
  return changed ? next : selection;
}

/** What git.changes.apply-hunks is sent: in the order of `hunks`, a whole hunk by its id alone, else its chosen lines. */
export function toRequest(selection: LineSelection, hunks: readonly Hunk[]): HunkSelection[] {
  const request: HunkSelection[] = [];
  for (const hunk of hunks) {
    const lines = selection.get(hunk.id);
    if (!lines || lines.size === 0) continue;
    const chosen = [...lines].filter((index) => isChange(hunk.lines[index])).sort((a, b) => a - b);
    if (chosen.length === 0) continue;
    request.push(isWholeHunk(selection, hunk) ? { id: hunk.id } : { id: hunk.id, lines: chosen });
  }
  return request;
}

/** The chosen lines as they read in a unified diff ("+added", "-deleted"), in order: what a discard would lose. */
export function describeSelected(selection: LineSelection, hunks: readonly Hunk[]): string[] {
  const lines: string[] = [];
  for (const hunk of hunks) {
    const chosen = selection.get(hunk.id);
    if (!chosen) continue;
    hunk.lines.forEach((line, index) => {
      if (chosen.has(index) && isChange(line)) lines.push(`${line.kind === "add" ? "+" : "-"}${line.text}`);
    });
  }
  return lines;
}

/** A whole hunk's changed lines, as describeSelected words them. */
export function describeHunk(hunk: Hunk): string[] {
  return hunk.lines.filter(isChange).map((line) => `${line.kind === "add" ? "+" : "-"}${line.text}`);
}
