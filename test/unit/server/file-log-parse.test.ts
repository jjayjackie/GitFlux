// `git log -z --name-status` of one file read into the commits of git.history.file, as git lays the records out (each
// header after U+001E, a newline before the first status, NUL after every record).

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFileLog } from "../../../server/history.ts";

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const H3 = "3".repeat(40);
const H4 = "4".repeat(40);

/** A header record: hash, parents, author, email, time, decoration, subject. */
const header = (hash: string, parents: string, subject: string, refs = "") => `\x1e${[hash, parents, "Ada", "ada@example.com", "1700000000", refs, subject].join("\x1f")}\0`;

test("across a rename: each commit carries the path in it; older ones the old path", () => {
  const out = [
    header(H4, H3, "edit after the move", "HEAD -> refs/heads/main"),
    "\nM\0new name/ファイル.txt\0",
    header(H3, H2, "move it"),
    "\nR087\0old.txt\0new name/ファイル.txt\0",
    header(H2, H1, "edit"),
    "\nM\0old.txt\0",
    header(H1, "", "add"),
    "\nA\0old.txt\0",
  ].join("");
  const commits = parseFileLog(out, "new name/ファイル.txt");
  assert.deepEqual(
    commits.map((commit) => [commit.hash, commit.status, commit.path]),
    [
      [H4, "M", "new name/ファイル.txt"],
      [H3, "R", "new name/ファイル.txt"],
      [H2, "M", "old.txt"],
      [H1, "A", "old.txt"],
    ],
  );
  assert.deepEqual(commits[0].refs, [{ kind: "head", name: "main" }]);
  assert.deepEqual(commits[1].parents, [H2]);
  assert.deepEqual(commits[3].parents, []);
  assert.equal(commits[0].subject, "edit after the move");
  assert.equal(commits[0].author, "Ada");
  assert.equal(commits[0].time, 1_700_000_000);
});

test("a commit without a file listed keeps the path it was asked for; a folder's first file stands for the commit", () => {
  const out = [header(H3, `${H1} ${H2}`, "merge"), header(H2, H1, "two files"), "\nM\0dir/a.txt\0D\0dir/b.txt\0", header(H1, "", "root"), "\nA\0dir/a.txt\0A\0dir/b.txt\0"].join("");
  const commits = parseFileLog(out, "dir");
  assert.deepEqual(
    commits.map((commit) => [commit.status, commit.path]),
    [
      ["M", "dir"],
      ["M", "dir/a.txt"],
      ["A", "dir/a.txt"],
    ],
  );
  assert.deepEqual(commits[0].parents, [H1, H2]);
});

test("a path that starts with a newline is kept as it is; a copy leads to its source", () => {
  const out = [header(H2, H1, "copy"), "\nC100\0src.txt\0\nodd.txt\0", header(H1, "", "add"), "\nA\0src.txt\0"].join("");
  const commits = parseFileLog(out, "\nodd.txt");
  assert.deepEqual(
    commits.map((commit) => [commit.status, commit.path]),
    [
      ["C", "\nodd.txt"],
      ["A", "src.txt"],
    ],
  );
});

test("no commit", () => {
  assert.equal(parseFileLog("", "a.txt").length, 0);
});
