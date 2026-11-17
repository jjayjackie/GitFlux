// git.commit.cherry-pick and git.commit.revert: order, -x, --no-commit, merge commits and their mainline, a stop on
// conflicts, an empty pick, and what is refused.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import { commitCherryPickRpc, commitRevertRpc } from "../../shared/rpc/commit.ts";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { lf, mergeConflict, repository, type Repo } from "../helpers/repo.ts";
import { commitsAdding, subjectsSince } from "../helpers/sequencer.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const operationOf = async (repo: Repo) => (await plugin.call(repoStatusRpc, { cwd: repo.cwd })).operation?.kind ?? null;

/** main with a base commit, and a branch `side` with commits adding x, y and z. */
function withSide(repo: Repo): { base: string; picks: string[] } {
  repo.write("base.txt", "base\n");
  const base = repo.commit("base");
  repo.git("switch", "--quiet", "--create", "side");
  const picks = commitsAdding(repo, ["x", "y", "z"]);
  repo.git("switch", "--quiet", "main");
  return { base, picks };
}

test("cherry-picks apply in the order given, and -x records where each came from", async (t) => {
  const repo = repository(t);
  const { base, picks } = withSide(repo);
  const [x, , z] = picks;
  assert.deepEqual(await plugin.call(commitCherryPickRpc, { cwd: repo.cwd, hashes: [z, x], recordOrigin: true }), { conflicted: false });
  assert.deepEqual(subjectsSince(repo, base), ["z", "x"]);
  assert.match(repo.git("log", "-1", "--format=%B"), new RegExp(`\\(cherry picked from commit ${x}\\)`));
  assert.equal(await operationOf(repo), null);
});

test("--no-commit leaves the result staged; a revert undoes a commit", async (t) => {
  const repo = repository(t);
  const { base, picks } = withSide(repo);
  await plugin.call(commitCherryPickRpc, { cwd: repo.cwd, hashes: [picks[1]], noCommit: true });
  assert.equal(repo.head(), base);
  assert.deepEqual((await plugin.call(repoStatusRpc, { cwd: repo.cwd })).staged, [{ path: "y.txt", status: "A" }]);
  repo.git("commit", "--quiet", "--message=y here");
  const y = repo.head();

  assert.deepEqual(await plugin.call(commitRevertRpc, { cwd: repo.cwd, hashes: [y] }), { conflicted: false });
  assert.equal(existsSync(repo.path("y.txt")), false);
  assert.match(repo.git("log", "-1", "--format=%s"), /^Revert "y here"$/);
});

test("a pick that conflicts stops with the cherry-pick under way", async (t) => {
  const repo = repository(t);
  mergeConflict(repo);
  repo.git("merge", "--abort");
  const side = repo.git("rev-parse", "side");
  assert.deepEqual(await plugin.call(commitCherryPickRpc, { cwd: repo.cwd, hashes: [side] }), { conflicted: true });
  assert.equal(await operationOf(repo), "cherry-pick");
  // Anything else is refused while it is.
  const busy = await failure(plugin.call(commitRevertRpc, { cwd: repo.cwd, hashes: [side] }));
  assert.equal(busy.code, "OPERATION_IN_PROGRESS");
});

test("a merge commit needs a mainline that is one of its parents", async (t) => {
  const repo = repository(t);
  withSide(repo);
  repo.write("m.txt", "main\n");
  repo.commit("main work");
  repo.git("merge", "--quiet", "--no-ff", "--no-edit", "side");
  const merge = repo.head();
  const missing = await failure(plugin.call(commitRevertRpc, { cwd: repo.cwd, hashes: [merge] }));
  assert.equal(missing.code, "INVALID_ARGUMENT");
  const wrong = await failure(plugin.call(commitRevertRpc, { cwd: repo.cwd, hashes: [merge], mainline: 3 }));
  assert.equal(wrong.code, "INVALID_ARGUMENT");
  assert.equal(repo.head(), merge);
  assert.deepEqual(await plugin.call(commitRevertRpc, { cwd: repo.cwd, hashes: [merge], mainline: 1 }), { conflicted: false });
  for (const name of ["x", "y", "z"]) assert.equal(existsSync(repo.path(`${name}.txt`)), false, name);
  assert.equal(lf(repo.read("m.txt")), "main\n");
});

test("a commit whose change is already there is left out, without an empty commit or a stuck sequencer", async (t) => {
  const repo = repository(t);
  const { picks } = withSide(repo);
  const [x, y] = picks;
  repo.git("cherry-pick", x);
  const before = repo.head();
  assert.deepEqual(await plugin.call(commitCherryPickRpc, { cwd: repo.cwd, hashes: [x] }), { conflicted: false });
  assert.equal(repo.head(), before);
  assert.equal(await operationOf(repo), null);
  // Left out in a sequence, the rest still goes.
  assert.deepEqual(await plugin.call(commitCherryPickRpc, { cwd: repo.cwd, hashes: [x, y] }), { conflicted: false });
  assert.equal(repo.git("log", "-1", "--format=%s"), "y");
  assert.equal(repo.git("rev-parse", "HEAD^"), before);
  assert.equal(await operationOf(repo), null);
});

test("an unknown commit is REF_NOT_FOUND, and a merge under way is OPERATION_IN_PROGRESS", async (t) => {
  const repo = repository(t);
  withSide(repo);
  assert.equal((await failure(plugin.call(commitCherryPickRpc, { cwd: repo.cwd, hashes: ["1".repeat(40)] }))).code, "REF_NOT_FOUND");
  const merging = repository(t);
  const { side } = mergeConflict(merging);
  assert.equal((await failure(plugin.call(commitCherryPickRpc, { cwd: merging.cwd, hashes: [side] }))).code, "OPERATION_IN_PROGRESS");
});
