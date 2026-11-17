// Continuing, skipping and aborting what is under way: a merge, a sequence of cherry-picks, a rebase, a bisect.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { operationControlRpc } from "../../shared/rpc/operation.ts";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { lf, mergeConflict, repository, type Repo } from "../helpers/repo.ts";
import { commitsAdding, conflicted } from "../helpers/sequencer.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const operationOf = async (repo: Repo) => (await plugin.call(repoStatusRpc, { cwd: repo.cwd })).operation?.kind ?? null;

test("with nothing under way: NO_OPERATION; with another operation: STALE_STATE", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.commit("first");
  assert.equal((await failure(plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "merge", action: "continue" }))).code, "NO_OPERATION");
  mergeConflict(repo);
  assert.equal((await failure(plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "rebase", action: "continue" }))).code, "STALE_STATE");
});

test("a merge: continue refuses unresolved files, has no skip, and concludes with git's message", async (t) => {
  const repo = repository(t);
  mergeConflict(repo);
  assert.equal((await failure(plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "merge", action: "continue" }))).code, "MERGE_CONFLICT");
  assert.equal((await failure(plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "merge", action: "skip" }))).code, "INVALID_ARGUMENT");
  repo.write("a.txt", "both\n");
  repo.git("add", "a.txt");
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "merge", action: "continue" }), { conflicted: false, done: true });
  assert.equal(repo.git("log", "-1", "--format=%P").split(" ").length, 2);
  const message = repo.git("log", "-1", "--format=%B");
  assert.match(message, /^Merge branch 'side'/);
  assert.equal(message.includes("#"), false); // git's "# Conflicts:" comments are not kept
  assert.equal(await operationOf(repo), null);
});

test("a merge concluded with a message of one's own, and a merge aborted (with confirm)", async (t) => {
  const repo = repository(t);
  mergeConflict(repo);
  repo.write("a.txt", "both\n");
  repo.git("add", "a.txt");
  await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "merge", action: "continue", message: "Join side, by hand" });
  assert.equal(repo.git("log", "-1", "--format=%s"), "Join side, by hand");

  const other = repository(t);
  const { main } = mergeConflict(other);
  const unconfirmed = await failure(plugin.call(operationControlRpc, { cwd: other.cwd, operation: "merge", action: "abort" } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: other.cwd, operation: "merge", action: "abort", confirm: true }), { conflicted: false, done: true });
  assert.equal(other.head(), main);
  assert.equal(lf(other.read("a.txt")), "main\n");
});

test("cherry-picking two commits: a stop on the first, continued with a message, then the second goes through", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "side");
  repo.write("a.txt", "one\n");
  const one = repo.commit("one");
  repo.write("b.txt", "two\n");
  const two = repo.commit("two");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "main\n");
  repo.commit("main");
  assert.equal(repo.tryGit("cherry-pick", one, two), false);
  assert.equal(await operationOf(repo), "cherry-pick");
  repo.write("a.txt", "one\n");
  repo.git("add", "a.txt");
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "cherry-pick", action: "continue", message: "one, by hand" }), {
    conflicted: false,
    done: true,
  });
  assert.equal(repo.git("log", "-2", "--format=%s"), "two\none, by hand");
  assert.equal(repo.git("log", "-1", "--skip=1", "--format=%an"), "Test Author"); // the picked commit's author
  assert.equal(await operationOf(repo), null);
});

test("cherry-picking two conflicting commits stops again on the second after the first is continued; skip and abort", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "side");
  repo.write("a.txt", "one\n");
  const one = repo.commit("one");
  repo.write("a.txt", "two\n");
  const two = repo.commit("two");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "main\n");
  const main = repo.commit("main");
  assert.equal(repo.tryGit("cherry-pick", one, two), false);
  // Resolved as main's: the first pick is empty then; skipping it, the second stops on its conflict.
  repo.git("checkout", "--ours", "--", "a.txt");
  repo.git("add", "a.txt");
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "cherry-pick", action: "skip" }), { conflicted: true, done: false });
  assert.deepEqual(conflicted(repo), ["a.txt"]);
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "cherry-pick", action: "abort", confirm: true }), { conflicted: false, done: true });
  assert.equal(repo.head(), main);
});

/** topic replays "topic change" of a.txt onto main, which changed it too: the rebase stops on that conflict. */
function rebaseConflict(repo: Repo): { main: string; topic: string } {
  repo.write("a.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "topic");
  repo.write("a.txt", "topic\n");
  const topic = repo.commit("topic change");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "main\n");
  const main = repo.commit("main change");
  repo.git("switch", "--quiet", "topic");
  if (repo.tryGit("rebase", "main")) throw new Error("the rebase was expected to conflict");
  return { main, topic };
}

test("a rebase: continue with a message keeps the replayed commit's author; skip leaves the commit out", async (t) => {
  const repo = repository(t);
  rebaseConflict(repo);
  repo.write("a.txt", "main and topic\n");
  repo.git("add", "a.txt");
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "rebase", action: "continue", message: "topic, reworded" }), {
    conflicted: false,
    done: true,
  });
  assert.equal(repo.git("log", "-1", "--format=%s"), "topic, reworded");
  assert.equal(repo.git("log", "-1", "--format=%an <%ae>"), "Test Author <author@example.com>");
  assert.equal(repo.git("log", "-1", "--skip=1", "--format=%s"), "main change");
  assert.equal(repo.git("symbolic-ref", "--short", "HEAD"), "topic");

  const other = repository(t);
  const { main } = rebaseConflict(other);
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: other.cwd, operation: "rebase", action: "skip" }), { conflicted: false, done: true });
  assert.equal(other.head(), main);
});

test("a rebase aborted goes back to where it started", async (t) => {
  const repo = repository(t);
  const { topic } = rebaseConflict(repo);
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "rebase", action: "abort", confirm: true }), { conflicted: false, done: true });
  assert.equal(repo.head(), topic);
  assert.equal(await operationOf(repo), null);
});

test("a bisect has no continue; skip moves on, abort resets it", async (t) => {
  const repo = repository(t);
  const [first] = commitsAdding(repo, ["a", "b", "c", "d", "e"]);
  repo.git("bisect", "start", "HEAD", first);
  assert.equal(await operationOf(repo), "bisect");
  assert.equal((await failure(plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "bisect", action: "continue" }))).code, "INVALID_ARGUMENT");
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "bisect", action: "skip" }), { conflicted: false, done: false });
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "bisect", action: "abort", confirm: true }), { conflicted: false, done: true });
  assert.equal(repo.git("symbolic-ref", "--short", "HEAD"), "main");
});
