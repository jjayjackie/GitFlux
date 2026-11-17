// The readers of git's machine output: status, log, name-status and numstat, show, worktrees, remotes, snapshots, and
// what a graph filter asks of `git log`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { filterPlan, mergeCounts, parseLog, parseNameStatus, parseNumstat, parseRefs, parseShow } from "../../../server/history.ts";
import { parseRemotes } from "../../../server/remote.ts";
import { parseStatus, parseWorktrees } from "../../../server/repo.ts";
import { parseSnapshots } from "../../../server/core/safety.ts";
import { logFilterSchema } from "../../../shared/rpc/history.ts";

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const H3 = "3".repeat(40);

test("status: branch, upstream, counts, stash, and every kind of entry", () => {
  const out = [
    `# branch.oid ${H1}`,
    "# branch.head feat/x",
    "# branch.upstream origin/feat/x",
    "# branch.ab +2 -3",
    "# stash 4",
    `1 .M N... 100644 100644 100644 ${H1} ${H1} file with spaces.txt`,
    `1 A. N... 000000 100644 100644 ${H1} ${H2} new.txt`,
    `2 R. N... 100644 100644 100644 ${H1} ${H1} R100 to.txt`,
    "from.txt",
    `u UU N... 100644 100644 100644 100644 ${H1} ${H2} ${H3} conflicted.txt`,
    "? untracked/ファイル.txt",
    "! ignored.txt",
    "",
  ].join("\0");
  const status = parseStatus(out);
  assert.equal(status.head, H1);
  assert.equal(status.branch, "feat/x");
  assert.equal(status.detached, false);
  assert.equal(status.upstream, "origin/feat/x");
  assert.equal(status.upstreamGone, false);
  assert.deepEqual([status.ahead, status.behind, status.stashCount], [2, 3, 4]);
  assert.deepEqual(status.staged, [
    { path: "new.txt", status: "A" },
    { path: "to.txt", status: "R", from: "from.txt" },
  ]);
  assert.deepEqual(status.changes, [
    { path: "file with spaces.txt", status: "M" },
    { path: "untracked/ファイル.txt", status: "?" },
  ]);
  assert.deepEqual(status.conflicts, [{ path: "conflicted.txt", status: "U", conflict: "UU" }]);
});

test("status: a detached HEAD, no commit yet, an upstream that is gone", () => {
  const detached = parseStatus(["# branch.oid " + H1, "# branch.head (detached)", ""].join("\0"));
  assert.deepEqual([detached.branch, detached.detached], [null, true]);
  const unborn = parseStatus(["# branch.oid (initial)", "# branch.head main", ""].join("\0"));
  assert.deepEqual([unborn.head, unborn.branch, unborn.stashCount], [null, "main", 0]);
  const gone = parseStatus(["# branch.oid " + H1, "# branch.head main", "# branch.upstream origin/main", ""].join("\0"));
  assert.equal(gone.upstreamGone, true);
});

test("refs of a decoration", () => {
  assert.deepEqual(parseRefs("HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1"), [
    { kind: "head", name: "main" },
    { kind: "remote", name: "origin/main" },
    { kind: "tag", name: "v1" },
  ]);
  assert.deepEqual(parseRefs("HEAD"), [{ kind: "head", name: "HEAD" }]);
  assert.deepEqual(parseRefs(""), []);
});

test("log records", () => {
  const record = (hash: string, parents: string, subject: string) => [hash, parents, "Ada", "ada@example.com", "1000", "refs/heads/x", subject].join("\x1f") + "\x1e\n";
  const commits = parseLog(record(H1, `${H2} ${H3}`, "merge: a, b") + record(H2, "", "root"));
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0], { hash: H1, parents: [H2, H3], author: "Ada", email: "ada@example.com", time: 1000, refs: [{ kind: "branch", name: "x" }], subject: "merge: a, b" });
  assert.deepEqual(commits[1].parents, []);
});

test("name-status and numstat, joined", () => {
  const names = parseNameStatus(["M", "a.txt", "R087", "old name.txt", "new name.txt", "A", "bin.png", ""].join("\0"));
  assert.deepEqual(names, [
    { path: "a.txt", status: "M" },
    { path: "new name.txt", from: "old name.txt", status: "R" },
    { path: "bin.png", status: "A" },
  ]);
  const counts = parseNumstat(["3\t1\ta.txt", "2\t2\t", "old name.txt", "new name.txt", "-\t-\tbin.png", ""].join("\0"));
  assert.deepEqual(counts, [
    { path: "a.txt", additions: 3, deletions: 1 },
    { path: "new name.txt", additions: 2, deletions: 2 },
    { path: "bin.png", additions: null, deletions: null },
  ]);
  assert.deepEqual(mergeCounts(names, counts), [
    { path: "a.txt", status: "M", additions: 3, deletions: 1 },
    { path: "new name.txt", from: "old name.txt", status: "R", additions: 2, deletions: 2 },
    { path: "bin.png", status: "A", binary: true },
  ]);
});

test("one commit's fields", () => {
  const out = [H1, `${H2}`, "Ada", "ada@example.com", "1000", "Bob", "bob@example.com", "2000", "HEAD -> refs/heads/main", "subject line", "subject line\n\nbody\n"].join("\x1f") + "\n";
  const detail = parseShow(out);
  assert.equal(detail.hash, H1);
  assert.deepEqual(detail.parents, [H2]);
  assert.deepEqual(detail.author, { name: "Ada", email: "ada@example.com", time: 1000 });
  assert.deepEqual(detail.committer, { name: "Bob", email: "bob@example.com", time: 2000 });
  assert.equal(detail.subject, "subject line");
  assert.equal(detail.body, "subject line\n\nbody");
  assert.deepEqual(detail.refs, [{ kind: "head", name: "main" }]);
});

test("worktrees", () => {
  const out = ["worktree /r/main", `HEAD ${H1}`, "branch refs/heads/main", "", "worktree /r/wt", `HEAD ${H2}`, "detached", "locked reason here", "", "worktree /r/gone", `HEAD ${H3}`, "branch refs/heads/x", "prunable gitdir file points to non-existent location", "", ""].join("\0");
  assert.deepEqual(parseWorktrees(out), [
    { path: "/r/main", head: H1, branch: "refs/heads/main", detached: false, bare: false, locked: false, prunable: false },
    { path: "/r/wt", head: H2, branch: null, detached: true, bare: false, locked: true, prunable: false },
    { path: "/r/gone", head: H3, branch: "refs/heads/x", detached: false, bare: false, locked: false, prunable: true },
  ]);
});

test("remotes, sorted, their URLs redacted", () => {
  const out = [
    "upstream\thttps://example.com/u.git (fetch)",
    "upstream\thttps://example.com/u.git (push)",
    "origin\thttps://ada:secret@example.com/o.git (fetch)",
    "origin\tgit@example.com:o/push.git (push)",
    "",
  ].join("\n");
  assert.deepEqual(parseRemotes(out), [
    { name: "origin", fetchUrl: "https://***@example.com/o.git", pushUrl: "git@example.com:o/push.git" },
    { name: "upstream", fetchUrl: "https://example.com/u.git", pushUrl: "https://example.com/u.git" },
  ]);
});

test("snapshots, newest first, with their reason and branch", () => {
  const line = (ref: string, hash: string, subject: string) => [ref, hash, subject].join("\0");
  const out = [
    line("refs/advanced-git/snapshots/1700000000000-0", H1, "On main: advanced-git snapshot reason=git.changes.discard branch=main"),
    line("refs/advanced-git/snapshots/1700000005000-1", H2, "On (no branch): advanced-git snapshot reason=git.branch.reset branch="),
    "",
  ].join("\n");
  assert.deepEqual(parseSnapshots(out), [
    { ref: "refs/advanced-git/snapshots/1700000005000-1", hash: H2, time: 1700000005, reason: "git.branch.reset", branch: null },
    { ref: "refs/advanced-git/snapshots/1700000000000-0", hash: H1, time: 1700000000, reason: "git.changes.discard", branch: "main" },
  ]);
});

test("what each filter asks of git log", () => {
  const plan = (filter: unknown) => filterPlan(logFilterSchema.parse(filter));
  assert.deepEqual(plan({ text: "fix", field: "message" }).args, ["--grep=fix", "--fixed-strings", "--regexp-ignore-case"]);
  assert.deepEqual(plan({ text: "fi.x", field: "message", regex: true, caseSensitive: true }).args, ["--grep=fi.x", "--extended-regexp"]);
  assert.deepEqual(plan({ text: "ada", field: "author" }).args, ["--author=ada", "--fixed-strings", "--regexp-ignore-case"]);
  assert.equal(plan({ text: "ABC12", field: "hash" }).hashPrefix, "abc12");
  assert.throws(() => plan({ text: "xyz", field: "hash" }));
  assert.deepEqual(plan({ text: "a*b", field: "path" }).paths, [":(icase)*a\\*b*"]);
  assert.deepEqual(plan({ text: "src", field: "path", caseSensitive: true }).paths, [":()*src*"]);
  assert.deepEqual(plan({ text: "x+1", field: "content" }).args, ["-Gx\\+1", "--regexp-ignore-case"]);
  assert.deepEqual(plan({ since: 100, until: 200, noMerges: true, path: "dir/a b" }), { args: ["--max-age=100", "--min-age=200", "--no-merges"], paths: [":(literal)dir/a b"], hashPrefix: null });
  assert.deepEqual(plan({ text: "--output=x", field: "message", author: "-n" }).args, ["--grep=--output=x", "--author=-n", "--fixed-strings", "--regexp-ignore-case"]);
});
