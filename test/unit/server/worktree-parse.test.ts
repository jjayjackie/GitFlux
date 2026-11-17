// `git worktree list --porcelain -z` read into the entries git.worktree.list returns.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorktrees } from "../../../server/repo.ts";
import { worktreeEntries } from "../../../server/worktree.ts";

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const ZERO = "0".repeat(40);

/** Each work tree's attributes ended by NUL, an empty record after each, as `-z` prints them. */
const porcelain = (...trees: string[][]) => trees.map((tree) => tree.join("\0") + "\0\0").join("");

test("main first, then linked ones: branch short names, detached, locked, prunable, current", () => {
  const out = porcelain(
    ["worktree /repo/main", `HEAD ${H1}`, "branch refs/heads/main"],
    ["worktree /repo/linked with space", `HEAD ${H2}`, "branch refs/heads/feat/ünïcode", "locked reason: on a\nremovable disk"],
    ["worktree /repo/detached", `HEAD ${H1}`, "detached", "prunable gitdir file points to non-existent location"],
    ["worktree /repo/locked-bare", `HEAD ${H2}`, "detached", "locked"],
  );
  const entries = worktreeEntries(parseWorktrees(out), (path) => path === "/repo/linked with space");
  assert.deepEqual(entries, [
    { path: "/repo/main", head: H1, branch: "main", detached: false, bare: false, locked: false, prunable: false, main: true, current: false },
    { path: "/repo/linked with space", head: H2, branch: "feat/ünïcode", detached: false, bare: false, locked: true, prunable: false, main: false, current: true },
    { path: "/repo/detached", head: H1, branch: null, detached: true, bare: false, locked: false, prunable: true, main: false, current: false },
    { path: "/repo/locked-bare", head: H2, branch: null, detached: true, bare: false, locked: true, prunable: false, main: false, current: false },
  ]);
});

test("a bare main repository, a branch with no commit yet, Windows paths as git prints them", () => {
  const out = porcelain(["worktree C:/repos/bare.git", "bare"], ["worktree C:/repos/new", `HEAD ${ZERO}`, "branch refs/heads/orphan"]);
  const entries = worktreeEntries(parseWorktrees(out), () => false);
  assert.equal(entries.length, 2);
  assert.deepEqual([entries[0].bare, entries[0].head, entries[0].branch, entries[0].main], [true, null, null, true]);
  assert.deepEqual([entries[1].path, entries[1].head, entries[1].branch, entries[1].main], ["C:/repos/new", null, "orphan", false]);
});

test("nothing listed", () => {
  assert.equal(worktreeEntries(parseWorktrees(""), () => true).length, 0);
});
