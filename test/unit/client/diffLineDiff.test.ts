import assert from "node:assert/strict";
import { test } from "node:test";
import { inlineRows } from "../../../client/views/detail/diff/diffRows.ts";
import { lineDiff, textLines } from "../../../client/views/detail/diff/lineDiff.ts";

const ranges = (changes: ReturnType<typeof lineDiff>) => changes?.map((change) => [change.original, change.modified]);

test("the same lines have no changes", () => {
  assert.equal(lineDiff(["a", "b"], ["a", "b"])?.length, 0);
  assert.equal(lineDiff([], [])?.length, 0);
});

test("a changed, an added and a removed line, as git.diff.file gives them", () => {
  assert.deepEqual(ranges(lineDiff(["a", "b", "c"], ["a", "x", "c"])), [[[2, 3], [2, 3]]]);
  assert.deepEqual(ranges(lineDiff(["a", "c"], ["a", "b", "c"])), [[[2, 2], [2, 3]]]);
  assert.deepEqual(ranges(lineDiff(["a", "b", "c"], ["a", "c"])), [[[2, 3], [2, 2]]]);
  assert.deepEqual(ranges(lineDiff(["a"], ["b"])), [[[1, 2], [1, 2]]]);
  assert.deepEqual(ranges(lineDiff([], ["a"])), [[[1, 1], [1, 2]]]);
});

test("several changes keep the lines in common between them", () => {
  const original = ["a", "b", "c", "d", "e"];
  const modified = ["a", "B", "c", "d", "E", "f"];
  const changes = lineDiff(original, modified)!;
  assert.deepEqual(ranges(changes), [
    [
      [2, 3],
      [2, 3],
    ],
    [
      [5, 6],
      [5, 7],
    ],
  ]);
  // Laid out by the diff's own rows: the lines in common stand once, the changes as removed then added.
  assert.deepEqual(
    inlineRows({ original, modified, changes }).map((row) => `${row.kind} ${row.text}`),
    ["same a", "remove b", "add B", "same c", "same d", "remove e", "add E", "add f"],
  );
  for (const change of changes) assert.deepEqual(change.inner, []);
});

test("past its bound it gives up, after setting aside the lines the texts start and end with", () => {
  assert.equal(lineDiff(["a", "b"], ["c", "d"], 3), null);
  // The same start and end are not counted: only the one line between them is compared.
  assert.deepEqual(ranges(lineDiff(["s", "x", "e"], ["s", "y", "e"], 4)), [[[2, 3], [2, 3]]]);
});

test("texts split into lines at LF or CRLF", () => {
  assert.deepEqual(textLines("a\r\nb\nc"), ["a", "b", "c"]);
  assert.deepEqual(textLines("a\n"), ["a", ""]);
});
