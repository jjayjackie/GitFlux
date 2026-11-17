// The reader of `git stash list --format=STASH_FORMAT`, and of git's prefix on a stash's subject.

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeStash, parseStashList, STASH_FORMAT } from "../../../server/stash.ts";

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const H3 = "a".repeat(64);

/** A record as git prints it for STASH_FORMAT: fields split by U+001F, ended by U+001E and the format's newline. */
const record = (hash: string, time: number, subject: string) => `${hash}\x1f${time}\x1f${subject}\x1e\n`;

test("the format asks for the hash, the time and the reflog subject, NUL-free", () => {
  assert.equal(STASH_FORMAT, "%H%x1f%ct%x1f%gs%x1e");
});

test("subjects: with and without a message, on a detached HEAD, without git's prefix", () => {
  assert.deepEqual(describeStash("WIP on main: 1234567 fix: the thing"), { message: "1234567 fix: the thing", branch: "main" });
  assert.deepEqual(describeStash("On feat/x: my message: with a colon"), { message: "my message: with a colon", branch: "feat/x" });
  assert.deepEqual(describeStash("WIP on (no branch): 1234567 detached"), { message: "1234567 detached", branch: null });
  assert.deepEqual(describeStash("On (no branch): saved"), { message: "saved", branch: null });
  assert.deepEqual(describeStash("stored by hand"), { message: "stored by hand", branch: null });
  assert.deepEqual(describeStash("On main: "), { message: "", branch: "main" });
});

test("the list: newest first, stash@{n} by position, SHA-256 hashes, messages in any script", () => {
  const out = record(H1, 1_700_000_200, "On main: 储藏 ファイル") + record(H2, 1_700_000_100, "WIP on topic: abcdef0 subject") + record(H3, 1_700_000_000, "On (no branch): x");
  const list = parseStashList(out);
  assert.deepEqual(list, [
    { index: 0, ref: "stash@{0}", hash: H1, message: "储藏 ファイル", branch: "main", time: 1_700_000_200 },
    { index: 1, ref: "stash@{1}", hash: H2, message: "abcdef0 subject", branch: "topic", time: 1_700_000_100 },
    { index: 2, ref: "stash@{2}", hash: H3, message: "x", branch: null, time: 1_700_000_000 },
  ]);
});

test("the list: nothing, CRLF line ends, a field separator inside a subject", () => {
  assert.equal(parseStashList("").length, 0);
  assert.equal(parseStashList("\n").length, 0);
  const crlf = parseStashList(`${H1}\x1f1\x1fOn main: a\x1e\r\n${H2}\x1f2\x1fOn main: b\x1e\r\n`);
  assert.deepEqual(
    crlf.map((entry) => [entry.index, entry.message]),
    [
      [0, "a"],
      [1, "b"],
    ],
  );
  assert.equal(parseStashList(record(H1, 1, "On main: a\x1fb"))[0].message, "a\x1fb");
});

test("the list: a record that is not a stash keeps the positions of the others", () => {
  const list = parseStashList(record("not-a-hash", 1, "On main: broken") + record(H2, 2, "On main: second"));
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].index, list[0].ref, list[0].hash], [1, "stash@{1}", H2]);
});
