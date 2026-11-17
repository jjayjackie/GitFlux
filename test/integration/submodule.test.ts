// Submodules against real git, with a local bare repository as their remote (file:// URLs; the test environment allows
// them, see test/helpers/env.ts): the list and each state (clean, modified, ahead, uninitialised), update (--init,
// --remote, by path), sync after the URL changed, and URLs redacted.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { submoduleListRpc, submoduleSyncRpc, submoduleUpdateRpc } from "../../shared/rpc/submodule.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { bareRemote, fileUrl, gitIn, repoAt, repository, type Repo } from "../helpers/repo.ts";
import { advanceLibrary, cloneWithoutSubmodules, commitAs, libraryRemote, parentWith } from "../helpers/trees.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const ONE = "libs/one";
const TWO = "deps/ライブラリ x";

const list = async (repo: Repo) => (await plugin.call(submoduleListRpc, { cwd: repo.cwd })).submodules;
const byPath = async (repo: Repo, path: string) => (await list(repo)).find((entry) => entry.path === path);

test("no .gitmodules: no submodule", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.commit("root");
  assert.deepEqual(await plugin.call(submoduleListRpc, { cwd: repo.cwd }), { submodules: [], truncated: false });
});

test("initialised submodules: clean, then modified, then ahead", async (t) => {
  const library = libraryRemote(t);
  const parent = parentWith(t, library.remote, [ONE, TWO]);
  const entries = await list(parent);
  assert.deepEqual(
    entries.map((entry) => entry.path),
    [ONE, TWO],
  );
  for (const entry of entries) {
    assert.equal(entry.root, parent.path(entry.path));
    assert.equal(entry.url, fileUrl(library.remote));
    assert.deepEqual([entry.state, entry.hash, entry.expected], ["clean", library.first, library.first]);
  }

  parent.write(`${ONE}/lib.txt`, "changed here\n");
  assert.equal((await byPath(parent, ONE))?.state, "modified");
  assert.equal((await byPath(parent, TWO))?.state, "clean");

  // A commit of its own in the submodule: checked out at another commit than the parent records.
  const moved = commitAs(repoAt(parent.path(TWO)), "Sub Author", "sub: own", { "own.txt": "own\n" });
  const ahead = await byPath(parent, TWO);
  assert.deepEqual([ahead?.state, ahead?.hash, ahead?.expected], ["ahead", moved, library.first]);
});

test("uninitialised submodules, and update --init by path, then all", async (t) => {
  const library = libraryRemote(t);
  const parent = parentWith(t, library.remote, [ONE, TWO]);
  const clone = cloneWithoutSubmodules(t, parent);
  for (const entry of await list(clone)) {
    assert.deepEqual([entry.state, entry.hash, entry.expected], ["uninitialized", null, library.first]);
    assert.equal(entry.describe, undefined);
  }

  await plugin.call(submoduleUpdateRpc, { cwd: clone.cwd, paths: [TWO], init: true, recursive: false });
  assert.equal((await byPath(clone, TWO))?.state, "clean");
  assert.equal((await byPath(clone, ONE))?.state, "uninitialized");
  assert.equal(existsSync(join(clone.path(TWO), "lib.txt")), true);

  await plugin.call(submoduleUpdateRpc, { cwd: clone.cwd, init: true, recursive: true });
  assert.deepEqual(
    (await list(clone)).map((entry) => entry.state),
    ["clean", "clean"],
  );

  assert.equal((await failure(plugin.call(submoduleUpdateRpc, { cwd: clone.cwd, paths: ["README.md"], init: true, recursive: false }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(submoduleUpdateRpc, { cwd: clone.cwd, paths: ["../elsewhere"], init: true, recursive: false }))).code, "INVALID_ARGUMENT");
});

test("update --remote moves to the tip of the tracked branch; a plain update goes back to the recorded commit", async (t) => {
  const library = libraryRemote(t);
  const parent = parentWith(t, library.remote, [ONE]);
  const tip = advanceLibrary(library, "two\n");
  await plugin.call(submoduleUpdateRpc, { cwd: parent.cwd, paths: [ONE], init: false, recursive: false, remote: true });
  const moved = await byPath(parent, ONE);
  assert.deepEqual([moved?.state, moved?.hash, moved?.expected], ["ahead", tip, library.first]);

  await plugin.call(submoduleUpdateRpc, { cwd: parent.cwd, init: false, recursive: false });
  assert.deepEqual([(await byPath(parent, ONE))?.state, (await byPath(parent, ONE))?.hash], ["clean", library.first]);
});

test("sync copies a changed URL into the submodule's configuration", async (t) => {
  const library = libraryRemote(t);
  const parent = parentWith(t, library.remote, [ONE, TWO]);
  const mirror = bareRemote(t);
  gitIn(library.work.cwd, ["push", "--quiet", fileUrl(mirror), "main"]);
  parent.git("config", "--file", ".gitmodules", `submodule.${ONE}.url`, fileUrl(mirror));

  await plugin.call(submoduleSyncRpc, { cwd: parent.cwd, paths: [ONE] });
  assert.equal(parent.git("config", "--get", `submodule.${ONE}.url`), fileUrl(mirror));
  assert.equal(gitIn(parent.path(ONE), ["config", "--get", "remote.origin.url"]), fileUrl(mirror));
  assert.equal(gitIn(parent.path(TWO), ["config", "--get", "remote.origin.url"]), fileUrl(library.remote));
  assert.equal((await byPath(parent, ONE))?.url, fileUrl(mirror));

  await plugin.call(submoduleSyncRpc, { cwd: parent.cwd, recursive: true });
  assert.equal((await failure(plugin.call(submoduleSyncRpc, { cwd: parent.cwd, paths: ["not/a/submodule"] }))).code, "INVALID_ARGUMENT");
});

test("a URL with credentials in .gitmodules is listed redacted", async (t) => {
  const library = libraryRemote(t);
  const parent = parentWith(t, library.remote, [ONE]);
  parent.git("config", "--file", ".gitmodules", "submodule.private.path", "private");
  parent.git("config", "--file", ".gitmodules", "submodule.private.url", "https://ada:s3cret-pass@example.invalid/private.git");
  const entry = await byPath(parent, "private");
  assert.equal(entry?.state, "uninitialized");
  assert.equal(entry?.url, "https://***@example.invalid/private.git");
  assert.equal((await byPath(parent, ONE))?.state, "clean");
});
