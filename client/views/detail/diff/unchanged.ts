// Folds the lines a diff leaves unchanged, as VS Code's diff editor does with "Collapse Unchanged Regions" on
// (diffEditor.hideUnchangedRegions): each stretch of unchanged lines, but those next to a change, folds into one row.
//
// `regions` is adapted from UnchangedRegion.fromDiffs in VS Code 1.142.0's src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts,
// and the ways a region opens from UnchangedRegion's methods there.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt

import type { LineChange } from "../../../../shared/schemas.ts";

// VS Code's defaults for diffEditor.hideUnchangedRegions: contextLineCount, minimumLineCount and revealLineCount.
const CONTEXT = 3; // unchanged lines kept beside a change
const MINIMUM = 3; // the fewest lines that fold
export const REVEAL = 20; // lines a click on a folded region's edge brings back

/** Unchanged lines that fold: where they start in each version, and how many there are. */
export interface Region {
  original: number;
  modified: number;
  length: number;
}

/** How much of a region shows: lines at its top and at its bottom. The rest is folded. */
export interface Shown {
  top: number;
  bottom: number;
}

export const folded: Shown = { top: 0, bottom: 0 };

/** The regions of a diff with `originalCount` and `modifiedCount` lines, in order. */
export function regions(changes: LineChange[], originalCount: number, modifiedCount: number): Region[] {
  // Between changes, and before and after them, the versions keep in step.
  const gaps: Region[] = [];
  let [original, modified] = [1, 1];
  for (const change of changes) {
    gaps.push({ original, modified, length: change.original[0] - original });
    [original, modified] = [change.original[1], change.modified[1]];
  }
  gaps.push({ original, modified, length: originalCount + 1 - original });

  const found: Region[] = [];
  for (const gap of gaps) {
    const atStart = gap.original === 1 && gap.modified === 1;
    const atEnd = gap.original + gap.length === originalCount + 1 && gap.modified + gap.length === modifiedCount + 1;
    // At the start or the end of the file, lines are kept on the side of the change only.
    if ((atStart || atEnd) && gap.length >= CONTEXT + MINIMUM) {
      const skip = atEnd && !atStart ? CONTEXT : 0;
      found.push({ original: gap.original + skip, modified: gap.modified + skip, length: gap.length - (atStart !== atEnd ? CONTEXT : 0) });
    } else if (gap.length >= CONTEXT * 2 + MINIMUM) {
      found.push({ original: gap.original + CONTEXT, modified: gap.modified + CONTEXT, length: gap.length - CONTEXT * 2 });
    }
  }
  // A file with nothing changed is not folded away whole (hideUnchangedRegionsFeature.ts).
  return found.length === 1 && found[0].modified === 1 && found[0].length === modifiedCount ? [] : found;
}

/** The ways a region opens and closes, as VS Code's do. */
export const reveal = {
  above: (region: Region, { top, bottom }: Shown, count = REVEAL): Shown => ({ top: Math.min(top + count, region.length - bottom), bottom }),
  below: (region: Region, { top, bottom }: Shown, count = REVEAL): Shown => ({ top, bottom: Math.min(bottom + count, region.length - top) }),
  all: (region: Region, { top }: Shown): Shown => ({ top, bottom: region.length - top }),
  /** Dragging a region's edge: `top` lines at its top, or `bottom` at its bottom, kept within it. */
  to: (region: Region, shown: Shown, edge: "top" | "bottom", count: number): Shown => {
    const room = region.length - (edge === "top" ? shown.bottom : shown.top);
    return { ...shown, [edge]: Math.max(0, Math.min(count, room)) };
  },
};

/**
 * How many lines show at a region's edge once it is dragged `distance` pixels down from where `from` showed: a line
 * comes or goes as the pointer passes the middle of its row. VS Code divides the distance by the line height; lines
 * wrap here, so each row counts as tall as `height` gives for its line's place in the region. Kept within the region
 * by `reveal.to`.
 */
export function dragged(region: Region, edge: "top" | "bottom", from: number, distance: number, height: (line: number) => number) {
  const nth = (n: number) => (edge === "top" ? n : region.length - 1 - n); // the n-th line in from the edge
  let left = edge === "top" ? distance : -distance; // pixels toward the region's middle
  let count = from;
  while (left > 0 && count < region.length && left >= height(nth(count)) / 2) left -= height(nth(count++));
  while (left < 0 && count > 0 && -left > height(nth(count - 1)) / 2) left += height(nth(--count));
  return count;
}

export const isOpen = (region: Region, { top, bottom }: Shown) => top + bottom === region.length;

/** A row standing for the folded lines of region `region`. */
export interface Hidden {
  hidden: number;
  lines: number;
}

/** A row of a region's lines that shows; `first` the first of a region fully open, where it folds again. */
export type Revealed<Row> = Row & { region: number; first: boolean };

/**
 * The rows with each region's folded lines put into one row. `line` gives the modified version's line of a row the
 * same in both versions, and null for a changed one.
 */
export function fold<Row>(rows: Row[], line: (row: Row) => number | null, found: Region[], shown: Shown[]): (Row | Revealed<Row> | Hidden)[] {
  const out: (Row | Revealed<Row> | Hidden)[] = [];
  let index = 0;
  for (const row of rows) {
    const at = line(row);
    while (at !== null && index < found.length && at >= found[index].modified + found[index].length) index++;
    const region = found[index];
    if (at === null || !region || at < region.modified) {
      out.push(row);
      continue;
    }
    const { top, bottom } = shown[index];
    const offset = at - region.modified;
    if (offset >= top && offset < region.length - bottom) {
      if (offset === top) out.push({ hidden: index, lines: region.length - top - bottom });
    } else out.push({ ...row, region: index, first: offset === 0 && isOpen(region, shown[index]) });
  }
  return out;
}
