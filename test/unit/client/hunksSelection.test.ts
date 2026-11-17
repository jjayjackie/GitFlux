import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hunk, HunkLine } from "../../../shared/schemas.ts";
import {
  countSelected,
  describeHunk,
  describeSelected,
  isSelected,
  isWholeHunk,
  NO_SELECTION,
  prune,
  selectRange,
  setLines,
  toggleHunk,
  toggleLine,
  toRequest,
} from "../../../client/views/detail/diff/hunkSelection.ts";

const line = (kind: HunkLine["kind"], text: string): HunkLine => ({ kind, text });
// Hunk a: context, delete, add, add, context. Hunk b: delete, context, add.
const a: Hunk = {
  id: "a",
  header: "@@ -1,3 +1,4 @@",
  oldStart: 1,
  oldLines: 3,
  newStart: 1,
  newLines: 4,
  lines: [line("context", "one"), line("delete", "two"), line("add", "TWO"), line("add", "2b"), line("context", "three")],
};
const b: Hunk = {
  id: "b",
  header: "@@ -10,2 +11,2 @@",
  oldStart: 10,
  oldLines: 2,
  newStart: 11,
  newLines: 2,
  lines: [line("delete", "ten"), line("context", "eleven"), line("add", "TEN")],
};
const hunks = [a, b];

test("a press chooses a changed line and a second press lets it go; context lines cannot be chosen", () => {
  let selection = toggleLine(NO_SELECTION, a, 1);
  assert.ok(isSelected(selection, "a", 1));
  assert.equal(countSelected(selection), 1);
  assert.equal(toggleLine(selection, a, 0), selection); // context: nothing changes
  selection = toggleLine(selection, a, 1);
  assert.equal(countSelected(selection), 0);
  assert.equal(selection.has("a"), false); // no empty set is kept
});

test("the selection is never changed in place", () => {
  const first = toggleLine(NO_SELECTION, a, 2);
  const second = toggleLine(first, a, 3);
  assert.equal(countSelected(first), 1);
  assert.equal(countSelected(second), 2);
  assert.equal(countSelected(NO_SELECTION), 0);
  assert.equal(setLines(first, a, [2], true), first); // already so: the same object
});

test("a hunk's box chooses all its changed lines, and lets them all go when they all were", () => {
  const some = toggleLine(NO_SELECTION, a, 2);
  const all = toggleHunk(some, a);
  assert.ok(isWholeHunk(all, a));
  assert.deepEqual([...all.get("a")!].sort(), [1, 2, 3]);
  assert.equal(countSelected(toggleHunk(all, a)), 0);
  assert.equal(isWholeHunk(NO_SELECTION, a), false);
});

test("a Shift-press chooses every changed line between the two presses, across hunks and either way", () => {
  const forward = selectRange(NO_SELECTION, hunks, { id: "a", index: 2 }, { id: "b", index: 2 });
  assert.deepEqual([...forward.get("a")!].sort(), [2, 3]);
  assert.deepEqual([...forward.get("b")!].sort(), [0, 2]);
  const backward = selectRange(NO_SELECTION, hunks, { id: "b", index: 0 }, { id: "a", index: 1 });
  assert.deepEqual([...backward.get("a")!].sort(), [1, 2, 3]);
  assert.deepEqual([...backward.get("b")!], [0]);
  // With no anchor, or an anchor gone, only the line pressed.
  assert.deepEqual([...selectRange(NO_SELECTION, hunks, null, { id: "a", index: 3 }).get("a")!], [3]);
  assert.deepEqual([...selectRange(NO_SELECTION, hunks, { id: "gone", index: 0 }, { id: "a", index: 3 }).get("a")!], [3]);
  // A target that names no line changes nothing.
  assert.equal(selectRange(NO_SELECTION, hunks, null, { id: "a", index: 99 }), NO_SELECTION);
});

test("what is sent: a whole hunk by its id, else its chosen lines in order, hunks in their order", () => {
  let selection = toggleHunk(NO_SELECTION, b);
  selection = toggleLine(selection, a, 3);
  selection = toggleLine(selection, a, 1);
  assert.deepEqual(toRequest(selection, hunks), [{ id: "a", lines: [1, 3] }, { id: "b" }]);
  assert.deepEqual(toRequest(NO_SELECTION, hunks), []);
});

test("a hunk gone from the file, or a line no longer a change, drops out of the selection", () => {
  const selection = toggleLine(toggleLine(NO_SELECTION, a, 1), b, 0);
  const changedB: Hunk = { ...b, id: "b2" };
  const pruned = prune(selection, [a, changedB]);
  assert.equal(pruned.has("b"), false);
  assert.ok(isSelected(pruned, "a", 1));
  assert.equal(prune(selection, hunks), selection); // nothing gone: the same object
  const nowContext: Hunk = { ...a, lines: a.lines.map((each, index) => (index === 1 ? line("context", "two") : each)) };
  assert.equal(countSelected(prune(toggleLine(NO_SELECTION, a, 1), [nowContext])), 0);
});

test("what a discard would lose reads as a unified diff's lines", () => {
  const selection = toggleLine(toggleLine(NO_SELECTION, a, 2), a, 1);
  assert.deepEqual(describeSelected(selection, hunks), ["-two", "+TWO"]);
  assert.deepEqual(describeHunk(b), ["-ten", "+TEN"]);
});
