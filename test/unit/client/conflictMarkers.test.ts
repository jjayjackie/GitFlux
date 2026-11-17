import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chosenText,
  conflictCount,
  hasConflictMarkers,
  joinParts,
  parseConflicts,
  resolveAll,
  resolveBlock,
  splitKeepingBreaks,
} from "../../../client/views/detail/conflict/markers.ts";
import type { ConflictPart } from "../../../client/views/detail/conflict/markers.ts";

const merge = ["before\n", "<<<<<<< HEAD\n", "ours 1\n", "ours 2\n", "=======\n", "theirs\n", ">>>>>>> feature\n", "after\n"].join("");
const diff3 = ["a\n", "<<<<<<< HEAD\n", "mine\n", "||||||| merged common ancestors\n", "old\n", "=======\n", "yours\n", ">>>>>>> topic\n", "z"].join("");

const blocks = (text: string) => parseConflicts(text).filter((part): part is ConflictPart => part.kind === "conflict");

test("a merge conflict reads as text, a block with both sides and git's labels, and text", () => {
  const parts = parseConflicts(merge);
  assert.deepEqual(
    parts.map((part) => part.kind),
    ["text", "conflict", "text"],
  );
  const [block] = blocks(merge);
  assert.equal(block.ours, "ours 1\nours 2\n");
  assert.equal(block.theirs, "theirs\n");
  assert.equal(block.base, null);
  assert.equal(block.oursLabel, "HEAD");
  assert.equal(block.theirsLabel, "feature");
  assert.equal(block.index, 0);
});

test("diff3 blocks carry the base and its label", () => {
  const [block] = blocks(diff3);
  assert.equal(block.ours, "mine\n");
  assert.equal(block.base, "old\n");
  assert.equal(block.baseLabel, "merged common ancestors");
  assert.equal(block.theirs, "yours\n");
});

test("parsing keeps every byte: the parts join back into the text, CRLF and a last line without a break included", () => {
  const crlf = merge.replace(/\n/g, "\r\n");
  for (const text of [merge, diff3, crlf, "", "no conflict at all", "x\n<<<<<<< a\n", "=======\n>>>>>>> b\n"]) assert.equal(joinParts(parseConflicts(text)), text);
  const [block] = blocks(crlf);
  assert.equal(block.ours, "ours 1\r\nours 2\r\n");
  assert.equal(block.theirsLabel, "feature");
});

test("what does not close as a block stays text", () => {
  // Runs to the end of the file.
  assert.equal(conflictCount(parseConflicts("x\n<<<<<<< HEAD\nours\n=======\ntheirs\n")), 0);
  // Closed without a separator.
  assert.equal(conflictCount(parseConflicts("<<<<<<< HEAD\nours\n>>>>>>> b\n")), 0);
  // A separator or an end on its own.
  assert.equal(conflictCount(parseConflicts("=======\n>>>>>>> b\n")), 0);
  // Eight marks are not a marker.
  assert.equal(conflictCount(parseConflicts("<<<<<<<< x\n=======\n>>>>>>> b\n")), 0);
});

test("a block opened again before it closed: the first opening is text, the second block counts", () => {
  const text = "<<<<<<< HEAD\nstray\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> b\n";
  const parts = parseConflicts(text);
  assert.deepEqual(
    parts.map((part) => part.kind),
    ["text", "conflict"],
  );
  assert.equal((parts[0] as { text: string }).text, "<<<<<<< HEAD\nstray\n");
  assert.equal(joinParts(parts), text);
});

test("separators inside the incoming side are its text", () => {
  const [block] = blocks("<<<<<<< a\nx\n=======\ny\n=======\nz\n>>>>>>> b\n");
  assert.equal(block.theirs, "y\n=======\nz\n");
});

test("a block resolves to one side, both, or the base, and nothing else in the file changes", () => {
  assert.equal(resolveBlock(merge, 0, "ours"), "before\nours 1\nours 2\nafter\n");
  assert.equal(resolveBlock(merge, 0, "theirs"), "before\ntheirs\nafter\n");
  assert.equal(resolveBlock(merge, 0, "both"), "before\nours 1\nours 2\ntheirs\nafter\n");
  assert.equal(resolveBlock(diff3, 0, "base"), "a\nold\nz");
  assert.equal(resolveBlock(merge, 0, "base"), "before\nafter\n"); // no base written: nothing
  assert.equal(resolveBlock(merge, 5, "ours"), merge); // no such block
});

test("with two blocks, resolving one leaves the other as it was", () => {
  const two = `${merge}${merge}`;
  assert.equal(conflictCount(parseConflicts(two)), 2);
  const once = resolveBlock(two, 1, "theirs");
  assert.equal(once, `${merge}before\ntheirs\nafter\n`);
  assert.equal(conflictCount(parseConflicts(once)), 1);
  assert.equal(resolveAll(two, "ours"), "before\nours 1\nours 2\nafter\n".repeat(2));
});

test("both sides are joined with the file's own line break when the current side has none at its end", () => {
  const block: ConflictPart = { kind: "conflict", index: 0, raw: "<<<<<<< a\r\n", ours: "x", base: null, theirs: "y\r\n", oursLabel: "a", baseLabel: null, theirsLabel: "b" };
  assert.equal(chosenText(block, "both"), "x\r\ny\r\n");
});

test("markers are found as VS Code finds them", () => {
  assert.ok(hasConflictMarkers(merge));
  assert.ok(hasConflictMarkers(merge.replace(/\n/g, "\r\n")));
  assert.ok(hasConflictMarkers("a\n=======\nb"));
  assert.equal(hasConflictMarkers("clean\ntext\n"), false);
  assert.equal(hasConflictMarkers(resolveAll(merge, "both")), false);
  assert.equal(hasConflictMarkers("========\n"), false);
});

test("lines keep their breaks", () => {
  assert.deepEqual(splitKeepingBreaks("a\r\nb\nc"), ["a\r\n", "b\n", "c"]);
  assert.deepEqual(splitKeepingBreaks(""), []);
  assert.deepEqual(splitKeepingBreaks("\n"), ["\n"]);
});
