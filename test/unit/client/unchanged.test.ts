import assert from "node:assert/strict";
import { test } from "node:test";
import { inlineRows, pairRows } from "../../../client/legacy/diffRows.ts";
import { dragged, fold, folded, regions, reveal } from "../../../client/legacy/unchanged.ts";

const change = (original: [number, number], modified: [number, number]) => ({ original, modified, inner: [] });
const lines = (count: number, from = 1) => Array.from({ length: count }, (_, n) => `line ${from + n}`);

test("between two changes, three lines stay on either side and the rest folds", () => {
  // 30 lines, lines 5 and 25 changed: 6 to 24 fold but for 6, 7, 8 and 22, 23, 24; four lines before line 5 and five
  // after line 25 are too few to fold.
  assert.deepEqual(regions([change([5, 6], [5, 6]), change([25, 26], [25, 26])], 30, 30), [{ original: 9, modified: 9, length: 13 }]);
});

test("at the start and the end of the file, lines stay on the side of the change only", () => {
  // 40 lines; line 20 changed.
  assert.deepEqual(regions([change([20, 21], [20, 21])], 40, 40), [
    { original: 1, modified: 1, length: 16 }, // 1 to 19, keeping 17, 18, 19
    { original: 24, modified: 24, length: 17 }, // 21 to 40, keeping 21, 22, 23
  ]);
});

test("too few lines to fold stay as they are", () => {
  // Line 7 changed; six lines before it (three to keep, three to fold) fold, five after it do not.
  assert.deepEqual(regions([change([7, 8], [7, 8])], 12, 12), [{ original: 1, modified: 1, length: 3 }]);
  // Between two changes eight lines are one too few: three, three, and two that would fold.
  assert.deepEqual(regions([change([1, 2], [1, 2]), change([10, 11], [10, 11])], 10, 10), []);
});

test("the regions follow the modified version's lines when lines were added", () => {
  // Two lines added after line 10 of 30.
  assert.deepEqual(regions([change([11, 11], [11, 13])], 30, 32), [
    { original: 1, modified: 1, length: 7 },
    { original: 14, modified: 16, length: 17 },
  ]);
});

test("a file with nothing changed is not folded away", () => {
  assert.deepEqual(regions([], 50, 50), []);
});

test("folding puts a region's hidden lines in one row, inline and side by side", () => {
  const diff = { original: lines(20), modified: [...lines(10), "new", ...lines(10, 11)], changes: [change([11, 11], [11, 12])] };
  const found = regions(diff.changes, 20, 21);
  assert.deepEqual(found, [
    { original: 1, modified: 1, length: 7 },
    { original: 14, modified: 15, length: 7 },
  ]);
  const inline = fold(inlineRows(diff), (row) => (row.kind === "same" ? row.modified : null), found, [folded, folded]);
  assert.deepEqual(
    inline.map((row) => ("hidden" in row ? `hidden ${row.lines}` : `${row.kind} ${row.modified}`)),
    ["hidden 7", "same 8", "same 9", "same 10", "add 11", "same 12", "same 13", "same 14", "hidden 7"],
  );
  const pairs = fold(pairRows(diff), (row) => (row.changed ? null : row.right!.number), found, [folded, folded]);
  assert.equal(pairs.length, 9);
});

test("a region opened at its edges shows those lines, marked as its own", () => {
  const diff = { original: lines(30), modified: [...lines(15), "new", ...lines(15, 16)], changes: [change([16, 16], [16, 17])] };
  const found = regions(diff.changes, 30, 31);
  const region = found[0]; // lines 1 to 12
  const shown = reveal.below(region, reveal.above(region, folded, 2), 3);
  const rows = fold(inlineRows(diff), (row) => (row.kind === "same" ? row.modified : null), found, [shown, folded]);
  assert.deepEqual(
    rows.slice(0, 7).map((row) => ("hidden" in row ? `hidden ${row.lines}` : `${row.modified} ${"region" in row ? "revealed" : ""}`.trim())),
    ["1 revealed", "2 revealed", "hidden 7", "10 revealed", "11 revealed", "12 revealed", "13"],
  );
});

test("a region opens 20 lines at a time from either edge, never more than it holds, and all at once", () => {
  const region = { original: 1, modified: 1, length: 30 };
  assert.deepEqual(reveal.above(region, folded), { top: 20, bottom: 0 });
  assert.deepEqual(reveal.below(region, { top: 20, bottom: 0 }), { top: 20, bottom: 10 });
  assert.deepEqual(reveal.all(region, { top: 5, bottom: 0 }), { top: 5, bottom: 25 });
  assert.deepEqual(reveal.to(region, { top: 0, bottom: 25 }, "top", 9), { top: 5, bottom: 25 });
  assert.deepEqual(reveal.to(region, folded, "bottom", -3), { top: 0, bottom: 0 });
});

test("a dragged edge takes a line as the pointer passes the middle of its row, however tall it is drawn", () => {
  const region = { original: 1, modified: 1, length: 30 };
  const line = () => 24;
  // As VS Code's: the distance over the line height, rounded.
  assert.equal(dragged(region, "top", 0, 30, line), 1);
  assert.equal(dragged(region, "top", 0, 36, line), 2);
  assert.equal(dragged(region, "top", 5, -40, line), 3);
  // The bottom edge shows more as it goes up.
  assert.equal(dragged(region, "bottom", 0, -50, line), 2);
  assert.equal(dragged(region, "bottom", 2, 20, line), 1);
  // Lines 0 and 1 wrap onto two rows: 60 pixels down passes line 0 (48) but not the middle of line 1.
  const wrapped = (n: number) => (n < 2 ? 48 : 24);
  assert.equal(dragged(region, "top", 0, 60, wrapped), 1);
  assert.equal(dragged(region, "top", 0, 80, wrapped), 2);
  // No further than the region holds.
  assert.equal(dragged(region, "top", 0, 10000, line), 30);
});

test("the first line of a region opened in full is where it folds again", () => {
  const diff = { original: lines(20), modified: [...lines(10), "new", ...lines(10, 11)], changes: [change([11, 11], [11, 12])] };
  const found = regions(diff.changes, 20, 21);
  const rows = fold(inlineRows(diff), (row) => (row.kind === "same" ? row.modified : null), found, [reveal.all(found[0], folded), folded]);
  assert.deepEqual(
    rows.filter((row) => "region" in row && row.first).map((row) => ("modified" in row ? row.modified : null)),
    [1],
  );
});
