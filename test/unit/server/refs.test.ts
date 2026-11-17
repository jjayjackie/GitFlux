// The readers of `git for-each-ref` output for branches and tags (server/refs.ts): records split by counting NUL-ended
// fields, ahead/behind/gone, remote names that hold a slash, `<remote>/HEAD`, worktrees, protection, and the bounds.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BRANCH_FIELDS,
  BRANCH_FORMAT,
  TAG_FIELDS,
  TAG_FORMAT,
  checkedOutElsewhere,
  parseBranchRecords,
  parseTags,
  parseTrack,
  splitRecords,
  splitRemoteRef,
  toLocalBranches,
  toRemoteBranches,
} from "../../../server/refs.ts";

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const H3 = "3".repeat(64);

/** One record as for-each-ref prints it with a format whose every field ends with %00. */
const record = (...fields: string[]) => `${fields.join("\0")}\0\n`;

test("the formats end every field with NUL, the subject last", () => {
  assert.equal(BRANCH_FORMAT.split("%00").length - 1, BRANCH_FIELDS.length);
  assert.equal(TAG_FORMAT.split("%00").length - 1, TAG_FIELDS.length);
  assert.equal(BRANCH_FIELDS[BRANCH_FIELDS.length - 1], "%(contents:subject)");
  assert.equal(TAG_FIELDS[TAG_FIELDS.length - 1], "%(contents:subject)");
});

test("records are split by counting fields, whatever the subject holds", () => {
  const out = record("refs/heads/a", "x", "subject with\nnewline") + record("refs/heads/b", "y", "") + "\n";
  assert.deepEqual(splitRecords(out, 3), [
    ["refs/heads/a", "x", "subject with\nnewline"],
    ["refs/heads/b", "y", ""],
  ]);
  assert.equal(splitRecords("", 3).length, 0);
  assert.equal(splitRecords("\r\n", 3).length, 0);
});

test("upstream:track reads ahead, behind and gone", () => {
  assert.deepEqual(parseTrack("[ahead 2, behind 3]"), { ahead: 2, behind: 3, gone: false });
  assert.deepEqual(parseTrack("[ahead 1]"), { ahead: 1, behind: 0, gone: false });
  assert.deepEqual(parseTrack("[behind 7]"), { ahead: 0, behind: 7, gone: false });
  assert.deepEqual(parseTrack("[gone]"), { ahead: 0, behind: 0, gone: true });
  assert.deepEqual(parseTrack(""), { ahead: 0, behind: 0, gone: false });
});

test("a remote-tracking name is split by the longest configured remote that prefixes it", () => {
  const remotes = ["origin", "team", "team/sub"];
  assert.deepEqual(splitRemoteRef("origin/feat/x", remotes), { remote: "origin", branch: "feat/x" });
  assert.deepEqual(splitRemoteRef("team/sub/main", remotes), { remote: "team/sub", branch: "main" });
  assert.deepEqual(splitRemoteRef("team/main", remotes), { remote: "team", branch: "main" });
  // A remote no longer configured: its first segment.
  assert.deepEqual(splitRemoteRef("gone/feat", remotes), { remote: "gone", branch: "feat" });
  assert.deepEqual(splitRemoteRef("originals/x", ["origin"]), { remote: "originals", branch: "x" });
});

test("local branches: current, upstream and counts, gone, other work trees, protection", () => {
  const out =
    record("refs/heads/feat/x", H1, "origin/feat/x", "[ahead 2, behind 1]", " ", "", "1700000000", "", "feat subject") +
    record("refs/heads/main", H2, "origin/main", "", "*", "/repo", "1700000100", "", "main subject") +
    record("refs/heads/old", H1, "origin/old", "[gone]", " ", "", "1600000000", "", "") +
    record("refs/heads/wt", H3, "", "", " ", "/elsewhere/wt", "1700000200", "", "in a worktree") +
    record("refs/heads/here-too", H1, "", "", " ", "/repo-link", "1", "", "same tree by another name") +
    record("refs/heads/broken", "not-a-hash", "", "", " ", "", "1", "", "skipped");
  const records = parseBranchRecords(out);
  assert.equal(records.length, 5);
  const { entries, truncated } = toLocalBranches(records, { here: new Set(["/repo", "/repo-link"]), protectedBranches: ["main", "release/*"], max: 10 });
  assert.equal(truncated, false);
  assert.deepEqual(entries[0], {
    name: "feat/x",
    hash: H1,
    upstream: "origin/feat/x",
    upstreamGone: false,
    ahead: 2,
    behind: 1,
    current: false,
    worktree: null,
    time: 1700000000,
    subject: "feat subject",
    protected: false,
  });
  assert.deepEqual([entries[1].name, entries[1].current, entries[1].protected, entries[1].worktree], ["main", true, true, null]);
  assert.deepEqual([entries[2].upstream, entries[2].upstreamGone], ["origin/old", true]);
  assert.deepEqual([entries[3].worktree, entries[3].upstream, entries[3].hash], ["/elsewhere/wt", null, H3]);
  assert.equal(entries[4].worktree, null);
});

test("local branches are cut at the bound, saying so", () => {
  const out = Array.from({ length: 4 }, (_, n) => record(`refs/heads/b${n}`, H1, "", "", " ", "", "0", "", "")).join("");
  const { entries, truncated } = toLocalBranches(parseBranchRecords(out), { here: new Set<string>(), protectedBranches: [], max: 3 });
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["b0", "b1", "b2"],
  );
  assert.equal(truncated, true);
});

test("remote branches: <remote>/HEAD is not listed but marks the default branch", () => {
  const out =
    record("refs/remotes/origin/HEAD", H1, "", "", " ", "", "1", "refs/remotes/origin/main", "head") +
    record("refs/remotes/origin/feat", H2, "", "", " ", "", "2", "", "feat") +
    record("refs/remotes/origin/main", H1, "", "", " ", "", "3", "", "main") +
    record("refs/remotes/team/sub/topic", H2, "", "", " ", "", "4", "", "topic");
  const { entries, truncated } = toRemoteBranches(parseBranchRecords(out), ["origin", "team/sub"], 10);
  assert.equal(truncated, false);
  assert.deepEqual(entries, [
    { name: "origin/feat", remote: "origin", branch: "feat", hash: H2, time: 2, subject: "feat", isHead: false },
    { name: "origin/main", remote: "origin", branch: "main", hash: H1, time: 3, subject: "main", isHead: true },
    { name: "team/sub/topic", remote: "team/sub", branch: "topic", hash: H2, time: 4, subject: "topic", isHead: false },
  ]);
  const cut = toRemoteBranches(parseBranchRecords(out), ["origin", "team/sub"], 2);
  assert.equal(cut.entries.length, 2);
  assert.equal(cut.truncated, true);
});

test("tags: annotated ones peeled to their commit with tagger and message, lightweight ones at their commit", () => {
  const out =
    record("refs/tags/v2.0", "tag", H3, H1, "Tagger Name", "1700000500", "", "1700000000", "Release 2.0") +
    record("refs/tags/v1.0", "commit", H2, "", "", "", "1600000000", "", "commit subject") +
    record("refs/tags/old", "tag", H3, H2, "", "", "", "1500000000", "") +
    record("refs/tags/odd", "tag", H3, "", "", "", "", "", "peels to nothing readable");
  const { tags, truncated } = parseTags(out, 10);
  assert.equal(truncated, false);
  assert.deepEqual(tags, [
    { name: "v2.0", hash: H1, annotated: true, time: 1700000500, message: "Release 2.0", tagger: "Tagger Name" },
    { name: "v1.0", hash: H2, annotated: false, time: 1600000000 },
    // A tag object without a tagger: the commit's time.
    { name: "old", hash: H2, annotated: true, time: 1500000000, message: "" },
  ]);
  const cut = parseTags(out, 1);
  assert.equal(cut.tags.length, 1);
  assert.equal(cut.truncated, true);
});

test("git's words for a branch checked out in another work tree are recognised, old and new", () => {
  assert.ok(checkedOutElsewhere("fatal: 'feat' is already used by worktree at '/tmp/wt'"));
  assert.ok(checkedOutElsewhere("fatal: 'feat' is already checked out at '/tmp/wt'"));
  assert.ok(checkedOutElsewhere("error: cannot delete branch 'feat' used by worktree at '/tmp/wt'"));
  assert.ok(checkedOutElsewhere("error: Cannot delete branch 'feat' checked out at '/tmp/wt'"));
  assert.equal(checkedOutElsewhere("error: pathspec 'feat' did not match any file(s) known to git"), false);
});
