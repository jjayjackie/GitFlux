// Configuring remotes against real git: add, rename, set-url (fetch and push), remove; URLs checked at both layers
// (the contract's schema and the daemon's assertRemoteUrl); deleting a branch on a remote.

import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { remoteAddRpc, remoteDeleteBranchRpc, remoteListRpc, remoteRemoveRpc, remoteRenameRpc, remoteSetUrlRpc } from "../../shared/rpc/remote.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { hasRef } from "../helpers/refs.ts";
import { bareRemote, fileUrl, published } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

test("add, set-url, rename and remove a remote", async (t) => {
  const { repo, remote } = published(t);
  const cwd = repo.cwd;
  const backup = bareRemote(t);
  const mirror = bareRemote(t);

  await plugin.call(remoteAddRpc, { cwd, name: "backup", url: fileUrl(backup) });
  let { remotes } = await plugin.call(remoteListRpc, { cwd });
  assert.deepEqual(remotes, [
    { name: "backup", fetchUrl: fileUrl(backup), pushUrl: fileUrl(backup) },
    { name: "origin", fetchUrl: fileUrl(remote), pushUrl: fileUrl(remote) },
  ]);
  assert.equal((await failure(plugin.call(remoteAddRpc, { cwd, name: "origin", url: fileUrl(backup) }))).code, "REF_EXISTS");
  assert.equal((await failure(plugin.call(remoteAddRpc, { cwd, name: "x.lock/y", url: fileUrl(backup) }))).code, "INVALID_ARGUMENT");

  await plugin.call(remoteSetUrlRpc, { cwd, name: "backup", url: fileUrl(mirror), push: true });
  assert.equal(repo.git("remote", "get-url", "backup"), fileUrl(backup));
  assert.equal(repo.git("remote", "get-url", "--push", "backup"), fileUrl(mirror));
  await plugin.call(remoteSetUrlRpc, { cwd, name: "backup", url: fileUrl(mirror) });
  assert.equal(repo.git("remote", "get-url", "backup"), fileUrl(mirror));
  assert.equal((await failure(plugin.call(remoteSetUrlRpc, { cwd, name: "nowhere", url: fileUrl(mirror) }))).code, "NO_REMOTE");

  await plugin.call(remoteRenameRpc, { cwd, name: "backup", newName: "mirror" });
  ({ remotes } = await plugin.call(remoteListRpc, { cwd }));
  assert.deepEqual(
    remotes.map((entry) => entry.name),
    ["mirror", "origin"],
  );
  assert.equal((await failure(plugin.call(remoteRenameRpc, { cwd, name: "mirror", newName: "origin" }))).code, "REF_EXISTS");
  assert.equal((await failure(plugin.call(remoteRenameRpc, { cwd, name: "nowhere", newName: "else" }))).code, "NO_REMOTE");

  assert.equal((await failure(plugin.call(remoteRemoveRpc, { cwd, name: "mirror" } as never))).code, "CONFIRMATION_REQUIRED");
  await plugin.call(remoteRemoveRpc, { cwd, name: "mirror", confirm: true });
  ({ remotes } = await plugin.call(remoteListRpc, { cwd }));
  assert.deepEqual(
    remotes.map((entry) => entry.name),
    ["origin"],
  );
  assert.equal((await failure(plugin.call(remoteRemoveRpc, { cwd, name: "mirror", confirm: true }))).code, "NO_REMOTE");
});

test("rename and remove take the remote-tracking branches and upstreams with them", async (t) => {
  const { repo } = published(t);
  const cwd = repo.cwd;
  await plugin.call(remoteRenameRpc, { cwd, name: "origin", newName: "upstream" });
  assert.equal(hasRef(cwd, "refs/remotes/upstream/main"), true);
  assert.equal(hasRef(cwd, "refs/remotes/origin/main"), false);
  assert.equal(repo.git("rev-parse", "--abbrev-ref", "main@{upstream}"), "upstream/main");
  await plugin.call(remoteRemoveRpc, { cwd, name: "upstream", confirm: true });
  assert.equal(hasRef(cwd, "refs/remotes/upstream/main"), false);
  assert.equal(repo.tryGit("rev-parse", "--verify", "--quiet", "main@{upstream}"), false);
});

const TOKEN_USER = `ghp_${"a1".repeat(18)}`;

test("a URL with credentials or a command-running transport is refused, by the schema or by the daemon", async (t) => {
  const { repo, remote } = published(t);
  const cwd = repo.cwd;
  // Refused by the contract's schema before the handler runs.
  const bySchema = ["https://ada:s3cret@example.invalid/r.git", "ext::sh", "fd::3", "-oProxyCommand=x", "--upload-pack=x", "https://example.invalid/a b"];
  // Let through by the schema, refused by core/validate.ts assertRemoteUrl.
  const byDaemon = [`https://${TOKEN_USER}@example.invalid/r.git`, "rad::example.invalid/r", "gopher://example.invalid/r.git"];

  for (const url of bySchema) {
    assert.equal(remoteAddRpc.input.safeParse({ cwd, name: "evil", url }).success, false, url);
    assert.equal((await failure(plugin.call(remoteAddRpc, { cwd, name: "evil", url }))).code, "INVALID_ARGUMENT", url);
  }
  for (const url of byDaemon) {
    assert.equal(remoteAddRpc.input.safeParse({ cwd, name: "evil", url }).success, true, url);
    const refused = await failure(plugin.call(remoteAddRpc, { cwd, name: "evil", url }));
    assert.equal(refused.code, "INVALID_ARGUMENT", url);
    assert.ok(!refused.detail.includes(TOKEN_USER), refused.detail);
    const reset = await failure(plugin.call(remoteSetUrlRpc, { cwd, name: "origin", url }));
    assert.equal(reset.code, "INVALID_ARGUMENT", url);
  }
  const { remotes } = await plugin.call(remoteListRpc, { cwd });
  assert.deepEqual(remotes, [{ name: "origin", fetchUrl: fileUrl(remote), pushUrl: fileUrl(remote) }]);
});

test("delete-branch: with allowRemoteDelete, the branch goes from the remote; missing, unknown remote, and a hook's refusal", async (t) => {
  const allowed = startPlugin({ policy: { allowRemoteDelete: true } });
  t.after(() => allowed.stop());
  const { repo, remote } = published(t);
  const cwd = repo.cwd;
  repo.git("push", "--quiet", "origin", "main:refs/heads/topic");
  repo.git("push", "--quiet", "origin", "main:refs/heads/guarded");

  await allowed.call(remoteDeleteBranchRpc, { cwd, remote: "origin", branch: "topic", confirm: true });
  assert.equal(hasRef(remote, "refs/heads/topic"), false);
  assert.equal(hasRef(cwd, "refs/remotes/origin/topic"), false);
  assert.equal((await failure(allowed.call(remoteDeleteBranchRpc, { cwd, remote: "origin", branch: "topic", confirm: true }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(allowed.call(remoteDeleteBranchRpc, { cwd, remote: "nowhere", branch: "topic", confirm: true }))).code, "NO_REMOTE");

  // The remote's pre-receive hook declines every push.
  const hook = join(remote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\necho 'no deletions here' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  assert.equal((await failure(allowed.call(remoteDeleteBranchRpc, { cwd, remote: "origin", branch: "guarded", confirm: true }))).code, "REMOTE_REJECTED");
  assert.equal(hasRef(remote, "refs/heads/guarded"), true);
});
