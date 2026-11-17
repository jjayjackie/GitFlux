// Staging, unstaging and discarding with awkward paths, safety snapshots, the Trash, and conflict markers.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { changesDiscardRpc, changesMarkersRpc, changesStageRpc, changesUnstageRpc } from "../../shared/rpc/changes.ts";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { safetyRestoreRpc, safetySnapshotsRpc } from "../../shared/rpc/safety.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { lf, repository, tempDir } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());
const status = (cwd: string) => plugin.call(repoStatusRpc, { cwd });

// `[ab].txt` is a glob that would match a.txt and b.txt, were paths not taken literally.
const NAMES = ["with space.txt", "ünïcödé.txt", "日本語/ファイル.md", "-n.txt", "[ab].txt", "a.txt", "b.txt"];

test("paths with spaces, non-ASCII letters, a leading dash or pathspec magic are staged, unstaged and discarded as themselves", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  for (const name of NAMES) repo.write(name, "one\n");
  repo.commit("first");
  for (const name of NAMES) repo.write(name, "two\n");

  let now = await status(cwd);
  assert.deepEqual(now.changes.map((file) => file.path).sort(), [...NAMES].sort());
  await plugin.call(changesStageRpc, { cwd, files: [{ path: "[ab].txt", status: "M" }] });
  assert.deepEqual((await status(cwd)).staged, [{ path: "[ab].txt", status: "M" }]);
  await plugin.call(changesStageRpc, { cwd, files: now.changes });
  now = await status(cwd);
  assert.deepEqual(now.staged.map((file) => file.path).sort(), [...NAMES].sort());
  await plugin.call(changesUnstageRpc, { cwd, files: now.staged });
  now = await status(cwd);
  assert.equal(now.staged.length, 0);
  await plugin.call(changesDiscardRpc, { cwd, files: now.changes, trash: false, confirm: true });
  for (const name of NAMES) assert.equal(lf(repo.read(name)), "one\n", name);
});

test("a rename is staged and unstaged as both its paths", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  repo.write("old name.txt", "same\n");
  repo.commit("first");
  repo.git("mv", "old name.txt", "new name.txt");
  let now = await status(cwd);
  assert.deepEqual(now.staged, [{ path: "new name.txt", status: "R", from: "old name.txt" }]);
  await plugin.call(changesUnstageRpc, { cwd, files: now.staged });
  now = await status(cwd);
  assert.deepEqual(
    now.changes.map((file) => `${file.status} ${file.path}`).sort(),
    ["? new name.txt", "D old name.txt"],
  );
  await plugin.call(changesStageRpc, { cwd, files: now.changes });
  assert.deepEqual((await status(cwd)).staged, [{ path: "new name.txt", status: "R", from: "old name.txt" }]);
});

test("discarding tracked changes takes a safety snapshot first, and restoring it brings them back", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  repo.write("a.txt", "kept\n");
  repo.commit("first");
  repo.write("a.txt", "precious work\n");
  await plugin.call(changesDiscardRpc, { cwd, files: [{ path: "a.txt", status: "M" }], trash: false, confirm: true });
  assert.equal(lf(repo.read("a.txt")), "kept\n");

  const { snapshots } = await plugin.call(safetySnapshotsRpc, { cwd });
  assert.equal(snapshots.length, 1);
  const [snapshot] = snapshots;
  assert.match(snapshot.ref, /^refs\/advanced-git\/snapshots\/\d+-\d+$/);
  assert.equal(snapshot.reason, "git.changes.discard");
  assert.equal(snapshot.branch, "main");

  assert.deepEqual(await plugin.call(safetyRestoreRpc, { cwd, ref: snapshot.ref }), { conflicted: false });
  assert.equal(lf(repo.read("a.txt")), "precious work\n");
  assert.equal((await plugin.call(safetySnapshotsRpc, { cwd })).snapshots.length, 1); // kept after restoring

  // Local changes in the way: refused, and nothing is lost.
  repo.write("a.txt", "newer work\n");
  assert.equal((await failure(plugin.call(safetyRestoreRpc, { cwd, ref: snapshot.ref }))).code, "WOULD_OVERWRITE_CHANGES");
  assert.equal(lf(repo.read("a.txt")), "newer work\n");
  assert.equal((await failure(plugin.call(safetyRestoreRpc, { cwd, ref: "refs/advanced-git/snapshots/1-0" }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(safetyRestoreRpc, { cwd, ref: "refs/heads/main" }))).code, "INVALID_ARGUMENT");
});

test("with safetySnapshots off, no snapshot is taken", async (t) => {
  const quiet = startPlugin({ policy: { safetySnapshots: false } });
  t.after(() => quiet.stop());
  const repo = repository(t);
  repo.write("a.txt", "kept\n");
  repo.commit("first");
  repo.write("a.txt", "gone\n");
  await quiet.call(changesDiscardRpc, { cwd: repo.cwd, files: [{ path: "a.txt", status: "M" }], trash: false, confirm: true });
  assert.equal((await quiet.call(safetySnapshotsRpc, { cwd: repo.cwd })).snapshots.length, 0);
});

test("untracked files go to the Trash where there is one; elsewhere the call says it could not", async (t) => {
  const repo = repository(t);
  repo.write("scratch.txt", "scratch\n");
  const result = await plugin.call(changesDiscardRpc, { cwd: repo.cwd, files: [{ path: "scratch.txt", status: "?" }], trash: true, confirm: true });
  if (process.platform !== "darwin") assert.deepEqual(result, { trashFailed: true }); // no Trash is known here
  // Either way the answer is true to the file: in the Trash and gone, or failed and left as it was.
  assert.equal(existsSync(repo.path("scratch.txt")), result.trashFailed);
  // Deleting for good removes it.
  if (existsSync(repo.path("scratch.txt"))) {
    await plugin.call(changesDiscardRpc, { cwd: repo.cwd, files: [{ path: "scratch.txt", status: "?" }], trash: false, confirm: true });
    assert.equal(existsSync(repo.path("scratch.txt")), false);
  }
});

test("markers are looked for only inside the repository: not through a link that leads out of it", async (t) => {
  const repo = repository(t);
  const outside = tempDir(t, "advanced-git-outside-");
  writeFileSync(join(outside, "secret.txt"), "<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n");
  // A directory junction on Windows (no privilege needed), a symbolic link elsewhere.
  symlinkSync(outside, repo.path("link"), "junction");
  assert.equal((await failure(plugin.call(changesMarkersRpc, { cwd: repo.cwd, paths: ["link/secret.txt"] }))).code, "PATH_OUTSIDE_REPOSITORY");
  mkdirSync(repo.path("inside"));
  writeFileSync(repo.path("inside/marked.txt"), "<<<<<<< ours\r\nx\r\n=======\r\ny\r\n>>>>>>> theirs\r\n");
  assert.deepEqual((await plugin.call(changesMarkersRpc, { cwd: repo.cwd, paths: ["inside/marked.txt", "missing.txt"] })).paths, ["inside/marked.txt"]);
});

test("paths that leave the repository are refused before git runs", async (t) => {
  const repo = repository(t);
  for (const path of ["../outside.txt", "/etc/passwd", "a/../../b", "C:\\Windows\\win.ini"]) {
    const { code } = await failure(plugin.call(changesStageRpc, { cwd: repo.cwd, files: [{ path, status: "M" }] }));
    assert.ok(code === "INVALID_ARGUMENT" || code === "PATH_OUTSIDE_REPOSITORY", `${path}: ${code}`);
  }
});
