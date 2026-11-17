// `git blame --porcelain` read into lines, commits and text; the cut at a number of lines; quoted file names.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBlame, unquotePath } from "../../../server/blame.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const ZERO = "0".repeat(40);

/** The details git prints the first time a commit appears. */
const details = (author: string, email: string, time: number, summary: string, filename: string, extra: string[] = []) => [
  `author ${author}`,
  `author-mail <${email}>`,
  `author-time ${time}`,
  "author-tz +0000",
  `committer ${author}`,
  `committer-mail <${email}>`,
  `committer-time ${time}`,
  "committer-tz +0000",
  `summary ${summary}`,
  ...extra,
  `filename ${filename}`,
];

// Four lines: two from A (a group of two), one from B (renamed since: its filename differs), one not committed yet.
const OUT = [
  `${A} 1 1 2`,
  ...details("Ada", "ada@example.com", 1_700_000_000, "first: the start", "file.txt", ["boundary"]),
  "\tline one",
  `${A} 2 2`,
  "\tline two\r",
  `${B} 7 3 1`,
  ...details("Bob", "bob@example.com", 1_700_000_100, "second", "old name.txt", [`previous ${A} file.txt`]),
  "\t\tindented with a tab",
  `${ZERO} 4 4 1`,
  ...details("Not Committed Yet", "not.committed.yet", 1_700_000_200, "Version of file.txt from file.txt", "file.txt"),
  "\t",
  "",
].join("\n");

test("lines, their commits and their text", () => {
  const blame = parseBlame(OUT);
  assert.deepEqual(blame.lines, [
    { line: 1, hash: A, originalLine: 1 },
    { line: 2, hash: A, originalLine: 2 },
    { line: 3, hash: B, originalLine: 7 },
    { line: 4, hash: ZERO, originalLine: 4 },
  ]);
  assert.deepEqual(blame.text, ["line one", "line two", "\tindented with a tab", ""]);
  assert.deepEqual(blame.commits[A], { author: "Ada", email: "ada@example.com", time: 1_700_000_000, subject: "first: the start", path: "file.txt" });
  assert.deepEqual(blame.commits[B], { author: "Bob", email: "bob@example.com", time: 1_700_000_100, subject: "second", path: "old name.txt" });
  assert.deepEqual(blame.commits[ZERO], { author: "Not Committed Yet", email: "not.committed.yet", time: 1_700_000_200, subject: "Version of file.txt from file.txt", path: "file.txt" });
  assert.equal(Object.keys(blame.commits).length, 3);
  assert.equal(blame.truncated, false);
});

test("cut at a number of lines: truncated, and only the commits the kept lines name", () => {
  const two = parseBlame(OUT, 2);
  assert.equal(two.lines.length, 2);
  assert.deepEqual(two.text, ["line one", "line two"]);
  assert.equal(two.truncated, true);
  assert.deepEqual(Object.keys(two.commits), [A]);
  // Exactly as many lines as allowed is not a cut.
  const four = parseBlame(OUT, 4);
  assert.equal(four.lines.length, 4);
  assert.equal(four.truncated, false);
});

test("nothing to read", () => {
  const blame = parseBlame("");
  assert.equal(blame.lines.length, 0);
  assert.equal(blame.text.length, 0);
  assert.equal(Object.keys(blame.commits).length, 0);
  assert.equal(blame.truncated, false);
});

test("SHA-256 hashes, and a line that only looks like a header", () => {
  const long = "c".repeat(64);
  const blame = parseBlame([`${long} 1 1 1`, ...details("Cy", "cy@example.com", 1, "s", "f"), `\t${A} 1 1 1`, ""].join("\n"));
  assert.deepEqual(blame.lines, [{ line: 1, hash: long, originalLine: 1 }]);
  assert.deepEqual(blame.text, [`${A} 1 1 1`]);
});

test("file names git quoted: escapes and octal UTF-8 bytes", () => {
  assert.equal(unquotePath("plain name.txt"), "plain name.txt");
  assert.equal(unquotePath('"tab\\there.txt"'), "tab\there.txt");
  assert.equal(unquotePath('"quote\\"and\\\\slash"'), 'quote"and\\slash');
  assert.equal(unquotePath('"\\346\\226\\207\\344\\273\\266.txt"'), "文件.txt");
  assert.equal(unquotePath('"mixed ü \\303\\274"'), "mixed ü ü");
  const blame = parseBlame([`${A} 1 1 1`, ...details("Ada", "a@example.com", 1, "s", '"new\\nline.txt"'), "\tx", ""].join("\n"));
  assert.equal(blame.commits[A].path, "new\nline.txt");
});
