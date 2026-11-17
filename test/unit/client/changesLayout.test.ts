import assert from "node:assert/strict";
import { test } from "node:test";
import { shareHeights } from "../../../client/views/changes/layout.ts";
import { discardChosen, discardPlan } from "../../../client/views/changes/discard.ts";

test("sections that fit get what they ask for", () => {
  assert.deepEqual(shareHeights([48, 72], 500), [48, 72]);
});

test("a short section keeps its rows and a long one takes the rest", () => {
  // Two staged files above two thousand changed ones.
  assert.deepEqual(shareHeights([48, 48_000], 400), [48, 352]);
});

test("long sections share the room evenly", () => {
  assert.deepEqual(shareHeights([10_000, 20_000], 400), [200, 200]);
  assert.deepEqual(shareHeights([24, 10_000, 20_000], 424), [24, 200, 200]);
});

test("no room, or a room smaller than nothing, gives nothing", () => {
  assert.deepEqual(shareHeights([48, 96], 0), [0, 0]);
  assert.deepEqual(shareHeights([48, 96], -20), [0, 0]);
  assert.equal(shareHeights([], 300).length, 0);
});

test("discarding: tracked, untracked, or both", () => {
  const tracked = { path: "a.ts", status: "M" };
  const deleted = { path: "b.ts", status: "D" };
  const untracked = { path: "c.ts", status: "?" };
  assert.equal(discardPlan([tracked]).kind, "tracked");
  assert.equal(discardPlan([tracked]).restore, false);
  assert.equal(discardPlan([deleted]).restore, true);
  assert.equal(discardPlan([untracked]).kind, "untracked");
  const mixed = discardPlan([tracked, untracked]);
  assert.equal(mixed.kind, "mixed");
  assert.deepEqual(
    discardChosen(mixed, false).map((file) => file.path),
    ["a.ts"],
  );
  assert.deepEqual(
    discardChosen(mixed, true).map((file) => file.path),
    ["a.ts", "c.ts"],
  );
});
