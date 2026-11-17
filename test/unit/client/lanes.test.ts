import assert from "node:assert/strict";
import { test } from "node:test";
import { layout } from "../../../client/legacy/lanes.ts";

const commit = (hash: string, ...parents: string[]) => ({ hash, parents });

test("a straight history stays in one lane", () => {
  const rails = layout([commit("c", "b"), commit("b", "a"), commit("a")]);
  assert.deepEqual(rails, [
    { col: 0, through: [], into: [], out: [0], below: [0] },
    { col: 0, through: [], into: [0], out: [0], below: [0] },
    { col: 0, through: [], into: [0], out: [], below: [] },
  ]);
});

test("a merge opens a second lane that closes at the fork", () => {
  // m merges f into the branch of c; both c and f descend from b.
  const rails = layout([commit("m", "c", "f"), commit("f", "b"), commit("c", "b"), commit("b")]);
  assert.deepEqual(rails, [
    { col: 0, through: [], into: [], out: [0, 1], below: [0, 1] },
    { col: 1, through: [0], into: [1], out: [1], below: [0, 1] },
    { col: 0, through: [1], into: [0], out: [0], below: [0, 1] },
    { col: 0, through: [], into: [0, 1], out: [], below: [] },
  ]);
});

test("an unmerged branch keeps its lane down to the commit it forked from", () => {
  // f forked from a; c and b came later on the main branch.
  const rails = layout([commit("c", "b"), commit("f", "a"), commit("b", "a"), commit("a")]);
  assert.deepEqual(
    rails.map((rail) => rail.col),
    [0, 1, 0, 0],
  );
  assert.deepEqual(rails[2].through, [1]); // f's lane passes b, which is not its parent
  assert.deepEqual(rails[3].into, [0, 1]);
});

test("a merge parent joins the lane that already waits for it", () => {
  // m merges b, which the side branch s is already waiting for.
  const rails = layout([commit("s", "b"), commit("m", "a", "b"), commit("b", "a"), commit("a")]);
  assert.deepEqual(rails[1], { col: 1, through: [0], into: [], out: [1, 0], below: [0, 1] });
  assert.deepEqual(rails[2], { col: 0, through: [1], into: [0], out: [0], below: [0, 1] });
});

test("a freed lane is used again", () => {
  const rails = layout([commit("x", "a"), commit("y", "a"), commit("a", "r"), commit("z", "r"), commit("r")]);
  assert.deepEqual(
    rails.map((rail) => rail.col),
    [0, 1, 0, 1, 0],
  );
});

test("lanes run off the end when history is cut short", () => {
  const rails = layout([commit("m", "c", "f"), commit("c", "b")]);
  assert.deepEqual(rails[1].below, [0, 1]);
});
