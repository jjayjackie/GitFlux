// What git.repo.status reads beyond upstream: every operation under way, stashes, an upstream that is gone.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { startPlugin } from "../helpers/plugin.ts";
import { gitIn, mergeConflict, published, repository } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());
const status = (cwd: string) => plugin.call(repoStatusRpc, { cwd });

test("a merge stopped on a conflict", async (t) => {
  const repo = repository(t);
  const { side } = mergeConflict(repo);
  const now = await status(repo.cwd);
  assert.equal(now.operation?.kind, "merge");
  assert.equal(now.operation?.current, side);
  assert.equal(now.conflicts.length, 1);
  assert.equal(now.rebaseMessage, null);
});

test("a cherry-pick stopped on a conflict", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "side");
  repo.write("a.txt", "side\n");
  const picked = repo.commit("picked change");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "main\n");
  repo.commit("main");
  assert.equal(repo.tryGit("cherry-pick", picked), false);
  const now = await status(repo.cwd);
  assert.equal(now.operation?.kind, "cherry-pick");
  assert.equal(now.operation?.current, picked);
  assert.match(now.operation?.message ?? "", /picked change/);
  assert.deepEqual(
    now.conflicts.map((file) => file.path),
    ["a.txt"],
  );
});

test("a revert stopped on a conflict", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "one\n");
  repo.commit("one");
  repo.write("a.txt", "two\n");
  const reverted = repo.commit("two");
  repo.write("a.txt", "three\n");
  repo.commit("three");
  assert.equal(repo.tryGit("revert", "--no-edit", reverted), false);
  const now = await status(repo.cwd);
  assert.equal(now.operation?.kind, "revert");
  assert.equal(now.operation?.current, reverted);
});

test("an interactive rebase stopped by edit, not by a conflict", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  const base = repo.commit("base");
  repo.write("b.txt", "b\n");
  repo.commit("second");
  repo.write("c.txt", "c\n");
  repo.commit("third");
  // The todo list's first line becomes `edit`: a sequence editor that rewrites it, run by git through its shell.
  gitIn(repo.cwd, ["rebase", "--interactive", base], { GIT_SEQUENCE_EDITOR: "sed -i.bak -e 1s/^pick/edit/" });
  const now = await status(repo.cwd);
  assert.equal(now.operation?.kind, "rebase");
  if (now.operation?.kind !== "rebase") return;
  assert.equal(now.operation.stoppedForEdit, true);
  assert.equal(now.operation.interactive, true);
  assert.deepEqual([now.operation.step, now.operation.total], [1, 2]);
  assert.equal(now.operation.onto, base);
  assert.equal(now.operation.branch, "main");
  gitIn(repo.cwd, ["rebase", "--abort"]);
  assert.equal((await status(repo.cwd)).operation, null);
});

test("bisect under way", async (t) => {
  const repo = repository(t);
  const good = repo.commit("one");
  repo.commit("two");
  repo.commit("three");
  repo.git("bisect", "start", "HEAD", good);
  const now = await status(repo.cwd);
  assert.equal(now.operation?.kind, "bisect");
  assert.equal(now.operation?.current, repo.head());
  repo.git("bisect", "reset");
});

test("stashes are counted, and an upstream that is gone is said to be", async (t) => {
  const { repo } = published(t);
  repo.write("a.txt", "changed\n");
  repo.git("stash", "push", "--quiet");
  repo.write("a.txt", "again\n");
  repo.git("stash", "push", "--quiet");
  let now = await status(repo.cwd);
  assert.equal(now.stashCount, 2);
  assert.equal(now.upstream, "origin/main");
  assert.equal(now.upstreamGone, false);

  repo.git("update-ref", "-d", "refs/remotes/origin/main");
  now = await status(repo.cwd);
  assert.equal(now.upstream, "origin/main");
  assert.equal(now.upstreamGone, true);
});

test("a detached HEAD", async (t) => {
  const repo = repository(t);
  const head = repo.commit("one");
  repo.git("switch", "--quiet", "--detach");
  const now = await status(repo.cwd);
  assert.deepEqual([now.branch, now.detached, now.head], [null, true, head]);
});
