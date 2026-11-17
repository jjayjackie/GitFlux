// A line-level diff of two texts the daemon did not compare: the two sides of a conflict. VS Code's algorithm runs on
// the daemon (git.diff.file) for files in the repository only; here a longest common subsequence of whole lines is
// enough to lay the sides out with the diff's own renderer (./DiffBody.tsx), changed lines coloured, with no word-level
// marks. Bounded: past `maxCells` (lines of one side times lines of the other, once their common start and end are set
// aside) it gives up with null, and the caller shows the sides as they are. Pure: unit-tested.

import { LINE_DIFF_MAX_CELLS } from "../../../../shared/limits.ts";
import type { LineChange } from "../../../../shared/schemas.ts";

/** A text's lines, as git.diff.file splits a file: at LF or CRLF. */
export const textLines = (text: string) => text.split(/\r\n|\n/);

/**
 * The changes from `original` to `modified`, as git.diff.file gives them: line ranges from 1, the end excluded; a range
 * that is empty on one side sits before that side's next line. Null when the texts are too far apart to compare
 * within `maxCells`.
 */
export function lineDiff(original: readonly string[], modified: readonly string[], maxCells = LINE_DIFF_MAX_CELLS): LineChange[] | null {
  let prefix = 0;
  while (prefix < original.length && prefix < modified.length && original[prefix] === modified[prefix]) prefix++;
  let suffix = 0;
  while (suffix < original.length - prefix && suffix < modified.length - prefix && original[original.length - 1 - suffix] === modified[modified.length - 1 - suffix]) suffix++;
  const a = original.slice(prefix, original.length - suffix);
  const b = modified.slice(prefix, modified.length - suffix);
  const [n, m] = [a.length, b.length];
  if (n === 0 && m === 0) return [];
  if ((n + 1) * (m + 1) > maxCells) return null;
  // lengths[i * (m + 1) + j]: the longest common subsequence of a[i..] and b[j..].
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lengths[i * width + j] = a[i] === b[j] ? lengths[(i + 1) * width + j + 1] + 1 : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);

  const changes: LineChange[] = [];
  let open: { i: number; j: number } | null = null; // where the change being walked started
  const close = (i: number, j: number) => {
    if (!open) return;
    changes.push({ original: [prefix + open.i + 1, prefix + i + 1], modified: [prefix + open.j + 1, prefix + j + 1], inner: [] });
    open = null;
  };
  let [i, j] = [0, 0];
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close(i, j);
      i++;
      j++;
    } else {
      open ??= { i, j };
      if (j >= m || (i < n && lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) i++;
      else j++;
    }
  }
  close(i, j);
  return changes;
}
