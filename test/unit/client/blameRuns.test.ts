import assert from "node:assert/strict";
import { test } from "node:test";
import { ageLevels, blameRuns, runIndexes } from "../../../client/views/detail/blame/runs.ts";

const line = (n: number, hash: string) => ({ line: n, hash, originalLine: n });

test("consecutive lines of one commit make one run; a commit coming back starts another", () => {
  const lines = [line(1, "a"), line(2, "a"), line(3, "b"), line(4, "a"), line(5, "a"), line(6, "a")];
  assert.deepEqual(blameRuns(lines), [
    { hash: "a", start: 0, end: 2 },
    { hash: "b", start: 2, end: 3 },
    { hash: "a", start: 3, end: 6 },
  ]);
  assert.deepEqual(runIndexes(blameRuns(lines), lines.length), [0, 0, 1, 2, 2, 2]);
});

test("no lines, no runs", () => {
  assert.equal(blameRuns([]).length, 0);
  assert.equal(runIndexes([], 0).length, 0);
});

test("ages are ranked from oldest to newest; lines not committed are the newest", () => {
  const times = new Map<string, number | null>([
    ["old", 100],
    ["mid", 200],
    ["new", 300],
    ["zero", null],
  ]);
  const levels = ageLevels(times, 5);
  assert.equal(levels.get("old"), 0);
  assert.equal(levels.get("mid"), 2);
  assert.equal(levels.get("new"), 4);
  assert.equal(levels.get("zero"), 4);
});

test("one commit alone is the newest; commits of the same time share a level", () => {
  assert.equal(ageLevels(new Map([["only", 5]]), 4).get("only"), 3);
  const same = ageLevels(
    new Map([
      ["a", 10],
      ["b", 10],
      ["c", 20],
    ]),
    3,
  );
  assert.equal(same.get("a"), same.get("b"));
  assert.equal(same.get("c"), 2);
});
