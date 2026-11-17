import assert from "node:assert/strict";
import { test } from "node:test";
import { inlineRows, pairRows } from "../../../client/legacy/diffRows.ts";

// Line 2 changed a word, line 4 was added after line 3; lines 1 and 3 are the same.
const diff = {
  original: ["one", "two words", "three"],
  modified: ["one", "two letters", "three", "four"],
  changes: [
    { original: [2, 3] as [number, number], modified: [2, 3] as [number, number], inner: [{ original: [2, 5, 2, 10] as [number, number, number, number], modified: [2, 5, 2, 12] as [number, number, number, number] }] },
    { original: [4, 4] as [number, number], modified: [4, 5] as [number, number], inner: [] },
  ],
};

test("inline: the removed line above the added one, each numbered in its own version, its changed word marked", () => {
  assert.deepEqual(inlineRows(diff), [
    { kind: "same", original: 1, modified: 1, text: "one", marks: [] },
    { kind: "remove", original: 2, modified: null, text: "two words", marks: [[4, 9]] },
    { kind: "add", original: null, modified: 2, text: "two letters", marks: [[4, 11]] },
    { kind: "same", original: 3, modified: 3, text: "three", marks: [] },
    { kind: "add", original: null, modified: 4, text: "four", marks: [] },
  ]);
});

test("side by side: the versions face each other, with no line opposite an added one", () => {
  assert.deepEqual(
    pairRows(diff).map((row) => [row.changed, row.left?.number ?? null, row.right?.number ?? null]),
    [
      [false, 1, 1],
      [true, 2, 2],
      [false, 3, 3],
      [true, null, 4],
    ],
  );
});

test("a change running over lines marks each line it covers", () => {
  const over = {
    original: ["ab", "cd"],
    modified: ["x"],
    changes: [{ original: [1, 3] as [number, number], modified: [1, 2] as [number, number], inner: [{ original: [1, 2, 2, 2] as [number, number, number, number], modified: [1, 1, 1, 2] as [number, number, number, number] }] }],
  };
  assert.deepEqual(
    inlineRows(over).map((row) => row.marks),
    [[[1, 2]], [[0, 1]], [[0, 1]]],
  );
});
