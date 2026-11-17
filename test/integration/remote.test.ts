// Remotes against local bare repositories reached by file:// URLs: fetch, pull in each mode, push, sync, and the safety
// rules of a forced push; URLs with credentials redacted wherever they show.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { remoteFetchRpc, remoteListRpc, remotePullRpc, remotePushRpc, remoteSyncRpc } from "../../shared/rpc/remote.ts";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { clone, fileUrl, gitIn, published, repository } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

test("fetch brings what the remote gained; pull fast-forwards", async (t) => {
  const { repo, remote } = published(t);
  const other = clone(t, fileUrl(remote));
  other.write("theirs.txt", "theirs\n");
  const theirs = other.commit("theirs");
  other.git("push", "--quiet");

  await plugin.call(remoteFetchRpc, { cwd: repo.cwd });
  const now = await plugin.call(repoStatusRpc, { cwd: repo.cwd });
  assert.deepEqual([now.ahead, now.behind], [0, 1]);
  assert.deepEqual(await plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "ff-only" }), { result: "fast-forward" });
  assert.equal(repo.head(), theirs);
  assert.deepEqual(await plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "merge" }), { result: "up-to-date" });
  await plugin.call(remoteFetchRpc, { cwd: repo.cwd, all: true, prune: true, tags: true });
  assert.equal((await failure(plugin.call(remoteFetchRpc, { cwd: repo.cwd, remote: "nowhere" }))).code, "NO_REMOTE");
});

/** A published repository and a clone that pushed a commit of its own on top of the same base. */
function diverged(t: Parameters<typeof published>[0], file = "theirs.txt") {
  const { repo, remote } = published(t);
  const other = clone(t, fileUrl(remote));
  other.write(file, "theirs\n");
  other.commit("theirs");
  other.git("push", "--quiet");
  return { repo, remote, other };
}

test("pull merges, or rebases, diverged histories", async (t) => {
  const { repo } = diverged(t);
  repo.write("mine.txt", "mine\n");
  repo.commit("mine");
  assert.equal((await failure(plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "ff-only" }))).code, "NON_FAST_FORWARD");
  assert.deepEqual(await plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "merge" }), { result: "merged" });
  assert.equal(repo.git("log", "-1", "--format=%P").split(" ").length, 2);

  const second = diverged(t);
  second.repo.write("mine.txt", "mine\n");
  second.repo.commit("mine");
  assert.deepEqual(await plugin.call(remotePullRpc, { cwd: second.repo.cwd, mode: "rebase" }), { result: "rebased" });
  assert.equal(second.repo.git("log", "-1", "--format=%s"), "mine");
  assert.equal(second.repo.git("log", "-1", "--format=%P").split(" ").length, 1);
});

test("a pull that stops on a conflict says so, and leaves the merge under way", async (t) => {
  const { repo } = diverged(t, "a.txt");
  repo.write("a.txt", "mine\n");
  repo.commit("mine");
  assert.deepEqual(await plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "merge" }), { result: "conflict" });
  const now = await plugin.call(repoStatusRpc, { cwd: repo.cwd });
  assert.equal(now.operation?.kind, "merge");
  assert.deepEqual(
    now.conflicts.map((file) => file.path),
    ["a.txt"],
  );
});

test("a branch without an upstream has nothing to pull or sync from", async (t) => {
  const { repo } = published(t);
  repo.git("switch", "--quiet", "--create", "lonely");
  assert.equal((await failure(plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "merge" }))).code, "NO_UPSTREAM");
  assert.equal((await failure(plugin.call(remoteSyncRpc, { cwd: repo.cwd, mode: "merge" }))).code, "NO_UPSTREAM");
});

test("pull from a named remote: the branch named is pulled; with neither a branch nor an upstream, NO_UPSTREAM", async (t) => {
  const { repo, remote } = published(t);
  const other = clone(t, fileUrl(remote));
  other.git("switch", "--quiet", "--create", "feat");
  other.write("f.txt", "f\n");
  const feat = other.commit("feat");
  other.git("push", "--quiet", "origin", "feat");
  repo.git("switch", "--quiet", "--create", "lonely");
  assert.equal((await failure(plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "merge", remote: "origin" }))).code, "NO_UPSTREAM");
  assert.deepEqual(await plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "ff-only", remote: "origin", branch: "feat" }), { result: "fast-forward" });
  assert.equal(repo.head(), feat);
  assert.equal((await failure(plugin.call(remotePullRpc, { cwd: repo.cwd, mode: "merge", remote: "origin", branch: "no-such-branch" }))).code, "REF_NOT_FOUND");
});

test("push publishes a new branch with its upstream; a push the remote cannot fast-forward is NON_FAST_FORWARD", async (t) => {
  const { repo, remote } = diverged(t);
  repo.git("switch", "--quiet", "--create", "feature");
  repo.write("f.txt", "f\n");
  repo.commit("feature");
  await plugin.call(remotePushRpc, { cwd: repo.cwd, force: "none", setUpstream: true });
  assert.equal((await plugin.call(repoStatusRpc, { cwd: repo.cwd })).upstream, "origin/feature");
  assert.equal(gitIn(remote, ["rev-parse", "refs/heads/feature"]), repo.head());

  repo.git("switch", "--quiet", "main");
  repo.write("mine.txt", "mine\n");
  repo.commit("mine");
  assert.equal((await failure(plugin.call(remotePushRpc, { cwd: repo.cwd, force: "none" }))).code, "NON_FAST_FORWARD");
  assert.equal((await failure(plugin.call(remotePushRpc, { cwd: repo.cwd, force: "none", branch: "no-such-branch" }))).code, "REF_NOT_FOUND");
});

test("sync with nothing to push only pulls", async (t) => {
  const { repo } = diverged(t);
  assert.deepEqual(await plugin.call(remoteSyncRpc, { cwd: repo.cwd, mode: "rebase" }), { pulled: true, pushed: false, conflicted: false });
  assert.deepEqual(await plugin.call(remoteSyncRpc, { cwd: repo.cwd, mode: "merge" }), { pulled: false, pushed: false, conflicted: false });
});

// --- forced pushes ---------------------------------------------------------------------------------

/** A feature branch pushed, then amended locally: only a forced push can publish it. */
function rewritten(t: Parameters<typeof published>[0], branch = "feature") {
  const { repo, remote } = published(t);
  repo.git("switch", "--quiet", "--create", branch);
  repo.write("f.txt", "first\n");
  repo.commit("feature");
  repo.git("push", "--quiet", "--set-upstream", "origin", branch);
  repo.write("f.txt", "amended\n");
  repo.git("add", "f.txt");
  repo.git("commit", "--quiet", "--amend", "--no-edit");
  return { repo, remote };
}

test("a forced push is refused without confirm, then by default policy, naming the setting", async (t) => {
  const { repo } = rewritten(t);
  const unconfirmed = await failure(plugin.call(remotePushRpc, { cwd: repo.cwd, force: "with-lease" } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
  const forbidden = await failure(plugin.call(remotePushRpc, { cwd: repo.cwd, force: "with-lease", confirm: true }));
  assert.equal(forbidden.code, "FORBIDDEN_BY_POLICY");
  assert.equal(forbidden.setting, "allowForcePush");
});

test("a protected branch is never force-pushed, whatever the switch says", async (t) => {
  const allowed = startPlugin({ policy: { allowForcePush: true, protectedBranches: ["main", "release/*"] } });
  t.after(() => allowed.stop());
  const { repo } = rewritten(t, "release/1.0");
  const { code } = await failure(allowed.call(remotePushRpc, { cwd: repo.cwd, force: "with-lease", confirm: true }));
  assert.equal(code, "PROTECTED_BRANCH");
  // Nor under another name on the remote.
  repo.git("switch", "--quiet", "--create", "harmless");
  const renamed = await failure(allowed.call(remotePushRpc, { cwd: repo.cwd, force: "with-lease", confirm: true, branch: "harmless", remoteBranch: "main" }));
  assert.equal(renamed.code, "PROTECTED_BRANCH");
});

test("with the switch on, an unprotected branch is force-pushed with a lease, and a stale lease is refused", async (t) => {
  const allowed = startPlugin({ policy: { allowForcePush: true } });
  t.after(() => allowed.stop());
  const { repo, remote } = rewritten(t);
  await allowed.call(remotePushRpc, { cwd: repo.cwd, force: "with-lease", confirm: true });
  assert.equal(gitIn(remote, ["rev-parse", "refs/heads/feature"]), repo.head());

  // Someone else pushes to the branch; this repository has not fetched it, so its lease is stale.
  const other = clone(t, fileUrl(remote));
  other.git("switch", "--quiet", "feature");
  other.write("g.txt", "theirs\n");
  other.commit("theirs");
  other.git("push", "--quiet");
  const theirs = other.head();
  repo.write("f.txt", "amended again\n");
  repo.git("add", "f.txt");
  repo.git("commit", "--quiet", "--amend", "--no-edit");
  const { code } = await failure(allowed.call(remotePushRpc, { cwd: repo.cwd, force: "with-lease", confirm: true }));
  assert.ok(code === "NON_FAST_FORWARD" || code === "REMOTE_REJECTED", code);
  assert.equal(gitIn(remote, ["rev-parse", "refs/heads/feature"]), theirs); // their work is still there
});

test("an invalid policy document counts as the defaults: every switch off", async (t) => {
  const plugin2 = startPlugin({ policy: { allowForcePush: true } });
  t.after(() => plugin2.stop());
  plugin2.settings.get("safety")?.invalidate();
  const { repo } = rewritten(t);
  assert.equal((await failure(plugin2.call(remotePushRpc, { cwd: repo.cwd, force: "with-lease", confirm: true }))).code, "FORBIDDEN_BY_POLICY");
});

// --- credentials ------------------------------------------------------------------------------------

test("a URL with credentials in the configuration is listed redacted, and an error quoting it is redacted", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.commit("root");
  // Written straight to the configuration: git.remote.add would refuse it.
  repo.git("remote", "add", "origin", "https://ada:s3cret-pass@example.invalid/r.git");
  const { remotes } = await plugin.call(remoteListRpc, { cwd: repo.cwd });
  assert.deepEqual(remotes, [{ name: "origin", fetchUrl: "https://***@example.invalid/r.git", pushUrl: "https://***@example.invalid/r.git" }]);

  const failed = await failure(plugin.call(remoteFetchRpc, { cwd: repo.cwd, remote: "origin" }));
  assert.ok(!failed.detail.includes("s3cret-pass"), failed.detail);
  assert.ok(["NETWORK", "AUTH_FAILED", "UNKNOWN"].includes(failed.code), failed.code);
});
