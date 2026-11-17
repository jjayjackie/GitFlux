import assert from "node:assert/strict";
import { test } from "node:test";
import { layout } from "../../../client/views/graph/lanes.ts";
import {
  ancestry,
  badgeColour,
  fullRef,
  limitRefs,
  shortRef,
  badgeLayout,
  EMPTY_SELECTION,
  isFullHash,
  isZeroHash,
  mirroredRemotes,
  newestFirst,
  oldestFirst,
  pressMode,
  pruneSelection,
  select,
  shortHash,
  sortRefs,
  targetsOf,
  widestRail,
} from "../../../client/views/graph/model.ts";
import type { Ref } from "../../../shared/schemas.ts";

const ref = (kind: Ref["kind"], name: string): Ref => ({ kind, name });

test("hashes: full ones are shortened to seven digits, anything else is kept", () => {
  const hash = "a".repeat(40);
  assert.equal(isFullHash(hash), true);
  assert.equal(isFullHash("b".repeat(64)), true);
  assert.equal(isFullHash("main"), false);
  assert.equal(shortHash(hash), "aaaaaaa");
  assert.equal(shortHash("HEAD~2"), "HEAD~2");
  assert.equal(isZeroHash("0".repeat(40)), true);
  assert.equal(isZeroHash(hash), false);
});

test("badges come in order: the checked-out branch, local branches, remote branches, tags", () => {
  const refs = [ref("tag", "v1"), ref("remote", "origin/main"), ref("branch", "feat"), ref("head", "main"), ref("tag", "v0")];
  assert.deepEqual(
    sortRefs(refs).map((r) => r.name),
    ["main", "feat", "origin/main", "v1", "v0"],
  );
});

test("badges past the room fold into the overflow, in badge order", () => {
  const refs = [ref("tag", "v1"), ref("branch", "a"), ref("branch", "b"), ref("head", "main")];
  const fitted = badgeLayout(refs, 2);
  assert.deepEqual(
    fitted.shown.map((r) => r.name),
    ["main", "a"],
  );
  assert.deepEqual(
    fitted.hidden.map((r) => r.name),
    ["b", "v1"],
  );
  const all = badgeLayout(refs, 10);
  assert.equal(all.shown.length, 4);
  assert.equal(all.hidden.length, 0);
  const none = badgeLayout(refs, 0);
  assert.equal(none.shown.length, 0);
  assert.equal(none.hidden.length, 4);
});

test("a remote branch on the commit of its local namesake is a mirror", () => {
  const mirrors = mirroredRemotes([ref("head", "main"), ref("remote", "origin/main"), ref("remote", "origin/other"), ref("branch", "feat/x"), ref("remote", "up/feat/x")]);
  assert.deepEqual([...mirrors].sort(), ["origin/main", "up/feat/x"]);
});

test("badge colours follow the checked-out branch, its upstream and its base", () => {
  const followed = { upstream: "origin/main", base: "origin/develop", all: false };
  assert.equal(badgeColour(ref("head", "main"), followed), "head");
  assert.equal(badgeColour(ref("remote", "origin/main"), followed), "upstream");
  assert.equal(badgeColour(ref("remote", "origin/develop"), followed), "base");
  assert.equal(badgeColour(ref("tag", "origin/main"), followed), "plain");
  assert.equal(badgeColour(ref("branch", "feat"), followed), "plain");
  assert.equal(badgeColour(ref("branch", "feat"), { ...followed, all: true }), "lane");
});

test("the widest rail counts every lane a row touches", () => {
  const commit = (hash: string, ...parents: string[]) => ({ hash, parents });
  assert.equal(widestRail(layout([commit("c", "b"), commit("b", "a"), commit("a")])), 1);
  assert.equal(widestRail(layout([commit("m", "c", "f"), commit("f", "b"), commit("c", "b"), commit("b")])), 2);
  assert.equal(widestRail([]), 0);
});

test("modifier keys are read from the press event, defensively", () => {
  assert.equal(pressMode(undefined), "single");
  assert.equal(pressMode(null), "single");
  assert.equal(pressMode({}), "single");
  assert.equal(pressMode({ nativeEvent: { ctrlKey: true } }), "toggle");
  assert.equal(pressMode({ nativeEvent: { metaKey: true } }), "toggle");
  assert.equal(pressMode({ nativeEvent: { shiftKey: true, metaKey: true } }), "range");
  assert.equal(pressMode({ shiftKey: true }), "range");
  assert.equal(pressMode({ nativeEvent: { ctrlKey: "yes" } }), "single");
});

test("selection: a press selects one, Ctrl/⌘ toggles, Shift ranges from the anchor", () => {
  const order = ["e", "d", "c", "b", "a"];
  let selection = select(EMPTY_SELECTION, order, "d", "single");
  assert.deepEqual(selection, { keys: ["d"], anchor: "d" });
  selection = select(selection, order, "b", "toggle");
  assert.deepEqual(selection, { keys: ["d", "b"], anchor: "b" });
  selection = select(selection, order, "d", "toggle");
  assert.deepEqual(selection, { keys: ["b"], anchor: "d" });
  selection = select({ keys: ["d"], anchor: "d" }, order, "a", "range");
  assert.deepEqual(selection, { keys: ["d", "c", "b", "a"], anchor: "d" });
  selection = select(selection, order, "e", "range");
  assert.deepEqual(selection, { keys: ["e", "d"], anchor: "d" });
  // A range with no anchor, or from a key that is gone, selects just the key.
  assert.deepEqual(select(EMPTY_SELECTION, order, "c", "range"), { keys: ["c"], anchor: "c" });
  assert.deepEqual(select({ keys: [], anchor: "zz" }, order, "c", "range"), { keys: ["c"], anchor: "c" });
});

test("selection: keys gone after a reload are dropped, and an unchanged selection is the same object", () => {
  const selection = { keys: ["d", "b"], anchor: "b" };
  assert.equal(pruneSelection(selection, ["d", "c", "b"]), selection);
  assert.deepEqual(pruneSelection(selection, ["d", "c"]), { keys: ["d"], anchor: null });
});

test("picked commits apply oldest first; reverted ones newest first", () => {
  const order = ["e", "d", "c", "b", "a"];
  assert.deepEqual(oldestFirst(["d", "a", "c"], order), ["a", "c", "d"]);
  assert.deepEqual(newestFirst(["a", "d", "c"], order), ["d", "c", "a"]);
});

test("a press acts on the selection when the pressed commit is part of it", () => {
  assert.deepEqual(targetsOf({ keys: ["a", "b"], anchor: "a" }, "b"), ["a", "b"]);
  assert.deepEqual(targetsOf({ keys: ["a", "b"], anchor: "a" }, "c"), ["c"]);
  assert.deepEqual(targetsOf({ keys: ["a"], anchor: "a" }, "a"), ["a"]);
});

test("ancestry of HEAD, as far as the loaded commits tell", () => {
  const commit = (hash: string, ...parents: string[]) => ({ hash, parents });
  // HEAD is h; s is on a side branch; x, r's parent, is beyond the loaded page.
  const commits = [commit("s", "b"), commit("h", "m"), commit("m", "b", "f"), commit("f", "r"), commit("b", "r"), commit("r", "x")];
  assert.equal(ancestry(commits, "h", "b"), "yes");
  assert.equal(ancestry(commits, "h", "f"), "yes"); // through the merge's second parent
  assert.equal(ancestry(commits, "h", "x"), "yes"); // named as a parent, though not loaded
  assert.equal(ancestry(commits, "h", "s"), "no");
  assert.equal(ancestry(commits, "h", "h"), "no"); // HEAD itself
  assert.equal(ancestry(commits, "h", "q"), "unknown"); // not loaded, not named
  assert.equal(ancestry(commits, "zz", "b"), "unknown"); // HEAD not loaded
  assert.equal(ancestry(commits, null, "b"), "no");
});

test("a ref the graph is limited to has its full name, so a branch and a tag of one name do not mix", () => {
  assert.equal(fullRef("branch", "main"), "refs/heads/main");
  assert.equal(fullRef("head", "main"), "refs/heads/main");
  assert.equal(fullRef("remote", "origin/feature/x"), "refs/remotes/origin/feature/x");
  assert.equal(fullRef("tag", "main"), "refs/tags/main");
  assert.equal(shortRef("refs/remotes/origin/feature/x"), "origin/feature/x");
  assert.equal(shortRef("refs/tags/v1.0.0"), "v1.0.0");
  assert.equal(shortRef("HEAD"), "HEAD");
});

test("show only, also show and hide change the refs the graph is limited to; none left shows every branch", () => {
  const main = "refs/heads/main";
  const tag = "refs/tags/v1.0.0";
  assert.deepEqual(limitRefs(null, "only", main), [main]);
  assert.deepEqual(limitRefs([main, tag], "only", tag), [tag]);
  assert.deepEqual(limitRefs(null, "add", tag), [tag]);
  assert.deepEqual(limitRefs([main], "add", tag), [main, tag]);
  assert.deepEqual(limitRefs([main], "add", main), [main]);
  assert.deepEqual(limitRefs([main, tag], "remove", main), [tag]);
  assert.equal(limitRefs([main], "remove", main), null);
  assert.equal(limitRefs(null, "remove", main), null);
  const many = Array.from({ length: 150 }, (_, index) => `refs/heads/b${index}`);
  assert.equal(limitRefs(many, "add", main)?.length, 100);
});
