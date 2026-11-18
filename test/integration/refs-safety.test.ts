// The safety rules of branches, remotes and tags against real git: hard resets (policy, confirm, protection, the
// snapshot that brings the work back), force deletes, deletions on a remote, names that look like options or hold
// control characters (refused by the schema) or that git refuses (refused by the daemon), and checkout with
// `dirty: "stash"`, which never loses local changes.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import {
  branchCheckoutRpc,
  branchCreateRpc,
  branchDeleteRpc,
  branchMergeRpc,
  branchRebaseRpc,
  branchRenameRpc,
  branchResetRpc,
  branchSetUpstreamRpc,
} from "../../shared/rpc/branch.ts";
import {
  remoteAddRpc,
  remoteDeleteBranchRpc,
  remoteFetchRpc,
  remotePullRpc,
  remotePushRpc,
  remoteRemoveRpc,
  remoteRenameRpc,
  remoteSetUrlRpc,
} from "../../shared/rpc/remote.ts";
import { safetyRestoreRpc, safetySnapshotsRpc } from "../../shared/rpc/safety.ts";
import { tagCreateRpc, tagDeleteRemoteRpc, tagDeleteRpc, tagPushRpc } from "../../shared/rpc/tag.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { branchOf, hasRef, sideBranch, started, stashes } from "../helpers/refs.ts";
import { addWorktree, lf, published } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

// --- hard reset ---------------------------------------------------------------------------------------------

test("a hard reset is refused by default, naming allowHardReset, and without confirm", async (t) => {
  const repo = started(t);
  repo.git("switch", "--quiet", "--create", "feature");
  repo.write("a.txt", "edited\n");
  const forbidden = await failure(plugin.call(branchResetRpc, { cwd: repo.cwd, target: "HEAD", mode: "hard", confirm: true }));
  assert.equal(forbidden.code, "FORBIDDEN_BY_POLICY");
  assert.equal(forbidden.setting, "allowHardReset");
  const unconfirmed = await failure(plugin.call(branchResetRpc, { cwd: repo.cwd, target: "HEAD", mode: "hard" } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
  assert.equal(lf(repo.read("a.txt")), "edited\n");
});

test("with allowHardReset, a protected branch is still refused; an unprotected one is reset after a snapshot that restores the work", async (t) => {
  const allowed = startPlugin({ policy: { allowHardReset: true } });
  t.after(() => allowed.stop());
  const repo = started(t);
  const cwd = repo.cwd;
  repo.write("a.txt", "edited\n");
  assert.equal((await failure(allowed.call(branchResetRpc, { cwd, target: "HEAD", mode: "hard", confirm: true }))).code, "PROTECTED_BRANCH");
  assert.equal(lf(repo.read("a.txt")), "edited\n");

  repo.git("switch", "--quiet", "--create", "feature");
  const { snapshot } = await allowed.call(branchResetRpc, { cwd, target: "HEAD", mode: "hard", confirm: true });
  assert.ok(snapshot !== null && snapshot.startsWith("refs/gitflux/snapshots/"), String(snapshot));
  assert.equal(lf(repo.read("a.txt")), "a\n");

  const { snapshots } = await allowed.call(safetySnapshotsRpc, { cwd });
  const taken = snapshots.find((entry) => entry.ref === snapshot);
  assert.ok(taken !== undefined);
  assert.deepEqual([taken.reason, taken.branch], ["git.branch.reset", "feature"]);

  assert.deepEqual(await allowed.call(safetyRestoreRpc, { cwd, ref: snapshot }), { conflicted: false });
  assert.equal(lf(repo.read("a.txt")), "edited\n");

  // Nothing to record, or snapshots off: no snapshot, and the reset still happens.
  repo.git("checkout", "--", "a.txt");
  assert.deepEqual(await allowed.call(branchResetRpc, { cwd, target: "HEAD", mode: "hard", confirm: true }), { snapshot: null });
  const off = startPlugin({ policy: { allowHardReset: true, safetySnapshots: false } });
  t.after(() => off.stop());
  repo.write("a.txt", "edited again\n");
  assert.deepEqual(await off.call(branchResetRpc, { cwd, target: "HEAD", mode: "hard", confirm: true }), { snapshot: null });
  assert.equal(lf(repo.read("a.txt")), "a\n");

  // A detached HEAD has no branch to protect.
  repo.git("switch", "--quiet", "--detach", "main");
  repo.write("a.txt", "detached edit\n");
  const detached = await allowed.call(branchResetRpc, { cwd, target: "HEAD", mode: "hard", confirm: true });
  assert.ok(detached.snapshot !== null);
  assert.equal(lf(repo.read("a.txt")), "a\n");
});

// --- force delete ---------------------------------------------------------------------------------------------

test("deleting an unmerged branch with force needs allowForceDelete, and never a protected branch", async (t) => {
  const repo = started(t);
  const cwd = repo.cwd;
  sideBranch(repo, "unmerged", "c.txt", "c\n");
  sideBranch(repo, "release/1.0", "r.txt", "r\n");
  const forbidden = await failure(plugin.call(branchDeleteRpc, { cwd, name: "unmerged", force: true, confirm: true }));
  assert.equal(forbidden.code, "FORBIDDEN_BY_POLICY");
  assert.equal(forbidden.setting, "allowForceDelete");
  assert.equal(hasRef(cwd, "refs/heads/unmerged"), true);

  const allowed = startPlugin({ policy: { allowForceDelete: true } });
  t.after(() => allowed.stop());
  await allowed.call(branchDeleteRpc, { cwd, name: "unmerged", force: true, confirm: true });
  assert.equal(hasRef(cwd, "refs/heads/unmerged"), false);
  assert.equal((await failure(allowed.call(branchDeleteRpc, { cwd, name: "release/1.0", force: true, confirm: true }))).code, "PROTECTED_BRANCH");
  assert.equal(hasRef(cwd, "refs/heads/release/1.0"), true);
});

// --- deleting on a remote ---------------------------------------------------------------------------------------

test("deleting a branch or a tag on a remote needs allowRemoteDelete; a protected branch is never deleted there", async (t) => {
  const { repo, remote } = published(t);
  const cwd = repo.cwd;
  repo.git("push", "--quiet", "origin", "main:refs/heads/topic", "main:refs/heads/release/1.0");
  repo.git("tag", "v1");
  repo.git("push", "--quiet", "origin", "refs/tags/v1");

  const branch = await failure(plugin.call(remoteDeleteBranchRpc, { cwd, remote: "origin", branch: "topic", confirm: true }));
  assert.deepEqual([branch.code, branch.setting], ["FORBIDDEN_BY_POLICY", "allowRemoteDelete"]);
  const tag = await failure(plugin.call(tagDeleteRemoteRpc, { cwd, remote: "origin", name: "v1", confirm: true }));
  assert.deepEqual([tag.code, tag.setting], ["FORBIDDEN_BY_POLICY", "allowRemoteDelete"]);
  assert.equal(hasRef(remote, "refs/heads/topic"), true);
  assert.equal(hasRef(remote, "refs/tags/v1"), true);

  const allowed = startPlugin({ policy: { allowRemoteDelete: true } });
  t.after(() => allowed.stop());
  for (const name of ["main", "release/1.0"]) {
    assert.equal((await failure(allowed.call(remoteDeleteBranchRpc, { cwd, remote: "origin", branch: name, confirm: true }))).code, "PROTECTED_BRANCH", name);
    assert.equal(hasRef(remote, `refs/heads/${name}`), true);
  }
  const unconfirmed = await failure(allowed.call(remoteDeleteBranchRpc, { cwd, remote: "origin", branch: "topic" } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
  assert.equal(hasRef(remote, "refs/heads/topic"), true);
});

// --- names --------------------------------------------------------------------------------------------------------

/** Names that look like options, or hold control characters or whitespace. */
const HOSTILE = ["--force", "-d", "--upload-pack=x", "bad\u0001name", "line\nbreak", "tab\tname", "del\u007fname", "esc\u001b[0m"];

type NameCall = readonly [string, (name: string) => Promise<unknown>];

test("every name, revision and URL input refuses option-like names and control characters with INVALID_ARGUMENT", async (t) => {
  const { repo } = published(t);
  const cwd = repo.cwd;
  const url = "https://example.invalid/r.git";
  const calls: NameCall[] = [
    ["branch.create name", (name) => plugin.call(branchCreateRpc, { cwd, name, checkout: false })],
    ["branch.create startPoint", (name) => plugin.call(branchCreateRpc, { cwd, name: "ok", startPoint: name, checkout: true })],
    ["branch.checkout branch", (name) => plugin.call(branchCheckoutRpc, { cwd, target: { kind: "branch", name }, dirty: "stash" })],
    ["branch.checkout remote", (name) => plugin.call(branchCheckoutRpc, { cwd, target: { kind: "remote", name }, dirty: "fail" })],
    ["branch.checkout localName", (name) => plugin.call(branchCheckoutRpc, { cwd, target: { kind: "remote", name: "origin/main", localName: name }, dirty: "fail" })],
    ["branch.checkout tag", (name) => plugin.call(branchCheckoutRpc, { cwd, target: { kind: "tag", name }, dirty: "fail" })],
    ["branch.checkout commit", (name) => plugin.call(branchCheckoutRpc, { cwd, target: { kind: "commit", hash: name }, dirty: "fail" })],
    ["branch.rename name", (name) => plugin.call(branchRenameRpc, { cwd, name, newName: "ok" })],
    ["branch.rename newName", (name) => plugin.call(branchRenameRpc, { cwd, name: "main", newName: name })],
    ["branch.delete", (name) => plugin.call(branchDeleteRpc, { cwd, name, force: true, confirm: true })],
    ["branch.merge", (name) => plugin.call(branchMergeRpc, { cwd, ref: name, mode: "ff" })],
    ["branch.rebase", (name) => plugin.call(branchRebaseRpc, { cwd, onto: name, confirm: true, confirmPublished: true })],
    ["branch.reset", (name) => plugin.call(branchResetRpc, { cwd, target: name, mode: "hard", confirm: true })],
    ["branch.set-upstream name", (name) => plugin.call(branchSetUpstreamRpc, { cwd, name, upstream: "origin/main" })],
    ["branch.set-upstream upstream", (name) => plugin.call(branchSetUpstreamRpc, { cwd, name: "main", upstream: name })],
    ["remote.add name", (name) => plugin.call(remoteAddRpc, { cwd, name, url })],
    ["remote.add url", (name) => plugin.call(remoteAddRpc, { cwd, name: "other", url: name })],
    ["remote.remove", (name) => plugin.call(remoteRemoveRpc, { cwd, name, confirm: true })],
    ["remote.rename name", (name) => plugin.call(remoteRenameRpc, { cwd, name, newName: "other" })],
    ["remote.rename newName", (name) => plugin.call(remoteRenameRpc, { cwd, name: "origin", newName: name })],
    ["remote.set-url name", (name) => plugin.call(remoteSetUrlRpc, { cwd, name, url })],
    ["remote.set-url url", (name) => plugin.call(remoteSetUrlRpc, { cwd, name: "origin", url: name })],
    ["remote.delete-branch remote", (name) => plugin.call(remoteDeleteBranchRpc, { cwd, remote: name, branch: "topic", confirm: true })],
    ["remote.delete-branch branch", (name) => plugin.call(remoteDeleteBranchRpc, { cwd, remote: "origin", branch: name, confirm: true })],
    ["remote.fetch", (name) => plugin.call(remoteFetchRpc, { cwd, remote: name })],
    ["remote.pull remote", (name) => plugin.call(remotePullRpc, { cwd, mode: "merge", remote: name })],
    ["remote.pull branch", (name) => plugin.call(remotePullRpc, { cwd, mode: "merge", remote: "origin", branch: name })],
    ["remote.push remote", (name) => plugin.call(remotePushRpc, { cwd, force: "none", remote: name })],
    ["remote.push branch", (name) => plugin.call(remotePushRpc, { cwd, force: "none", branch: name })],
    ["remote.push remoteBranch", (name) => plugin.call(remotePushRpc, { cwd, force: "none", branch: "main", remoteBranch: name })],
    ["tag.create name", (name) => plugin.call(tagCreateRpc, { cwd, name })],
    ["tag.create target", (name) => plugin.call(tagCreateRpc, { cwd, name: "ok", target: name })],
    ["tag.delete", (name) => plugin.call(tagDeleteRpc, { cwd, name, confirm: true })],
    ["tag.push remote", (name) => plugin.call(tagPushRpc, { cwd, remote: name })],
    ["tag.push name", (name) => plugin.call(tagPushRpc, { cwd, remote: "origin", name })],
    ["tag.delete-remote remote", (name) => plugin.call(tagDeleteRemoteRpc, { cwd, remote: name, name: "v1", confirm: true })],
    ["tag.delete-remote name", (name) => plugin.call(tagDeleteRemoteRpc, { cwd, remote: "origin", name, confirm: true })],
  ];
  for (const [what, call] of calls) {
    for (const name of HOSTILE) {
      assert.equal((await failure(call(name))).code, "INVALID_ARGUMENT", `${what}: ${JSON.stringify(name)}`);
    }
  }
  // Nothing was made, moved or run.
  assert.equal(repo.git("for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags"), "refs/heads/main");
  assert.equal(repo.git("remote"), "origin");
  assert.equal(branchOf(repo), "main");
  assert.equal(existsSync(repo.path("x")), false);
});

test("names the schema lets through and git refuses are refused by the daemon with INVALID_ARGUMENT", async (t) => {
  const allowed = startPlugin({ policy: { allowRemoteDelete: true, allowForceDelete: true } });
  t.after(() => allowed.stop());
  const { repo } = published(t);
  const cwd = repo.cwd;
  const calls: NameCall[] = [
    ["branch.create", (name) => allowed.call(branchCreateRpc, { cwd, name, checkout: true })],
    ["branch.checkout", (name) => allowed.call(branchCheckoutRpc, { cwd, target: { kind: "branch", name }, dirty: "fail" })],
    ["branch.rename newName", (name) => allowed.call(branchRenameRpc, { cwd, name: "main", newName: name })],
    ["branch.delete", (name) => allowed.call(branchDeleteRpc, { cwd, name, force: true, confirm: true })],
    ["branch.set-upstream", (name) => allowed.call(branchSetUpstreamRpc, { cwd, name, upstream: "origin/main" })],
    ["remote.add", (name) => allowed.call(remoteAddRpc, { cwd, name, url: "https://example.invalid/r.git" })],
    ["remote.rename newName", (name) => allowed.call(remoteRenameRpc, { cwd, name: "origin", newName: name })],
    ["remote.delete-branch", (name) => allowed.call(remoteDeleteBranchRpc, { cwd, remote: "origin", branch: name, confirm: true })],
    ["remote.pull branch", (name) => allowed.call(remotePullRpc, { cwd, mode: "merge", remote: "origin", branch: name })],
    ["remote.push branch", (name) => allowed.call(remotePushRpc, { cwd, force: "none", branch: name })],
    ["tag.create", (name) => allowed.call(tagCreateRpc, { cwd, name })],
    ["tag.delete", (name) => allowed.call(tagDeleteRpc, { cwd, name, confirm: true })],
    ["tag.delete-remote", (name) => allowed.call(tagDeleteRemoteRpc, { cwd, remote: "origin", name, confirm: true })],
  ];
  for (const [what, call] of calls) {
    for (const name of ["x.lock/y", "a/b.lock/c"]) {
      assert.equal((await failure(call(name))).code, "INVALID_ARGUMENT", `${what}: ${name}`);
    }
  }
  assert.equal(repo.git("remote"), "origin");
  assert.equal(branchOf(repo), "main");
});

// --- checkout with stash ----------------------------------------------------------------------------------------

test("checkout with dirty: stash carries tracked and untracked edits to the other branch and leaves no stash", async (t) => {
  const repo = started(t);
  sideBranch(repo, "other", "b.txt", "b\n");
  repo.write("a.txt", "local\n");
  repo.write("new.txt", "untracked\n");
  const result = await plugin.call(branchCheckoutRpc, { cwd: repo.cwd, target: { kind: "branch", name: "other" }, dirty: "stash" });
  assert.deepEqual(result, { stashConflict: false });
  assert.equal(branchOf(repo), "other");
  assert.equal(lf(repo.read("a.txt")), "local\n");
  assert.equal(lf(repo.read("new.txt")), "untracked\n");
  assert.equal(lf(repo.read("b.txt")), "b\n");
  assert.equal(stashes(repo).length, 0);

  // Nothing to stash: a plain switch.
  repo.git("checkout", "--", "a.txt");
  repo.git("clean", "--quiet", "--force", "--", "new.txt");
  assert.deepEqual(await plugin.call(branchCheckoutRpc, { cwd: repo.cwd, target: { kind: "branch", name: "main" }, dirty: "stash" }), { stashConflict: false });
  assert.equal(branchOf(repo), "main");
  assert.equal(stashes(repo).length, 0);
});

test("checkout with dirty: stash reports a pop that conflicts and keeps the stash", async (t) => {
  const repo = started(t);
  sideBranch(repo, "clash", "a.txt", "theirs\n");
  repo.write("a.txt", "local\n");
  const result = await plugin.call(branchCheckoutRpc, { cwd: repo.cwd, target: { kind: "branch", name: "clash" }, dirty: "stash" });
  assert.deepEqual(result, { stashConflict: true });
  assert.equal(branchOf(repo), "clash");
  assert.equal(stashes(repo).length, 1);
  assert.match(lf(repo.read("a.txt")), /^<<<<<<< /m);
});

test("checkout with dirty: stash puts the changes back when the switch itself fails", async (t) => {
  const repo = started(t);
  addWorktree(t, repo, "busy");
  repo.write("a.txt", "local\n");
  repo.write("new.txt", "untracked\n");
  const refused = await failure(plugin.call(branchCheckoutRpc, { cwd: repo.cwd, target: { kind: "branch", name: "busy" }, dirty: "stash" }));
  assert.equal(refused.code, "INVALID_ARGUMENT");
  assert.equal(branchOf(repo), "main");
  assert.equal(lf(repo.read("a.txt")), "local\n");
  assert.equal(lf(repo.read("new.txt")), "untracked\n");
  assert.equal(stashes(repo).length, 0);
});
