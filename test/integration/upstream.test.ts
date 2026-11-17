// Upstream's daemon tests (Source Control), moved onto the new contracts and run through the real index.server.ts.

import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { bindTools } from "../../server/core/exec.ts";
import { baseOf } from "../../server/repo.ts";
import { changesDiscardRpc, changesIgnoreRpc, changesMarkersRpc, changesRemoveRpc, changesStageRpc, changesUnstageRpc } from "../../shared/rpc/changes.ts";
import { commitCreateRpc } from "../../shared/rpc/commit.ts";
import { diffFileRpc, type FileDiff } from "../../shared/rpc/diff.ts";
import { historyCompareRpc, historyLogRpc, historyShowRpc } from "../../shared/rpc/history.ts";
import { remoteListRpc, remotePushRpc, remoteSyncRpc } from "../../shared/rpc/remote.ts";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { bareRemote, clone, dates, fileUrl, gitIn, lf, mergeConflict, repository } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());
const status = (cwd: string) => plugin.call(repoStatusRpc, { cwd });
const commit = (cwd: string, message: string, options: { amend?: boolean; all?: boolean } = {}) =>
  plugin.call(commitCreateRpc, { cwd, message, amend: options.amend ?? false, all: options.all ?? false });

/** The line ranges of a diff's changes, before and after. */
const ranges = (result: FileDiff) => (result.kind === "diff" ? result.changes.map((change) => [change.original, change.modified]) : result.kind);

test("the first commit: untracked, staged, unstaged again, committed", async (t) => {
  const { cwd, write } = repository(t);
  write("read me.txt", "hello\n");

  let now = await status(cwd);
  assert.equal(now.branch, "main");
  assert.equal(now.head, null);
  assert.deepEqual(now.changes, [{ path: "read me.txt", status: "?" }]);
  // As VS Code opens it: the file itself, there being nothing to compare it with.
  assert.deepEqual(await plugin.call(diffFileRpc, { cwd, source: { kind: "changes" }, file: now.changes[0] }), { kind: "file", lines: ["hello", ""], truncated: false });

  await plugin.call(changesStageRpc, { cwd, files: now.changes });
  now = await status(cwd);
  assert.deepEqual(now.staged, [{ path: "read me.txt", status: "A" }]);
  assert.deepEqual(now.changes, []);

  await plugin.call(changesUnstageRpc, { cwd, files: now.staged });
  now = await status(cwd);
  assert.deepEqual(now.staged, []);
  assert.deepEqual(now.changes, [{ path: "read me.txt", status: "?" }]);

  await plugin.call(changesStageRpc, { cwd, files: now.changes });
  const { hash } = await commit(cwd, "first");
  now = await status(cwd);
  assert.equal(now.head, hash);
  assert.match(hash, /^[0-9a-f]{40}$/);
  assert.deepEqual([now.staged, now.changes, now.conflicts], [[], [], []]);
});

test("edits, renames and discards", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  repo.write("a.txt", "one\n");
  repo.write("b.txt", "two\n");
  repo.commit("first");

  repo.write("a.txt", "one\nmore\n");
  repo.git("mv", "b.txt", "c.txt");
  repo.write("new.txt", "new\n");
  let now = await status(cwd);
  assert.deepEqual(now.staged, [{ path: "c.txt", status: "R", from: "b.txt" }]);
  assert.deepEqual(now.changes, [
    { path: "a.txt", status: "M" },
    { path: "new.txt", status: "?" },
  ]);
  assert.deepEqual(ranges(await plugin.call(diffFileRpc, { cwd, source: { kind: "changes" }, file: now.changes[0] })), [[[2, 2], [2, 3]]]);
  // A rename compares the old path with the new; the text is the same.
  assert.deepEqual(ranges(await plugin.call(diffFileRpc, { cwd, source: { kind: "staged" }, file: now.staged[0] })), []);

  await plugin.call(changesUnstageRpc, { cwd, files: now.staged });
  assert.deepEqual((await status(cwd)).staged, []);
  assert.ok(existsSync(join(cwd, "c.txt"))); // unstaging leaves the working tree alone

  await plugin.call(changesDiscardRpc, { cwd, files: now.changes, trash: false, confirm: true });
  now = await status(cwd);
  assert.equal(lf(repo.read("a.txt")), "one\n");
  assert.equal(existsSync(join(cwd, "new.txt")), false);
});

test("a conflict is listed apart and staging resolves it", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  mergeConflict(repo);

  let now = await status(cwd);
  assert.deepEqual(now.conflicts, [{ path: "a.txt", status: "U", conflict: "UU" }]);
  assert.deepEqual((await plugin.call(changesMarkersRpc, { cwd, paths: ["a.txt"] })).paths, ["a.txt"]);
  repo.write("a.txt", "main and side\n");
  assert.deepEqual((await plugin.call(changesMarkersRpc, { cwd, paths: ["a.txt"] })).paths, []);
  repo.write("a.txt", "both\n");
  await plugin.call(changesStageRpc, { cwd, files: now.conflicts });
  now = await status(cwd);
  assert.deepEqual(now.conflicts, []);
  assert.deepEqual(now.staged, [{ path: "a.txt", status: "M" }]);
});

test("history carries parents and refs, and a merge shows what it brought in", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  repo.write("a.txt", "a\n");
  repo.commit("root", { time: 1000 });
  repo.git("tag", "v1");
  repo.git("switch", "--quiet", "--create", "side");
  repo.write("side.txt", "side\n");
  repo.commit("on side", { time: 2000 });
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "a\nmain\n");
  repo.commit("on main", { time: 3000 });
  gitIn(cwd, ["merge", "--quiet", "--no-ff", "--message=merge side", "side"], dates(4000));
  repo.git("switch", "--quiet", "--create", "later", "v1");
  repo.write("later.txt", "later\n");
  repo.commit("on later\n\nwith a body", { time: 5000 });
  repo.git("switch", "--quiet", "main");

  const all = await plugin.call(historyLogRpc, { cwd, scope: "all", limit: 10 });
  assert.equal(all.more, false);
  assert.deepEqual(
    all.commits.map(({ subject, author, time, parents, refs }) => ({ subject, author, time, parents: parents.length, refs })),
    [
      { subject: "on later", author: "Test Author", time: 5000, parents: 1, refs: [{ kind: "branch", name: "later" }] },
      { subject: "merge side", author: "Test Author", time: 4000, parents: 2, refs: [{ kind: "head", name: "main" }] },
      { subject: "on main", author: "Test Author", time: 3000, parents: 1, refs: [] },
      { subject: "on side", author: "Test Author", time: 2000, parents: 1, refs: [{ kind: "branch", name: "side" }] },
      { subject: "root", author: "Test Author", time: 1000, parents: 0, refs: [{ kind: "tag", name: "v1" }] },
    ],
  );
  assert.equal(all.commits[0].email, "author@example.com");

  // The checked-out branch alone: "later" is not part of it.
  const current = await plugin.call(historyLogRpc, { cwd, scope: "current", limit: 2 });
  assert.deepEqual(
    current.commits.map((c) => c.subject),
    ["merge side", "on main"],
  );
  assert.equal(current.more, true);

  const merge = await plugin.call(historyShowRpc, { cwd, hash: all.commits[1].hash });
  assert.equal(merge.body, "merge side");
  assert.equal(merge.subject, "merge side");
  assert.equal(merge.parents.length, 2);
  assert.deepEqual(merge.files, [{ path: "side.txt", status: "A", additions: 1, deletions: 0 }]);
  assert.equal(merge.filesTruncated, false);
  // Counted as the files are, against the first parent; a count of nothing is zero.
  assert.deepEqual(merge.stats, { files: 1, insertions: 1, deletions: 0 });
  assert.equal(merge.committer.name, "Test Committer");
  assert.equal(merge.author.time, 4000);
  assert.deepEqual((await plugin.call(historyShowRpc, { cwd, hash: all.commits[2].hash })).stats, { files: 1, insertions: 1, deletions: 0 });
  assert.deepEqual(await plugin.call(diffFileRpc, { cwd, source: { kind: "commit", hash: all.commits[1].hash }, file: merge.files[0] }), {
    kind: "file",
    lines: ["side", ""],
    truncated: false,
  });

  assert.equal((await plugin.call(historyShowRpc, { cwd, hash: all.commits[0].hash })).body, "on later\n\nwith a body");
  assert.deepEqual((await plugin.call(historyShowRpc, { cwd, hash: all.commits[4].hash })).files, [{ path: "a.txt", status: "A", additions: 1, deletions: 0 }]);

  const before = (await status(cwd)).refs;
  repo.git("tag", "v2");
  assert.notEqual((await status(cwd)).refs, before);
});

test("the branch a branch was made from, found as VS Code finds it, and Auto showing it", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  const git = repo.git;
  repo.write("a.txt", "a\n");
  repo.commit("root");
  // A remote whose default branch main follows, and another branch on it.
  git("remote", "add", "origin", "https://example.com/r.git");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git("branch", "--quiet", "--set-upstream-to=origin/main");
  git("switch", "--quiet", "--create", "other");
  repo.write("b.txt", "b\n");
  repo.commit("on other");
  git("update-ref", "refs/remotes/origin/other", "HEAD");
  git("switch", "--quiet", "main");
  const tools = bindTools(cwd, "read");

  // The default branch is main's own upstream: nothing more to show.
  let now = await status(cwd);
  assert.equal(now.upstream, "origin/main");
  assert.equal(now.base, null);

  // Created from a branch on the remote, without following it.
  git("switch", "--quiet", "--no-track", "--create", "feature", "origin/main");
  now = await status(cwd);
  assert.equal(now.upstream, null);
  assert.equal(now.base, "origin/main");

  // Created from a local branch: the branch that one follows.
  git("branch", "--quiet", "--set-upstream-to=origin/other", "other");
  git("switch", "--quiet", "--create", "topic", "other");
  assert.equal(await baseOf(tools, "topic"), "origin/other");

  // Created from HEAD: the branch HEAD moved away from.
  git("switch", "--quiet", "other");
  git("switch", "--quiet", "--create", "deep");
  assert.equal(await baseOf(tools, "deep"), "origin/other");

  // Neither: the remote's default branch.
  git("checkout", "--quiet", "--detach");
  git("switch", "--quiet", "--create", "loose");
  assert.equal(await baseOf(tools, "loose"), "origin/main");

  // What VS Code keeps in the branch's config comes first, but only a branch on a remote counts.
  git("config", "branch.feature.vscode-merge-base", "other");
  assert.equal(await baseOf(tools, "feature"), "origin/main");
  git("config", "branch.feature.vscode-merge-base", "origin/other");
  assert.equal(await baseOf(tools, "feature"), "origin/other");

  // Auto shows the base's history beside the branch's own.
  git("switch", "--quiet", "feature");
  const auto = await plugin.call(historyLogRpc, { cwd, scope: "current", limit: 10 });
  assert.deepEqual(
    auto.commits.map((c) => c.subject),
    ["on other", "root"],
  );
});

test("where the branch and its upstream parted, and what a pull and a push would carry", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  const git = repo.git;
  repo.write("a.txt", "a\n");
  const root = repo.commit("root");

  // No upstream: nothing to pull or push.
  assert.equal((await plugin.call(historyLogRpc, { cwd, scope: "all", limit: 10 })).sync, null);

  git("remote", "add", "origin", "https://example.com/r.git");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("branch", "--quiet", "--set-upstream-to=origin/main");
  // Level with its upstream: nothing either.
  assert.equal((await plugin.call(historyLogRpc, { cwd, scope: "all", limit: 10 })).sync, null);

  // A commit on the branch, and another that a fetch brought to the upstream.
  repo.write("mine.txt", "mine\n");
  const head = repo.commit("mine");
  git("checkout", "--quiet", "--detach", root);
  repo.write("a.txt", "theirs\n");
  const upstream = repo.commit("theirs");
  git("update-ref", "refs/remotes/origin/main", upstream);
  git("switch", "--quiet", "main");

  const { sync } = await plugin.call(historyLogRpc, { cwd, scope: "current", limit: 10 });
  assert.deepEqual(sync, { head, upstream, base: root });
  const incoming = await plugin.call(historyCompareRpc, { cwd, from: root, to: upstream });
  assert.deepEqual(incoming.files, [{ path: "a.txt", status: "M", additions: 1, deletions: 1 }]);
  assert.deepEqual([incoming.ahead, incoming.behind, incoming.from, incoming.to], [1, 0, root, upstream]);
  assert.deepEqual(ranges(await plugin.call(diffFileRpc, { cwd, source: { kind: "incoming", from: root, to: upstream }, file: incoming.files[0] })), [[[1, 2], [1, 2]]]);
  const outgoing = await plugin.call(historyCompareRpc, { cwd, from: root, to: head });
  assert.deepEqual(outgoing.files, [{ path: "mine.txt", status: "A", additions: 1, deletions: 0 }]);
});

test("an untracked file that has gone is an error, not an empty diff", async (t) => {
  const { cwd } = repository(t);
  const { code } = await failure(plugin.call(diffFileRpc, { cwd, source: { kind: "changes" }, file: { path: "gone.txt", status: "?" } }));
  assert.equal(code, "STALE_STATE");
});

test("amending folds what is staged into the last commit, and rewords it when there is a message", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  repo.write("a.txt", "one\n");
  repo.commit("first");
  repo.write("b.txt", "two\n");
  await plugin.call(changesStageRpc, { cwd, files: [{ path: "b.txt", status: "?" }] });

  await commit(cwd, "", { amend: true });
  assert.equal(repo.git("log", "--format=%s"), "first");
  assert.deepEqual(repo.git("show", "--format=", "--name-only").split(/\r?\n/), ["a.txt", "b.txt"]);

  await commit(cwd, "first, reworded", { amend: true });
  assert.equal(repo.git("log", "--format=%s"), "first, reworded");
});

test("git's refusals come back with their codes", async (t) => {
  const { cwd } = repository(t);
  assert.equal((await failure(commit(cwd, "nothing staged"))).code, "NOTHING_TO_COMMIT");
  assert.equal((await failure(status(tmpdir()))).code, "NOT_A_REPOSITORY");
});

test("as in VS Code, no more than 10000 files are listed, and an unignored node_modules is offered to be ignored", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  mkdirSync(join(cwd, "node_modules"));
  for (let n = 0; n <= 10_000; n++) repo.write(`node_modules/file ${n}.txt`, "");

  let now = await status(cwd);
  assert.equal(now.cutAt, 10_000);
  assert.equal(now.changes.length, 10_000);
  assert.deepEqual(now.hugeFolders, ["node_modules"]);

  await plugin.call(changesIgnoreRpc, { cwd, paths: ["node_modules"] });
  assert.equal(repo.read(".gitignore"), "node_modules\n");
  now = await status(cwd);
  assert.deepEqual([now.cutAt, now.changes, now.hugeFolders], [null, [{ path: ".gitignore", status: "?" }], []]);
});

test("a .gitignore without a newline at its end gets one before what is added", async (t) => {
  const repo = repository(t);
  repo.write(".gitignore", "dist");
  await plugin.call(changesIgnoreRpc, { cwd: repo.cwd, paths: ["node_modules", "a[1].txt"] });
  assert.equal(repo.read(".gitignore"), "dist\nnode_modules\na\\[1].txt\n");
});

test("more paths than one command line holds are staged a part at a time", async (t) => {
  const repo = repository(t);
  const long = "x".repeat(100);
  for (let n = 0; n < 400; n++) repo.write(`${long}-${n}.txt`, ""); // 40000 characters of paths
  await plugin.call(changesStageRpc, { cwd: repo.cwd, files: (await status(repo.cwd)).changes });
  assert.equal(repo.git("diff", "--cached", "--name-only").split(/\r?\n/).length, 400);
});

test("a file deleted by them and modified by us can be deleted, as VS Code's Delete File does", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  repo.write("a.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "side");
  repo.git("rm", "--quiet", "a.txt");
  repo.commit("gone");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "main\n");
  repo.commit("main");
  assert.equal(repo.tryGit("merge", "--quiet", "side"), false);

  const { conflicts } = await status(cwd);
  assert.deepEqual(conflicts, [{ path: "a.txt", status: "U", conflict: "UD" }]);
  await plugin.call(changesRemoveRpc, { cwd, files: conflicts, confirm: true });
  assert.deepEqual((await status(cwd)).conflicts, []);
  assert.equal(existsSync(join(cwd, "a.txt")), false);
});

test("an untracked file the Trash cannot take is left, and said so", async (t) => {
  const { cwd } = repository(t);
  // A file that is not there fails the Trash without putting anything in it; where there is no Trash, the same.
  assert.deepEqual(await plugin.call(changesDiscardRpc, { cwd, files: [{ path: "gone.txt", status: "?" }], trash: true, confirm: true }), { trashFailed: true });
});

test("as in VS Code, a changed line marks the words that changed in it", async (t) => {
  const repo = repository(t);
  repo.write("abstract.tex", "Intro.\nMost fail. We compared versions of the evaluator.\nEnd.\n");
  repo.commit("first");
  repo.write("abstract.tex", "Intro.\nMost fail. On a 36-task audit subset, we compared versions of the evaluator.\nEnd.\n");
  const result = await plugin.call(diffFileRpc, { cwd: repo.cwd, source: { kind: "changes" }, file: { path: "abstract.tex", status: "M" } });
  assert.equal(result.kind, "diff");
  if (result.kind !== "diff") return;
  const text = (lines: string[], [line, start, , end]: number[]) => lines[line - 1].slice(start - 1, end - 1);
  assert.deepEqual(
    result.changes.flatMap((change) => change.inner.map((inner) => [text(result.original, inner.original), text(result.modified, inner.modified)])),
    [["We", "On a 36-task audit subset, we"]],
  );
});

test("a binary file is not compared", async (t) => {
  const repo = repository(t);
  repo.write("image.bin", Buffer.from([0, 1, 2]));
  assert.deepEqual(await plugin.call(diffFileRpc, { cwd: repo.cwd, source: { kind: "changes" }, file: { path: "image.bin", status: "?" } }), { kind: "binary", size: 3 });
});

test("Publish Branch makes the remote's branch the upstream; Sync Changes pulls, then pushes what the branch had", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  const bare = bareRemote(t);
  repo.write("a.txt", "a\n");
  repo.commit("root");
  repo.git("remote", "add", "origin", bare);
  assert.deepEqual(
    (await plugin.call(remoteListRpc, { cwd })).remotes.map((remote) => remote.name),
    ["origin"],
  );

  await plugin.call(remotePushRpc, { cwd, force: "none", remote: "origin", setUpstream: true });
  assert.equal((await status(cwd)).upstream, "origin/main");

  // Someone else pushes a commit, and this branch makes one of its own.
  const other = clone(t, fileUrl(bare));
  other.write("theirs.txt", "theirs\n");
  other.commit("theirs");
  other.git("push", "--quiet");
  repo.write("mine.txt", "mine\n");
  repo.commit("mine");
  repo.git("fetch", "--quiet");
  const before = await status(cwd);
  assert.deepEqual([before.ahead, before.behind], [1, 1]);

  const synced = await plugin.call(remoteSyncRpc, { cwd, mode: "merge" });
  assert.deepEqual(synced, { pulled: true, pushed: true, conflicted: false });
  const now = await status(cwd);
  assert.deepEqual([now.ahead, now.behind], [0, 0]);
  const pushed = gitIn(bare, ["log", "--format=%s", "main"]);
  assert.match(pushed, /mine/);
  assert.match(pushed, /theirs/);
});

test("a merge under way: committing concludes it, starting from git's merge message", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  const { side } = mergeConflict(repo);

  let now = await status(cwd);
  assert.deepEqual(now.operation, { kind: "merge", current: side, message: "Merge branch 'side'" });
  assert.equal(now.template, "Merge branch 'side'"); // the comments git adds below it left out
  repo.write("a.txt", "both\n");
  await plugin.call(changesStageRpc, { cwd, files: now.conflicts });
  await commit(cwd, now.template);
  now = await status(cwd);
  assert.deepEqual([now.operation, now.template], [null, ""]);
  assert.equal(repo.git("log", "-1", "--format=%s"), "Merge branch 'side'");
  assert.equal(repo.git("log", "-1", "--format=%P").split(" ").length, 2);
});

test("a rebase under way: what is applied, where, and which step; committing never continues it", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  repo.write("a.txt", "base\n");
  repo.commit("base");
  repo.git("switch", "--quiet", "--create", "side");
  repo.write("a.txt", "side\n");
  const picked = repo.commit("side's change");
  repo.git("switch", "--quiet", "main");
  repo.write("a.txt", "main\n");
  const onto = repo.commit("main");
  repo.git("switch", "--quiet", "side");
  assert.equal(repo.tryGit("rebase", "--quiet", "main"), false);

  let now = await status(cwd);
  assert.equal(now.rebaseMessage, "side's change");
  assert.ok(now.operation !== null && now.operation.kind === "rebase");
  if (now.operation?.kind !== "rebase") return;
  assert.equal(now.operation.current, picked);
  assert.equal(now.operation.onto, onto);
  assert.equal(now.operation.branch, "side");
  assert.deepEqual([now.operation.step, now.operation.total], [1, 1]);
  assert.equal(now.operation.stoppedForEdit, false); // stopped on a conflict
  assert.equal(now.branch, null);
  assert.equal(now.detached, true);

  repo.write("a.txt", "main and side\n");
  await plugin.call(changesStageRpc, { cwd, files: now.conflicts });
  gitIn(cwd, ["rebase", "--continue"], { GIT_EDITOR: "true" });
  now = await status(cwd);
  assert.deepEqual([now.operation, now.rebaseMessage, now.branch], [null, null, "side"]);
  assert.equal(repo.git("log", "-1", "--format=%s"), "side's change");
});

test("committing everything, as VS Code offers when nothing is staged, and the commit template", async (t) => {
  const repo = repository(t);
  const { cwd } = repo;
  repo.write("template.txt", "# what changed\nfix: \n");
  repo.git("config", "commit.template", "template.txt"); // from the repository's root
  assert.equal((await status(cwd)).template, "fix:");
  repo.write("a.txt", "a\n");
  await commit(cwd, "everything", { all: true });
  const now = await status(cwd);
  assert.deepEqual([now.staged, now.changes], [[], []]);
  assert.deepEqual(repo.git("show", "--name-only", "--format=", "HEAD").split(/\r?\n/), ["a.txt", "template.txt"]);
});
