// Branches against real git: listing (upstream counts, gone upstreams, other work trees, `<remote>/HEAD`), creating,
// checking out each kind of target, renaming, deleting, merging in each mode, rebasing, resetting and upstreams.
// The policy-gated paths (hard reset, force delete) and the dirty-stash checkout are in refs-safety.test.ts.

import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { after, test } from "node:test";
import {
  branchCheckoutRpc,
  branchCreateRpc,
  branchDeleteRpc,
  branchListRpc,
  branchMergeRpc,
  branchRebaseRpc,
  branchRenameRpc,
  branchResetRpc,
  branchSetUpstreamRpc,
  type BranchList,
} from "../../shared/rpc/branch.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { branchOf, hasRef, sideBranch, started, upstreamOf } from "../helpers/refs.ts";
import { addWorktree, clone, fileUrl, gitIn, lf, mergeConflict, published } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

function local(list: BranchList, name: string) {
  const entry = list.local.find((branch) => branch.name === name);
  if (entry === undefined) throw new Error(`no local branch ${name} in the list`);
  return entry;
}

// --- list ------------------------------------------------------------------------------------------------

test("list: the current branch, upstream counts, a gone upstream, protection, and the remote's default branch", async (t) => {
  const { repo, remote } = published(t);
  repo.git("remote", "set-head", "origin", "main");
  repo.git("switch", "--quiet", "--create", "gone-soon");
  repo.git("push", "--quiet", "--set-upstream", "origin", "gone-soon");
  repo.git("switch", "--quiet", "main");
  gitIn(remote, ["branch", "-D", "gone-soon"]);
  repo.git("fetch", "--quiet", "--prune", "origin");
  repo.write("b.txt", "b\n");
  repo.commit("ahead of origin");
  sideBranch(repo, "feat/x", "c.txt", "c\n");

  const list = await plugin.call(branchListRpc, { cwd: repo.cwd });
  assert.equal(list.current, "main");
  assert.equal(list.truncated, false);
  assert.deepEqual(
    list.local.map((branch) => branch.name),
    ["feat/x", "gone-soon", "main"],
  );
  const main = local(list, "main");
  assert.deepEqual(
    [main.current, main.upstream, main.ahead, main.behind, main.upstreamGone, main.protected, main.worktree, main.subject, main.hash],
    [true, "origin/main", 1, 0, false, true, null, "ahead of origin", repo.head()],
  );
  const gone = local(list, "gone-soon");
  assert.deepEqual([gone.current, gone.upstream, gone.upstreamGone, gone.protected], [false, "origin/gone-soon", true, false]);
  const feat = local(list, "feat/x");
  assert.deepEqual([feat.upstream, feat.ahead, feat.behind, feat.subject], [null, 0, 0, "feat/x: c.txt"]);
  assert.ok(feat.time > 0);
  assert.deepEqual(
    list.remote.map((branch) => [branch.name, branch.remote, branch.branch, branch.isHead]),
    [["origin/main", "origin", "main", true]],
  );
});

test("list: a branch checked out in another work tree names it, from either side; a detached HEAD has no current branch", async (t) => {
  const repo = started(t);
  const tree = addWorktree(t, repo, "in-tree");
  const list = await plugin.call(branchListRpc, { cwd: repo.cwd });
  const inTree = local(list, "in-tree");
  assert.equal(inTree.current, false);
  assert.ok(inTree.worktree !== null);
  assert.equal(realpathSync.native(inTree.worktree), tree);
  assert.equal(local(list, "main").worktree, null);

  const there = await plugin.call(branchListRpc, { cwd: tree });
  assert.equal(there.current, "in-tree");
  assert.equal(local(there, "in-tree").worktree, null);
  const main = local(there, "main");
  assert.ok(main.worktree !== null);
  assert.equal(realpathSync.native(main.worktree), repo.cwd);

  repo.git("switch", "--quiet", "--detach", "HEAD");
  const detached = await plugin.call(branchListRpc, { cwd: repo.cwd });
  assert.equal(detached.current, null);
  assert.equal(
    detached.local.some((branch) => branch.current),
    false,
  );
});

test("list: remote names holding a slash are split by the configured remote", async (t) => {
  const { repo, remote } = published(t);
  repo.git("remote", "add", "team/sub", fileUrl(remote));
  repo.git("fetch", "--quiet", "team/sub");
  // git 2.48 on records the remote's HEAD on fetch; set it here so the test does not depend on the version.
  repo.git("remote", "set-head", "team/sub", "main");
  const list = await plugin.call(branchListRpc, { cwd: repo.cwd });
  const entry = list.remote.find((branch) => branch.name === "team/sub/main");
  assert.ok(entry !== undefined);
  assert.deepEqual([entry.remote, entry.branch, entry.isHead], ["team/sub", "main", true]);
  // `team/sub/HEAD` itself is not listed.
  assert.equal(
    list.remote.some((branch) => branch.branch === "HEAD"),
    false,
  );
});

// --- create ----------------------------------------------------------------------------------------------

test("create: at HEAD or a start point, switching to it or not, tracking a remote-tracking start point on request", async (t) => {
  const { repo } = published(t);
  const root = repo.head();
  repo.write("b.txt", "b\n");
  const second = repo.commit("second");
  const cwd = repo.cwd;

  await plugin.call(branchCreateRpc, { cwd, name: "at-head", checkout: false });
  assert.equal(repo.git("rev-parse", "refs/heads/at-head"), second);
  assert.equal(branchOf(repo), "main");

  await plugin.call(branchCreateRpc, { cwd, name: "from-root", startPoint: root, checkout: true });
  assert.equal(branchOf(repo), "from-root");
  assert.equal(repo.head(), root);

  await plugin.call(branchCreateRpc, { cwd, name: "tracking", startPoint: "origin/main", checkout: false, track: true });
  assert.equal(upstreamOf(repo, "tracking"), "origin/main");
  await plugin.call(branchCreateRpc, { cwd, name: "not-tracking", startPoint: "origin/main", checkout: false });
  assert.equal(upstreamOf(repo, "not-tracking"), null);
  // --track only follows a remote-tracking branch.
  await plugin.call(branchCreateRpc, { cwd, name: "local-start", startPoint: "main", checkout: false, track: true });
  assert.equal(upstreamOf(repo, "local-start"), null);

  await plugin.call(branchCreateRpc, { cwd, name: "new-tracking", startPoint: "origin/main", checkout: true, track: true });
  assert.equal(branchOf(repo), "new-tracking");
  assert.equal(upstreamOf(repo, "new-tracking"), "origin/main");

  assert.equal((await failure(plugin.call(branchCreateRpc, { cwd, name: "tracking", checkout: false }))).code, "REF_EXISTS");
  assert.equal((await failure(plugin.call(branchCreateRpc, { cwd, name: "x", startPoint: "no-such-thing", checkout: false }))).code, "REF_NOT_FOUND");
  // A name the schema lets through and git does not.
  assert.equal((await failure(plugin.call(branchCreateRpc, { cwd, name: "x.lock/y", checkout: false }))).code, "INVALID_ARGUMENT");
  assert.equal(hasRef(cwd, "refs/heads/x"), false);
});

// --- checkout --------------------------------------------------------------------------------------------

test("checkout: a local branch, a remote-tracking one (made or reused), a commit and a tag", async (t) => {
  const { repo, remote } = published(t);
  const root = repo.head();
  const other = clone(t, fileUrl(remote));
  other.git("switch", "--quiet", "--create", "feat");
  other.write("f.txt", "f\n");
  const feat = other.commit("feat");
  other.git("push", "--quiet", "origin", "feat");
  repo.git("fetch", "--quiet", "origin");
  const cwd = repo.cwd;

  assert.deepEqual(await plugin.call(branchCheckoutRpc, { cwd, target: { kind: "remote", name: "origin/feat" }, dirty: "fail" }), { stashConflict: false });
  assert.equal(branchOf(repo), "feat");
  assert.equal(upstreamOf(repo, "feat"), "origin/feat");
  assert.equal(repo.head(), feat);

  await plugin.call(branchCheckoutRpc, { cwd, target: { kind: "branch", name: "main" }, dirty: "fail" });
  assert.equal(branchOf(repo), "main");
  // The local branch that follows it already: switched to.
  await plugin.call(branchCheckoutRpc, { cwd, target: { kind: "remote", name: "origin/feat" }, dirty: "fail" });
  assert.equal(branchOf(repo), "feat");

  // Under another local name.
  await plugin.call(branchCheckoutRpc, { cwd, target: { kind: "remote", name: "origin/feat", localName: "feat-copy" }, dirty: "fail" });
  assert.equal(branchOf(repo), "feat-copy");
  assert.equal(upstreamOf(repo, "feat-copy"), "origin/feat");

  // A local branch of that name that does not follow it.
  repo.git("branch", "--no-track", "solo", "origin/feat");
  const exists = await failure(plugin.call(branchCheckoutRpc, { cwd, target: { kind: "remote", name: "origin/feat", localName: "solo" }, dirty: "fail" }));
  assert.equal(exists.code, "REF_EXISTS");
  assert.equal(branchOf(repo), "feat-copy");

  await plugin.call(branchCheckoutRpc, { cwd, target: { kind: "commit", hash: root }, dirty: "fail" });
  assert.equal(branchOf(repo), null);
  assert.equal(repo.head(), root);

  repo.git("tag", "--annotate", "--message=release", "v1", feat);
  await plugin.call(branchCheckoutRpc, { cwd, target: { kind: "tag", name: "v1" }, dirty: "fail" });
  assert.equal(branchOf(repo), null);
  assert.equal(repo.head(), feat);

  for (const target of [
    { kind: "branch", name: "nope" },
    { kind: "remote", name: "origin/nope" },
    { kind: "tag", name: "nope" },
    { kind: "commit", hash: "f".repeat(40) },
  ] as const) {
    assert.equal((await failure(plugin.call(branchCheckoutRpc, { cwd, target, dirty: "fail" }))).code, "REF_NOT_FOUND", target.kind);
  }
});

test("checkout never overwrites local changes, refuses a branch another work tree has, and waits for a merge under way", async (t) => {
  const repo = started(t);
  sideBranch(repo, "other", "a.txt", "theirs\n");
  repo.write("a.txt", "local\n");
  const overwrite = await failure(plugin.call(branchCheckoutRpc, { cwd: repo.cwd, target: { kind: "branch", name: "other" }, dirty: "fail" }));
  assert.equal(overwrite.code, "WOULD_OVERWRITE_CHANGES");
  assert.equal(lf(repo.read("a.txt")), "local\n");
  assert.equal(branchOf(repo), "main");
  repo.git("checkout", "--", "a.txt");

  addWorktree(t, repo, "busy");
  const busy = await failure(plugin.call(branchCheckoutRpc, { cwd: repo.cwd, target: { kind: "branch", name: "busy" }, dirty: "fail" }));
  assert.equal(busy.code, "INVALID_ARGUMENT");
  assert.match(busy.detail, /busy/);

  const merging = started(t);
  mergeConflict(merging);
  const underWay = await failure(plugin.call(branchCheckoutRpc, { cwd: merging.cwd, target: { kind: "branch", name: "side" }, dirty: "fail" }));
  assert.equal(underWay.code, "OPERATION_IN_PROGRESS");
});

// --- rename, delete ----------------------------------------------------------------------------------------

test("rename: moves the branch and its upstream; REF_NOT_FOUND, REF_EXISTS, and never a protected branch", async (t) => {
  const { repo } = published(t);
  const cwd = repo.cwd;
  repo.git("switch", "--quiet", "--create", "old-name");
  repo.git("push", "--quiet", "--set-upstream", "origin", "old-name");
  repo.git("switch", "--quiet", "main");

  await plugin.call(branchRenameRpc, { cwd, name: "old-name", newName: "new-name" });
  assert.equal(hasRef(cwd, "refs/heads/old-name"), false);
  assert.equal(hasRef(cwd, "refs/heads/new-name"), true);
  assert.equal(upstreamOf(repo, "new-name"), "origin/old-name");

  assert.equal((await failure(plugin.call(branchRenameRpc, { cwd, name: "missing", newName: "x" }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(branchRenameRpc, { cwd, name: "new-name", newName: "main" }))).code, "REF_EXISTS");
  assert.equal((await failure(plugin.call(branchRenameRpc, { cwd, name: "main", newName: "trunk" }))).code, "PROTECTED_BRANCH");
  assert.equal(hasRef(cwd, "refs/heads/main"), true);

  // The checked-out branch is renamed with HEAD.
  repo.git("switch", "--quiet", "new-name");
  await plugin.call(branchRenameRpc, { cwd, name: "new-name", newName: "renamed" });
  assert.equal(branchOf(repo), "renamed");
});

test("delete: a merged branch goes; an unmerged one is UNMERGED_BRANCH; the current, a protected and a missing one are refused", async (t) => {
  const repo = started(t);
  const cwd = repo.cwd;
  repo.git("branch", "merged");
  await plugin.call(branchDeleteRpc, { cwd, name: "merged", force: false, confirm: true });
  assert.equal(hasRef(cwd, "refs/heads/merged"), false);

  sideBranch(repo, "unmerged", "c.txt", "c\n");
  assert.equal((await failure(plugin.call(branchDeleteRpc, { cwd, name: "unmerged", force: false, confirm: true }))).code, "UNMERGED_BRANCH");
  assert.equal(hasRef(cwd, "refs/heads/unmerged"), true);

  repo.git("switch", "--quiet", "--create", "current-one");
  assert.equal((await failure(plugin.call(branchDeleteRpc, { cwd, name: "current-one", force: false, confirm: true }))).code, "INVALID_ARGUMENT");
  repo.git("switch", "--quiet", "main");

  repo.git("branch", "develop");
  assert.equal((await failure(plugin.call(branchDeleteRpc, { cwd, name: "develop", force: false, confirm: true }))).code, "PROTECTED_BRANCH");
  assert.equal(hasRef(cwd, "refs/heads/develop"), true);
  assert.equal((await failure(plugin.call(branchDeleteRpc, { cwd, name: "missing", force: false, confirm: true }))).code, "REF_NOT_FOUND");
  const unconfirmed = await failure(plugin.call(branchDeleteRpc, { cwd, name: "unmerged", force: false } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
});

// --- merge -----------------------------------------------------------------------------------------------

test("merge: fast-forward, up to date, a merge commit with its message, ff-only refused, squash, then a conflict", async (t) => {
  const repo = started(t);
  const cwd = repo.cwd;
  const ff = sideBranch(repo, "ff", "b.txt", "b\n");
  assert.deepEqual(await plugin.call(branchMergeRpc, { cwd, ref: "ff", mode: "ff" }), { result: "fast-forward" });
  assert.equal(repo.head(), ff);
  assert.deepEqual(await plugin.call(branchMergeRpc, { cwd, ref: "ff", mode: "ff" }), { result: "up-to-date" });

  const before = repo.head();
  sideBranch(repo, "side", "c.txt", "c\n");
  assert.deepEqual(await plugin.call(branchMergeRpc, { cwd, ref: "side", mode: "no-ff", message: "Merge side in" }), { result: "merged" });
  assert.equal(repo.git("log", "-1", "--format=%s"), "Merge side in");
  assert.equal(repo.git("log", "-1", "--format=%P"), `${before} ${repo.git("rev-parse", "side")}`);

  sideBranch(repo, "diverged", "d.txt", "d\n");
  repo.write("e.txt", "e\n");
  repo.commit("main moves");
  assert.equal((await failure(plugin.call(branchMergeRpc, { cwd, ref: "diverged", mode: "ff-only" }))).code, "NON_FAST_FORWARD");
  assert.deepEqual(await plugin.call(branchMergeRpc, { cwd, ref: "diverged", mode: "ff" }), { result: "merged" });

  const head = repo.head();
  sideBranch(repo, "squashme", "s.txt", "s\n");
  assert.deepEqual(await plugin.call(branchMergeRpc, { cwd, ref: "squashme", mode: "squash" }), { result: "squashed" });
  assert.equal(repo.head(), head);
  assert.equal(repo.git("diff", "--cached", "--name-only"), "s.txt");
  repo.commit("squashed");

  assert.equal((await failure(plugin.call(branchMergeRpc, { cwd, ref: "no-such-branch", mode: "ff" }))).code, "REF_NOT_FOUND");

  sideBranch(repo, "clash", "a.txt", "theirs\n");
  repo.write("a.txt", "mine\n");
  repo.commit("mine");
  assert.deepEqual(await plugin.call(branchMergeRpc, { cwd, ref: "clash", mode: "no-ff" }), { result: "conflict" });
  assert.equal(existsSync(repo.path(".git/MERGE_HEAD")), true);
  assert.equal((await failure(plugin.call(branchMergeRpc, { cwd, ref: "ff", mode: "ff" }))).code, "OPERATION_IN_PROGRESS");
});

test("merge: local changes in the way are WOULD_OVERWRITE_CHANGES, and are kept", async (t) => {
  const repo = started(t);
  sideBranch(repo, "other", "a.txt", "theirs\n");
  repo.write("a.txt", "local\n");
  assert.equal((await failure(plugin.call(branchMergeRpc, { cwd: repo.cwd, ref: "other", mode: "ff" }))).code, "WOULD_OVERWRITE_CHANGES");
  assert.equal(lf(repo.read("a.txt")), "local\n");
});

// --- rebase ----------------------------------------------------------------------------------------------

test("rebase: replays local commits; published ones need confirmPublished; a published protected branch is refused", async (t) => {
  const { repo } = published(t);
  const cwd = repo.cwd;
  repo.git("switch", "--quiet", "--create", "topic");
  repo.write("t.txt", "t\n");
  repo.commit("topic");
  repo.git("switch", "--quiet", "main");
  repo.write("m.txt", "m\n");
  const moved = repo.commit("main moves");
  repo.git("switch", "--quiet", "topic");

  assert.deepEqual(await plugin.call(branchRebaseRpc, { cwd, onto: "main", confirm: true }), { conflicted: false });
  assert.equal(repo.git("rev-parse", "HEAD~1"), moved);
  assert.equal(repo.git("log", "-1", "--format=%s"), "topic");
  assert.equal(branchOf(repo), "topic");

  // Published: the rewritten commit is on origin/topic.
  repo.git("push", "--quiet", "--set-upstream", "origin", "topic");
  repo.git("switch", "--quiet", "main");
  repo.write("m2.txt", "m2\n");
  const movedAgain = repo.commit("main moves again");
  repo.git("switch", "--quiet", "topic");
  assert.equal((await failure(plugin.call(branchRebaseRpc, { cwd, onto: "main", confirm: true }))).code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(await plugin.call(branchRebaseRpc, { cwd, onto: "main", confirm: true, confirmPublished: true }), { conflicted: false });
  assert.equal(repo.git("rev-parse", "HEAD~1"), movedAgain);

  // main's own published commits, rewritten onto another branch: main is protected.
  repo.git("switch", "--quiet", "main");
  repo.git("push", "--quiet", "origin", "main");
  repo.git("switch", "--quiet", "--create", "base", "HEAD~2");
  repo.write("base.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "main");
  const protectedFailure = await failure(plugin.call(branchRebaseRpc, { cwd, onto: "base", confirm: true, confirmPublished: true }));
  assert.equal(protectedFailure.code, "PROTECTED_BRANCH");
  assert.equal(repo.head(), movedAgain);

  const unconfirmed = await failure(plugin.call(branchRebaseRpc, { cwd, onto: "base" } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
});

test("rebase: a stop on conflicts says so and leaves the rebase under way", async (t) => {
  const repo = started(t);
  const cwd = repo.cwd;
  repo.git("switch", "--quiet", "--create", "topic");
  repo.write("a.txt", "topic\n");
  repo.commit("topic");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "main\n");
  repo.commit("main");
  repo.git("switch", "--quiet", "topic");
  assert.deepEqual(await plugin.call(branchRebaseRpc, { cwd, onto: "main", confirm: true }), { conflicted: true });
  assert.equal(existsSync(repo.path(".git/rebase-merge")), true);
  assert.equal((await failure(plugin.call(branchRebaseRpc, { cwd, onto: "main", confirm: true }))).code, "OPERATION_IN_PROGRESS");
  repo.git("rebase", "--abort");

  // Local changes without autostash: git refuses and nothing moves.
  const topic = repo.head();
  repo.write("a.txt", "dirty\n");
  assert.equal((await failure(plugin.call(branchRebaseRpc, { cwd, onto: "main", confirm: true }))).code, "WOULD_OVERWRITE_CHANGES");
  assert.equal(repo.head(), topic);
  assert.equal(lf(repo.read("a.txt")), "dirty\n");
});

// --- reset -----------------------------------------------------------------------------------------------

test("reset: soft and mixed anywhere, keep only on an unprotected branch and only when nothing is lost", async (t) => {
  const repo = started(t);
  const cwd = repo.cwd;
  const root = repo.head();
  repo.write("b.txt", "b\n");
  const second = repo.commit("second");

  assert.deepEqual(await plugin.call(branchResetRpc, { cwd, target: root, mode: "soft", confirm: true }), { snapshot: null });
  assert.equal(repo.head(), root);
  assert.equal(repo.git("diff", "--cached", "--name-only"), "b.txt");
  assert.deepEqual(await plugin.call(branchResetRpc, { cwd, target: second, mode: "mixed", confirm: true }), { snapshot: null });
  assert.equal(repo.head(), second);
  assert.equal(repo.git("status", "--porcelain"), "");

  repo.write("a.txt", "local\n");
  assert.equal((await failure(plugin.call(branchResetRpc, { cwd, target: root, mode: "keep", confirm: true }))).code, "PROTECTED_BRANCH");
  assert.equal(repo.head(), second);

  repo.git("switch", "--quiet", "--create", "work");
  const kept = await plugin.call(branchResetRpc, { cwd, target: root, mode: "keep", confirm: true });
  assert.ok(kept.snapshot !== null && kept.snapshot.startsWith("refs/advanced-git/snapshots/"), String(kept.snapshot));
  assert.equal(repo.head(), root);
  assert.equal(lf(repo.read("a.txt")), "local\n");
  assert.equal(existsSync(repo.path("b.txt")), false);

  // A local change to a file the reset would move: refused, nothing lost.
  repo.git("checkout", "--", "a.txt");
  repo.git("reset", "--quiet", "--hard", second);
  repo.write("b.txt", "changed\n");
  assert.equal((await failure(plugin.call(branchResetRpc, { cwd, target: root, mode: "keep", confirm: true }))).code, "WOULD_OVERWRITE_CHANGES");
  assert.equal(repo.head(), second);
  assert.equal(lf(repo.read("b.txt")), "changed\n");

  assert.equal((await failure(plugin.call(branchResetRpc, { cwd, target: "no-such-rev", mode: "soft", confirm: true }))).code, "REF_NOT_FOUND");
});

// --- upstream ----------------------------------------------------------------------------------------------

test("set-upstream: to a remote-tracking branch, unset (twice), and only to one that exists", async (t) => {
  const { repo } = published(t);
  const cwd = repo.cwd;
  repo.git("switch", "--quiet", "--create", "feature");
  repo.git("push", "--quiet", "origin", "feature");
  assert.equal(upstreamOf(repo, "feature"), null);

  await plugin.call(branchSetUpstreamRpc, { cwd, name: "feature", upstream: "origin/feature" });
  assert.equal(upstreamOf(repo, "feature"), "origin/feature");
  await plugin.call(branchSetUpstreamRpc, { cwd, name: "feature", upstream: null });
  assert.equal(upstreamOf(repo, "feature"), null);
  await plugin.call(branchSetUpstreamRpc, { cwd, name: "feature", upstream: null });

  assert.equal((await failure(plugin.call(branchSetUpstreamRpc, { cwd, name: "feature", upstream: "origin/nope" }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(branchSetUpstreamRpc, { cwd, name: "nope", upstream: "origin/main" }))).code, "REF_NOT_FOUND");
  // A local branch is not a remote-tracking one.
  assert.equal((await failure(plugin.call(branchSetUpstreamRpc, { cwd, name: "feature", upstream: "main" }))).code, "REF_NOT_FOUND");
});
