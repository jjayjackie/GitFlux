// Stashes against real git: saving (tracked, untracked, keep-index, staged-only, by paths), the list, applying,
// popping, conflicts, a stash that is gone (STALE_STATE), dropping, clearing behind its switch, and showing.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import { diffFileRpc } from "../../shared/rpc/diff.ts";
import { stashApplyRpc, stashClearRpc, stashDropRpc, stashListRpc, stashPopRpc, stashSaveRpc, stashShowRpc } from "../../shared/rpc/stash.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { lf, mergeConflict, repository, type Repo } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

/** A repository with one commit holding a.txt and b.txt. */
function base(t: Parameters<typeof repository>[0]): Repo {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.write("b.txt", "b\n");
  repo.commit("root");
  return repo;
}

const save = (repo: Repo, options: { message?: string; includeUntracked?: boolean; keepIndex?: boolean; staged?: boolean; paths?: string[] } = {}) =>
  plugin.call(stashSaveRpc, { cwd: repo.cwd, includeUntracked: false, keepIndex: false, ...options });

const stashes = async (repo: Repo) => (await plugin.call(stashListRpc, { cwd: repo.cwd })).stashes;

test("no stash: an empty list", async (t) => {
  const repo = base(t);
  assert.deepEqual(await plugin.call(stashListRpc, { cwd: repo.cwd }), { stashes: [], truncated: false });
});

test("save and list: the message without git's prefix, the branch, the hash; nothing to save is not created", async (t) => {
  const repo = base(t);
  repo.write("a.txt", "changed\n");
  assert.deepEqual(await save(repo, { message: "my work: 储藏" }), { created: true });
  assert.equal(lf(repo.read("a.txt")), "a\n");
  repo.write("b.txt", "changed\n");
  assert.deepEqual(await save(repo), { created: true });
  const list = await stashes(repo);
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].index, list[0].ref, list[0].branch], [0, "stash@{0}", "main"]);
  assert.match(list[0].message, /^[0-9a-f]{7,} root$/); // git's own: the commit it was made on
  assert.deepEqual([list[1].index, list[1].ref, list[1].message, list[1].branch], [1, "stash@{1}", "my work: 储藏", "main"]);
  assert.equal(list[1].hash, repo.git("rev-parse", "stash@{1}"));
  assert.ok(list[0].time > 0);

  assert.deepEqual(await save(repo), { created: false });
  assert.equal((await stashes(repo)).length, 2);

  repo.git("switch", "--quiet", "--detach");
  repo.write("a.txt", "detached\n");
  await save(repo, { message: "on a detached HEAD" });
  assert.equal((await stashes(repo))[0].branch, null);
});

test("untracked files go with includeUntracked, are shown as added, and open as the stash's", async (t) => {
  const repo = base(t);
  repo.write("a.txt", "changed\n");
  repo.write("new file ü.txt", "untracked\n");
  assert.deepEqual(await save(repo, { includeUntracked: true }), { created: true });
  assert.equal(existsSync(repo.path("new file ü.txt")), false);
  const [stash] = await stashes(repo);
  const shown = await plugin.call(stashShowRpc, { cwd: repo.cwd, hash: stash.hash });
  assert.deepEqual(shown, {
    files: [
      { path: "a.txt", status: "M", additions: 1, deletions: 1 },
      { path: "new file ü.txt", status: "A", additions: 1, deletions: 0 },
    ],
    truncated: false,
  });
  const opened = await plugin.call(diffFileRpc, { cwd: repo.cwd, source: { kind: "stash", hash: stash.hash }, file: shown.files[1] });
  assert.deepEqual(opened, { kind: "file", lines: ["untracked", ""], truncated: false });

  // Without includeUntracked, an untracked file stays where it is.
  repo.write("other.txt", "stays\n");
  repo.write("b.txt", "changed\n");
  await save(repo);
  assert.equal(existsSync(repo.path("other.txt")), true);
});

test("keepIndex leaves what is staged; staged stashes only what is staged", async (t) => {
  const repo = base(t);
  repo.write("a.txt", "staged\n");
  repo.git("add", "a.txt");
  repo.write("b.txt", "unstaged\n");
  await save(repo, { keepIndex: true });
  assert.equal(lf(repo.read("a.txt")), "staged\n");
  assert.equal(lf(repo.read("b.txt")), "b\n");
  assert.equal(repo.git("diff", "--cached", "--name-only"), "a.txt");

  const second = base(t);
  second.write("a.txt", "staged\n");
  second.git("add", "a.txt");
  second.write("b.txt", "unstaged\n");
  await save(second, { staged: true });
  assert.equal(lf(second.read("a.txt")), "a\n");
  assert.equal(lf(second.read("b.txt")), "unstaged\n");
  const [stash] = await stashes(second);
  assert.deepEqual(
    (await plugin.call(stashShowRpc, { cwd: second.cwd, hash: stash.hash })).files.map((file) => file.path),
    ["a.txt"],
  );

  const refused = await failure(save(second, { staged: true, includeUntracked: true }));
  assert.equal(refused.code, "INVALID_ARGUMENT");
});

test("paths: only those files, however they are named", async (t) => {
  const repo = base(t);
  repo.write("dir with space/ファイル.txt", "x\n");
  repo.commit("more");
  repo.write("a.txt", "changed\n");
  repo.write("dir with space/ファイル.txt", "changed\n");
  assert.deepEqual(await save(repo, { paths: ["dir with space/ファイル.txt"] }), { created: true });
  assert.equal(lf(repo.read("dir with space/ファイル.txt")), "x\n");
  assert.equal(lf(repo.read("a.txt")), "changed\n");
  assert.equal((await failure(save(repo, { paths: ["../outside.txt"] }))).code, "INVALID_ARGUMENT");
});

test("apply keeps the stash, pop drops it, --index restores what was staged", async (t) => {
  const repo = base(t);
  repo.write("a.txt", "staged\n");
  repo.git("add", "a.txt");
  await save(repo);
  const [stash] = await stashes(repo);

  assert.deepEqual(await plugin.call(stashApplyRpc, { cwd: repo.cwd, hash: stash.hash, index: true }), { conflicted: false });
  assert.equal(repo.git("diff", "--cached", "--name-only"), "a.txt");
  assert.equal((await stashes(repo)).length, 1);
  repo.git("reset", "--quiet", "--hard");

  assert.deepEqual(await plugin.call(stashPopRpc, { cwd: repo.cwd, hash: stash.hash }), { conflicted: false });
  assert.equal(lf(repo.read("a.txt")), "staged\n");
  assert.equal(repo.git("diff", "--cached", "--name-only"), ""); // without --index, nothing is staged
  assert.equal((await stashes(repo)).length, 0);
});

test("a pop that conflicts says so and keeps the stash; local changes in the way are WOULD_OVERWRITE_CHANGES", async (t) => {
  const repo = base(t);
  repo.write("a.txt", "stashed\n");
  await save(repo);
  const [stash] = await stashes(repo);

  repo.write("a.txt", "local\n");
  assert.equal((await failure(plugin.call(stashApplyRpc, { cwd: repo.cwd, hash: stash.hash }))).code, "WOULD_OVERWRITE_CHANGES");
  assert.equal(lf(repo.read("a.txt")), "local\n");

  repo.commit("committed meanwhile");
  assert.deepEqual(await plugin.call(stashPopRpc, { cwd: repo.cwd, hash: stash.hash }), { conflicted: true });
  assert.equal(repo.git("diff", "--name-only", "--diff-filter=U"), "a.txt");
  assert.deepEqual(
    (await stashes(repo)).map((entry) => entry.hash),
    [stash.hash],
  );
});

test("a stash dropped by another call is STALE_STATE; drop names the stash by hash, whatever its index now", async (t) => {
  const repo = base(t);
  repo.write("a.txt", "first\n");
  await save(repo, { message: "first" });
  repo.write("a.txt", "second\n");
  await save(repo, { message: "second" });
  const [second, first] = await stashes(repo);

  await plugin.call(stashDropRpc, { cwd: repo.cwd, hash: first.hash, confirm: true });
  assert.deepEqual(
    (await stashes(repo)).map((entry) => entry.message),
    ["second"],
  );
  for (const call of [
    () => plugin.call(stashApplyRpc, { cwd: repo.cwd, hash: first.hash }),
    () => plugin.call(stashPopRpc, { cwd: repo.cwd, hash: first.hash }),
    () => plugin.call(stashDropRpc, { cwd: repo.cwd, hash: first.hash, confirm: true }),
  ]) {
    assert.equal((await failure(call())).code, "STALE_STATE");
  }
  assert.equal((await failure(plugin.call(stashDropRpc, { cwd: repo.cwd, hash: second.hash } as never))).code, "CONFIRMATION_REQUIRED");
  await plugin.call(stashDropRpc, { cwd: repo.cwd, hash: second.hash, confirm: true });
  assert.equal((await stashes(repo)).length, 0);
});

test("clear needs the allowForceDelete switch", async (t) => {
  const repo = base(t);
  repo.write("a.txt", "changed\n");
  await save(repo);
  const refused = await failure(plugin.call(stashClearRpc, { cwd: repo.cwd, confirm: true }));
  assert.equal(refused.code, "FORBIDDEN_BY_POLICY");
  assert.equal(refused.setting, "allowForceDelete");
  assert.equal((await stashes(repo)).length, 1);

  const allowed = startPlugin({ policy: { allowForceDelete: true } });
  t.after(() => allowed.stop());
  assert.equal((await failure(allowed.call(stashClearRpc, { cwd: repo.cwd } as never))).code, "CONFIRMATION_REQUIRED");
  await allowed.call(stashClearRpc, { cwd: repo.cwd, confirm: true });
  assert.equal((await stashes(repo)).length, 0);
});

test("show refuses what is not a stash; saving amid conflicts is MERGE_CONFLICT", async (t) => {
  const repo = base(t);
  const commit = repo.head();
  assert.equal((await failure(plugin.call(stashShowRpc, { cwd: repo.cwd, hash: commit }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(stashShowRpc, { cwd: repo.cwd, hash: "f".repeat(40) }))).code, "REF_NOT_FOUND");

  const conflicted = repository(t);
  mergeConflict(conflicted);
  assert.equal((await failure(save(conflicted))).code, "MERGE_CONFLICT");
});
