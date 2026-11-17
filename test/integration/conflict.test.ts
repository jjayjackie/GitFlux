// Files in conflict: their sides and labels during a merge, a rebase and a cherry-pick, and each way of resolving them.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import { conflictResolveRpc, conflictSidesRpc } from "../../shared/rpc/conflict.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { lf, mergeConflict, repository, type Repo } from "../helpers/repo.ts";
import { blobBytes, conflicted, indexText } from "../helpers/sequencer.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const sides = (repo: Repo, path = "a.txt") => plugin.call(conflictSidesRpc, { cwd: repo.cwd, path });

test("a merge's sides: base, ours, theirs and the file with its markers, labelled as git labels them", async (t) => {
  const repo = repository(t);
  mergeConflict(repo);
  const read = await sides(repo);
  assert.equal(read.base, "base\n");
  assert.equal(read.ours, "main\n");
  assert.equal(read.theirs, "side\n");
  assert.match(lf(read.merged ?? ""), /^<<<<<<< [^\n]*\nmain\n=======\nside\n>>>>>>> [^\n]*\n$/);
  assert.deepEqual([read.oursLabel, read.theirsLabel], ["main", "side"]);
  assert.deepEqual([read.binary, read.truncated], [false, false]);
  // A file that is not in conflict has no sides.
  repo.write("b.txt", "b\n");
  assert.equal((await failure(sides(repo, "b.txt"))).code, "STALE_STATE");
});

test("resolving with theirs, ours, the work-tree file, or text of one's own stages the result", async (t) => {
  const theirs = repository(t);
  mergeConflict(theirs);
  await plugin.call(conflictResolveRpc, { cwd: theirs.cwd, paths: ["a.txt"], resolution: "theirs" });
  assert.equal(lf(theirs.read("a.txt")), "side\n");
  assert.equal(indexText(theirs, "a.txt"), "side\n");
  assert.equal(conflicted(theirs).length, 0);

  const ours = repository(t);
  mergeConflict(ours);
  await plugin.call(conflictResolveRpc, { cwd: ours.cwd, paths: ["a.txt"], resolution: "ours" });
  assert.equal(indexText(ours, "a.txt"), "main\n");
  assert.equal(conflicted(ours).length, 0);

  const marked = repository(t);
  mergeConflict(marked);
  marked.write("a.txt", "by hand\n");
  await plugin.call(conflictResolveRpc, { cwd: marked.cwd, paths: ["a.txt"], resolution: "mark-resolved" });
  assert.equal(indexText(marked, "a.txt"), "by hand\n");

  const written = repository(t);
  mergeConflict(written);
  await plugin.call(conflictResolveRpc, { cwd: written.cwd, path: "a.txt", resolution: "content", content: "mine and theirs\r\nü\r\n" });
  assert.deepEqual(blobBytes(written, ":a.txt"), Buffer.from("mine and theirs\r\nü\r\n"));
  assert.deepEqual(blobBytes(written, ":a.txt"), Buffer.from(written.read("a.txt")));
  // Once resolved, it is not in conflict any more.
  const again = await failure(plugin.call(conflictResolveRpc, { cwd: written.cwd, paths: ["a.txt"], resolution: "ours" }));
  assert.equal(again.code, "STALE_STATE");
});

test("deleting a file in conflict needs confirm; paths outside the repository are refused", async (t) => {
  const repo = repository(t);
  mergeConflict(repo);
  const unconfirmed = await failure(plugin.call(conflictResolveRpc, { cwd: repo.cwd, paths: ["a.txt"], resolution: "delete" } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
  const outside = await failure(plugin.call(conflictResolveRpc, { cwd: repo.cwd, path: "../a.txt", resolution: "content", content: "x" }));
  assert.ok(outside.code === "INVALID_ARGUMENT" || outside.code === "PATH_OUTSIDE_REPOSITORY", outside.code);
  await plugin.call(conflictResolveRpc, { cwd: repo.cwd, paths: ["a.txt"], resolution: "delete", confirm: true });
  assert.equal(existsSync(repo.path("a.txt")), false);
  assert.equal(repo.git("ls-files", "--", "a.txt"), "");
  assert.equal(conflicted(repo).length, 0);
});

test("modified here, deleted there: theirs is null, and taking theirs deletes the file", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "side");
  repo.git("rm", "--quiet", "a.txt");
  repo.commit("delete");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "changed\n");
  repo.commit("change");
  assert.equal(repo.tryGit("merge", "--quiet", "side"), false);
  const read = await sides(repo);
  assert.equal(read.theirs, null);
  assert.equal(read.ours, "changed\n");
  await plugin.call(conflictResolveRpc, { cwd: repo.cwd, paths: ["a.txt"], resolution: "theirs" });
  assert.equal(existsSync(repo.path("a.txt")), false);
  assert.equal(conflicted(repo).length, 0);
  assert.equal(repo.git("ls-files", "--", "a.txt"), "");
});

/** main and topic both changed a.txt from "base". */
function diverged(repo: Repo): void {
  repo.write("a.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "topic");
  repo.write("a.txt", "topic\n");
  repo.commit("topic change");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "main\n");
  repo.commit("main change");
}

test("a rebase's sides: ours is what the branch is replayed onto, theirs the commit being replayed", async (t) => {
  const repo = repository(t);
  diverged(repo);
  repo.git("switch", "--quiet", "topic");
  assert.equal(repo.tryGit("rebase", "main"), false);
  const read = await sides(repo);
  assert.equal(read.ours, "main\n");
  assert.equal(read.theirs, "topic\n");
  assert.equal(read.oursLabel, "main");
  assert.match(read.theirsLabel, /^[0-9a-f]{7,} \(topic change\)$/);
});

test("a cherry-pick's and a revert's sides name the commit applied", async (t) => {
  const repo = repository(t);
  diverged(repo);
  const topic = repo.git("rev-parse", "topic");
  assert.equal(repo.tryGit("cherry-pick", topic), false);
  const picked = await sides(repo);
  assert.equal(picked.oursLabel, "main");
  assert.match(picked.theirsLabel, /^[0-9a-f]{7,} \(topic change\)$/);
  repo.git("cherry-pick", "--abort");

  const second = repository(t);
  second.write("a.txt", "one\n");
  second.commit("one");
  second.write("a.txt", "two\n");
  const two = second.commit("two");
  second.write("a.txt", "three\n");
  second.commit("three");
  assert.equal(second.tryGit("revert", "--no-edit", two), false);
  const reverted = await sides(second);
  assert.match(reverted.theirsLabel, /^parent of [0-9a-f]{7,} \(two\)$/);
});
