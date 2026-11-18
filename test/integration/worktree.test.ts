// Worktrees against real git: adding one on an existing branch, a new branch or a detached HEAD; the list and its
// flags (locked, prunable, main, current); removing one clean, dirty (refused, then forced behind its switch), and
// the work trees that are never removed; pruning.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { worktreeAddRpc, worktreeListRpc, worktreePruneRpc, worktreeRemoveRpc } from "../../shared/rpc/worktree.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { addWorktree, repository, tempDir, type Repo } from "../helpers/repo.ts";
import { newFolder } from "../helpers/trees.ts";

const plugin = startPlugin();
after(() => plugin.stop());

/** Two paths name the same folder (real paths; case-insensitive where the file system is). */
function same(a: string, b: string): boolean {
  const real = (path: string) => {
    const resolved = existsSync(path) ? realpathSync.native(path) : path;
    return process.platform === "win32" || process.platform === "darwin" ? resolved.toLowerCase() : resolved;
  };
  return real(a) === real(b);
}

function base(t: Parameters<typeof repository>[0]): Repo {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.commit("root");
  return repo;
}

const list = async (cwd: string) => (await plugin.call(worktreeListRpc, { cwd })).worktrees;

test("add on an existing branch; the list names the main work tree and the current one", async (t) => {
  const repo = base(t);
  repo.git("branch", "feature");
  const path = newFolder(t, "wt feature ü");
  const added = await plugin.call(worktreeAddRpc, { cwd: repo.cwd, path, branch: "feature" });
  assert.ok(same(added.path, path), added.path);
  assert.equal(existsSync(join(path, "a.txt")), true);

  const fromMain = await list(repo.cwd);
  assert.equal(fromMain.length, 2);
  assert.ok(same(fromMain[0].path, repo.cwd));
  assert.deepEqual([fromMain[0].main, fromMain[0].current, fromMain[0].branch, fromMain[0].head], [true, true, "main", repo.head()]);
  assert.ok(same(fromMain[1].path, path));
  assert.deepEqual([fromMain[1].main, fromMain[1].current, fromMain[1].branch, fromMain[1].detached, fromMain[1].locked, fromMain[1].prunable], [false, false, "feature", false, false, false]);

  const fromLinked = await list(added.path);
  assert.deepEqual(
    fromLinked.map((entry) => [entry.main, entry.current]),
    [
      [true, false],
      [false, true],
    ],
  );

  // A branch checked out elsewhere cannot be checked out again; one that does not exist is not found.
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "again"), branch: "feature" }))).code, "REF_EXISTS");
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "again"), branch: "main" }))).code, "REF_EXISTS");
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "none"), branch: "no-such-branch" }))).code, "REF_NOT_FOUND");
});

test("add on a new branch at a start point, or detached", async (t) => {
  const repo = base(t);
  const first = repo.head();
  repo.write("a.txt", "second\n");
  repo.commit("second");

  const made = await plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "made"), newBranch: "topic/new", startPoint: "HEAD~1" });
  assert.equal(repo.git("rev-parse", "refs/heads/topic/new"), first);
  const entries = await list(repo.cwd);
  const topic = entries.find((entry) => same(entry.path, made.path));
  assert.deepEqual([topic?.branch, topic?.head, topic?.detached], ["topic/new", first, false]);
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "dup"), newBranch: "topic/new" }))).code, "REF_EXISTS");

  const detached = await plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "detached"), detach: true, startPoint: first });
  const entry = (await list(repo.cwd)).find((candidate) => same(candidate.path, detached.path));
  assert.deepEqual([entry?.branch, entry?.head, entry?.detached], [null, first, true]);

  const atHead = await plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "at-head"), detach: true });
  assert.equal((await list(repo.cwd)).find((candidate) => same(candidate.path, atHead.path))?.head, repo.head());

  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "x"), detach: true, startPoint: "no-such-rev" }))).code, "REF_NOT_FOUND");
  const both = await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: newFolder(t, "y"), branch: "main", detach: true }));
  assert.equal(both.code, "INVALID_ARGUMENT");
});

test("the folder: an empty one is fine; a non-empty one, a file, a missing parent or a .git folder are refused", async (t) => {
  const repo = base(t);
  const empty = tempDir(t, "gitflux-empty-");
  await plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: empty, newBranch: "in-empty" });
  assert.equal(existsSync(join(empty, "a.txt")), true);

  const full = tempDir(t, "gitflux-full-");
  writeFileSync(join(full, "keep.txt"), "mine\n");
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: full, newBranch: "n1" }))).code, "REF_EXISTS");
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: join(full, "keep.txt"), newBranch: "n2" }))).code, "REF_EXISTS");
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: join(tempDir(t), "missing", "wt"), newBranch: "n3" }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: join(repo.cwd, ".git", "wt"), newBranch: "n4" }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(worktreeAddRpc, { cwd: repo.cwd, path: "relative/wt" }))).code, "INVALID_ARGUMENT");
  assert.equal(existsSync(join(full, "keep.txt")), true);
  assert.equal(repo.git("branch", "--list", "n1", "n2", "n3", "n4"), "");
});

test("locked and prunable work trees, and pruning", async (t) => {
  const repo = base(t);
  const locked = addWorktree(t, repo, "locked");
  const gone = addWorktree(t, repo, "gone");
  repo.git("worktree", "lock", "--reason", "on a removable disk", locked);
  rmSync(gone, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });

  const entries = await list(repo.cwd);
  assert.equal(entries.length, 3);
  const lockedEntry = entries.find((entry) => entry.branch === "locked");
  const goneEntry = entries.find((entry) => entry.branch === "gone");
  assert.deepEqual([lockedEntry?.locked, lockedEntry?.prunable], [true, false]);
  assert.deepEqual([goneEntry?.locked, goneEntry?.prunable], [false, true]);

  // A locked one is not removed, forced or not.
  const allowed = startPlugin({ policy: { allowForceDelete: true } });
  t.after(() => allowed.stop());
  assert.equal((await failure(allowed.call(worktreeRemoveRpc, { cwd: repo.cwd, path: locked, force: true, confirm: true }))).code, "INVALID_ARGUMENT");
  assert.equal(existsSync(locked), true);

  await plugin.call(worktreePruneRpc, { cwd: repo.cwd });
  assert.deepEqual(
    (await list(repo.cwd)).map((entry) => entry.branch),
    ["main", "locked"],
  );
});

test("remove: clean at once; dirty refused, then forced only with the switch; the main and the current never", async (t) => {
  const repo = base(t);
  const clean = addWorktree(t, repo, "clean");
  await plugin.call(worktreeRemoveRpc, { cwd: repo.cwd, path: clean, force: false, confirm: true });
  assert.equal(existsSync(clean), false);
  assert.equal((await list(repo.cwd)).length, 1);

  const dirty = addWorktree(t, repo, "dirty");
  writeFileSync(join(dirty, "a.txt"), "local change\n");
  writeFileSync(join(dirty, "new.txt"), "untracked\n");
  assert.equal((await failure(plugin.call(worktreeRemoveRpc, { cwd: repo.cwd, path: dirty, force: false, confirm: true }))).code, "WOULD_OVERWRITE_CHANGES");
  const forbidden = await failure(plugin.call(worktreeRemoveRpc, { cwd: repo.cwd, path: dirty, force: true, confirm: true }));
  assert.equal(forbidden.code, "FORBIDDEN_BY_POLICY");
  assert.equal(forbidden.setting, "allowForceDelete");
  assert.equal((await failure(plugin.call(worktreeRemoveRpc, { cwd: repo.cwd, path: dirty, force: false } as never))).code, "CONFIRMATION_REQUIRED");
  assert.equal(existsSync(join(dirty, "new.txt")), true);

  const allowed = startPlugin({ policy: { allowForceDelete: true } });
  t.after(() => allowed.stop());
  await allowed.call(worktreeRemoveRpc, { cwd: repo.cwd, path: dirty, force: true, confirm: true });
  assert.equal(existsSync(dirty), false);
  // Its tracked change was recorded first.
  assert.notEqual(repo.git("for-each-ref", "--format=%(refname)", "refs/gitflux/snapshots/"), "");

  const linked = addWorktree(t, repo, "linked");
  assert.equal((await failure(allowed.call(worktreeRemoveRpc, { cwd: repo.cwd, path: repo.cwd, force: true, confirm: true }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(allowed.call(worktreeRemoveRpc, { cwd: linked, path: linked, force: true, confirm: true }))).code, "INVALID_ARGUMENT");
  const elsewhere = tempDir(t);
  mkdirSync(join(elsewhere, "folder"));
  assert.equal((await failure(allowed.call(worktreeRemoveRpc, { cwd: repo.cwd, path: join(elsewhere, "folder"), force: true, confirm: true }))).code, "REF_NOT_FOUND");
  assert.equal(existsSync(join(elsewhere, "folder")), true);
  assert.equal(existsSync(linked), true);
});
