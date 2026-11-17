// Which rows of a tree-shaped list stay at its top while it scrolls, as VS Code's sticky scroll keeps them.

import type { ReactNode } from "react";

/** One row of a list whose rows are all one height. */
export interface Row {
  key: string;
  depth: number; // how many rows it is nested in
  inside: number; // how many of the rows after it are nested in it, while it shows them
  onPress: () => void; // what pressing the row does in the list: folds it, or opens its file
  /** The row, doing `onPress` when pressed; kept at the top, its chevron does `onChevron`, the rest of it `onPress`. */
  render: (onPress: () => void, onChevron?: () => void) => ReactNode;
}

/** A row kept at the top: its index, and how far below the top it is drawn. */
export interface Held {
  index: number;
  top: number;
}

const MOST = 7; // rows kept at most, as VS Code's workbench.tree.stickyScrollMaxItemCount
const SHARE = 0.4; // of the view's height, the most the kept rows take in VS Code

/**
 * A row that holds others stays once its own place has scrolled under the rows kept above it, one row lower for each
 * level it is nested; the row after the last of its own pushes it up and out. As in VS Code, the deepest give way
 * past seven rows or 40% of the view. `scrolled` is how far the first row is above the top of the view, `height` the
 * height of every row, `view` that of the view.
 */
export function held(rows: Pick<Row, "depth" | "inside">[], scrolled: number, height: number, view: number): Held[] {
  const kept: Held[] = [];
  rows.forEach(({ depth, inside }, index) => {
    const slot = depth * height;
    const end = (index + 1 + inside) * height - scrolled; // the bottom of what it holds, from the top of the view
    // Kept at its depth, in place of a row there before it and of what that row held.
    if (inside > 0 && index * height - scrolled < slot && end > slot) kept.splice(depth, Infinity, { index, top: Math.min(slot, end - height) });
  });
  const over = kept.findIndex(({ top }, level) => level >= MOST || top + height > view * SHARE);
  return over === -1 ? kept : kept.slice(0, over);
}
