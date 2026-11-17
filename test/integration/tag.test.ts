// Tags against real git: listing newest first with annotated tags peeled to their commit, creating lightweight and
// annotated tags, deleting, pushing one or all to a local bare remote (never forcing), and deleting one there.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { tagCreateRpc, tagDeleteRemoteRpc, tagDeleteRpc, tagListRpc, tagPushRpc } from "../../shared/rpc/tag.ts";
import { IDENTITY } from "../helpers/env.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { hasRef, started } from "../helpers/refs.ts";
import { bareRemote, fileUrl, gitIn, repository } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

/** A repository with two commits at fixed old times, so that tag order does not depend on the clock. */
function twoCommits(t: Parameters<typeof started>[0]) {
  const repo = started(t, 1_600_000_000);
  const root = repo.head();
  repo.write("b.txt", "b\n");
  const second = repo.commit("second", { time: 1_650_000_000 });
  return { repo, root, second };
}

test("create and list: lightweight at HEAD or a target, annotated with a message, newest first", async (t) => {
  const { repo, root, second } = twoCommits(t);
  const cwd = repo.cwd;
  await plugin.call(tagCreateRpc, { cwd, name: "light-old", target: root });
  await plugin.call(tagCreateRpc, { cwd, name: "light-new" });
  await plugin.call(tagCreateRpc, { cwd, name: "annotated", target: root, message: "Release notes\n\nThe body." });
  assert.equal(repo.git("cat-file", "-t", "refs/tags/annotated"), "tag");
  assert.equal(repo.git("cat-file", "-t", "refs/tags/light-old"), "commit");
  assert.equal(repo.git("tag", "--list", "--format=%(contents)", "annotated").trim(), "Release notes\n\nThe body.");

  const { tags, truncated } = await plugin.call(tagListRpc, { cwd });
  assert.equal(truncated, false);
  assert.deepEqual(
    tags.map((tag) => tag.name),
    ["annotated", "light-new", "light-old"],
  );
  const [annotated, lightNew, lightOld] = tags;
  assert.deepEqual([annotated.hash, annotated.annotated, annotated.message, annotated.tagger], [root, true, "Release notes", IDENTITY.GIT_COMMITTER_NAME]);
  assert.ok(annotated.time > 1_650_000_000);
  assert.deepEqual(lightNew, { name: "light-new", hash: second, annotated: false, time: 1_650_000_000 });
  assert.deepEqual(lightOld, { name: "light-old", hash: root, annotated: false, time: 1_600_000_000 });
});

test("create refuses an existing name, an unknown target, a name git refuses, and a repository with no commit", async (t) => {
  const { repo } = twoCommits(t);
  const cwd = repo.cwd;
  await plugin.call(tagCreateRpc, { cwd, name: "v1" });
  const head = repo.git("rev-parse", "refs/tags/v1");
  assert.equal((await failure(plugin.call(tagCreateRpc, { cwd, name: "v1", target: "HEAD~1" }))).code, "REF_EXISTS");
  assert.equal(repo.git("rev-parse", "refs/tags/v1"), head); // never moved
  assert.equal((await failure(plugin.call(tagCreateRpc, { cwd, name: "v2", target: "no-such-rev" }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(tagCreateRpc, { cwd, name: "x.lock/y" }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(tagCreateRpc, { cwd, name: "v3", message: "   " }))).code, "INVALID_ARGUMENT");

  const empty = repository(t);
  assert.equal((await failure(plugin.call(tagCreateRpc, { cwd: empty.cwd, name: "v1" }))).code, "REF_NOT_FOUND");
});

test("delete: a local tag goes; a missing one is REF_NOT_FOUND; confirm is required", async (t) => {
  const { repo } = twoCommits(t);
  const cwd = repo.cwd;
  repo.git("tag", "v1");
  await plugin.call(tagDeleteRpc, { cwd, name: "v1", confirm: true });
  assert.equal(hasRef(cwd, "refs/tags/v1"), false);
  assert.equal((await failure(plugin.call(tagDeleteRpc, { cwd, name: "v1", confirm: true }))).code, "REF_NOT_FOUND");
  repo.git("tag", "v2");
  assert.equal((await failure(plugin.call(tagDeleteRpc, { cwd, name: "v2" } as never))).code, "CONFIRMATION_REQUIRED");
  assert.equal(hasRef(cwd, "refs/tags/v2"), true);
});

test("push: one tag, then all; a tag that differs on the remote is refused, never forced", async (t) => {
  const { repo, root, second } = twoCommits(t);
  const cwd = repo.cwd;
  const remote = bareRemote(t);
  repo.git("remote", "add", "origin", fileUrl(remote));
  repo.git("tag", "--annotate", "--message=one", "v1", root);
  repo.git("tag", "v2", second);

  await plugin.call(tagPushRpc, { cwd, remote: "origin", name: "v1" });
  assert.equal(gitIn(remote, ["rev-parse", "refs/tags/v1^{commit}"]), root);
  assert.equal(hasRef(remote, "refs/tags/v2"), false);
  await plugin.call(tagPushRpc, { cwd, remote: "origin" });
  assert.equal(gitIn(remote, ["rev-parse", "refs/tags/v2"]), second);

  assert.equal((await failure(plugin.call(tagPushRpc, { cwd, remote: "nowhere", name: "v1" }))).code, "NO_REMOTE");
  assert.equal((await failure(plugin.call(tagPushRpc, { cwd, remote: "origin", name: "missing" }))).code, "REF_NOT_FOUND");

  repo.git("tag", "--delete", "v2");
  repo.git("tag", "v2", root);
  const moved = await failure(plugin.call(tagPushRpc, { cwd, remote: "origin", name: "v2" }));
  assert.ok(["REF_EXISTS", "NON_FAST_FORWARD", "REMOTE_REJECTED"].includes(moved.code), moved.code);
  assert.equal(gitIn(remote, ["rev-parse", "refs/tags/v2"]), second);
});

test("delete-remote: with allowRemoteDelete, the tag goes from the remote and stays here; a missing one is REF_NOT_FOUND", async (t) => {
  const allowed = startPlugin({ policy: { allowRemoteDelete: true } });
  t.after(() => allowed.stop());
  const { repo } = twoCommits(t);
  const cwd = repo.cwd;
  const remote = bareRemote(t);
  repo.git("remote", "add", "origin", fileUrl(remote));
  repo.git("tag", "v1");
  repo.git("push", "--quiet", "origin", "refs/tags/v1");

  await allowed.call(tagDeleteRemoteRpc, { cwd, remote: "origin", name: "v1", confirm: true });
  assert.equal(hasRef(remote, "refs/tags/v1"), false);
  assert.equal(hasRef(cwd, "refs/tags/v1"), true);
  assert.equal((await failure(allowed.call(tagDeleteRemoteRpc, { cwd, remote: "origin", name: "v1", confirm: true }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(allowed.call(tagDeleteRemoteRpc, { cwd, remote: "nowhere", name: "v1", confirm: true }))).code, "NO_REMOTE");
});
