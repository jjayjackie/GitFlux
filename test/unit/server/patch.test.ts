// server/patch.ts: reading git's unified diffs into hunks, and building patches of a selection of their lines for
// `git apply` (stage) and `git apply --reverse` (unstage, discard).

import assert from "node:assert/strict";
import { test } from "node:test";
import { additionHunks, buildPatch, hunkId, parsePatch, toHunk, type PatchFile } from "../../../server/patch.ts";

const HEADER = ["diff --git a/f.txt b/f.txt", "index 1111111..2222222 100644", "--- a/f.txt", "+++ b/f.txt"];
const diff = (...lines: string[]) => `${[...HEADER, ...lines].join("\n")}\n`;

/** The one section of a diff. */
function only(text: string): PatchFile {
  const files = parsePatch(text);
  assert.equal(files.length, 1);
  return files[0];
}

test("two hunks, a function name after the second @@, line numbers on each side", () => {
  const file = only(diff("@@ -1,3 +1,3 @@", " a", "-b", "+B", " c", "@@ -10,2 +10,3 @@ function main() {", " j", "+k", " l"));
  assert.deepEqual(file.header, HEADER);
  assert.equal(file.binary, false);
  assert.equal(file.hunks.length, 2);
  const [first, second] = file.hunks;
  assert.deepEqual([first.oldStart, first.oldLines, first.newStart, first.newLines], [1, 3, 1, 3]);
  assert.deepEqual(
    first.lines.map((line) => [line.kind, line.text, line.oldLine, line.newLine]),
    [
      ["context", "a", 1, 1],
      ["delete", "b", 2, undefined],
      ["add", "B", undefined, 2],
      ["context", "c", 3, 3],
    ],
  );
  assert.equal(second.header, "@@ -10,2 +10,3 @@ function main() {");
  assert.deepEqual(
    second.lines.map((line) => line.kind),
    ["context", "add", "context"],
  );
  assert.equal(toHunk(second).header, "@@ -10,2 +10,3 @@ function main() {");
});

test("ids are stable for the same hunk and change with any change to it", () => {
  const text = diff("@@ -1,2 +1,2 @@", " a", "-b", "+B");
  const id = only(text).hunks[0].id;
  assert.match(id, /^[0-9a-f]{40}$/);
  assert.equal(only(text).hunks[0].id, id);
  assert.notEqual(only(diff("@@ -1,2 +1,2 @@", " a", "-b", "+C")).hunks[0].id, id);
  assert.notEqual(only(diff("@@ -2,2 +2,2 @@", " a", "-b", "+B")).hunks[0].id, id);
  const hunk = only(text).hunks[0];
  assert.equal(hunkId(0, hunk), id);
  assert.notEqual(hunkId(1, hunk), id);
});

test("\\ No newline at end of file, on the old side and on the new", () => {
  const file = only(diff("@@ -1,2 +1,2 @@", " a", "-b", "\\ No newline at end of file", "+b"));
  const lines = file.hunks[0].lines;
  assert.deepEqual(
    lines.map((line) => [line.kind, line.noNewline]),
    [
      ["context", false],
      ["delete", true],
      ["add", false],
    ],
  );
  const other = only(diff("@@ -1 +1 @@", "-x", "+y", "\\ No newline at end of file"));
  assert.deepEqual(
    other.hunks[0].lines.map((line) => line.noNewline),
    [false, true],
  );
  assert.equal(toHunk(other.hunks[0]).lines[1].noNewline, true);
  assert.equal(toHunk(other.hunks[0]).lines[0].noNewline, undefined);
});

test("CRLF lines keep their CR in the patch, and lose it in what the client sees", () => {
  const file = only(diff("@@ -1,2 +1,2 @@", " a\r", "-b\r", "+B\r"));
  assert.equal(file.hunks[0].lines[1].text, "b\r");
  assert.equal(toHunk(file.hunks[0]).lines[1].text, "b");
  const { patch } = buildPatch([file], [{ id: file.hunks[0].id }], "forward");
  assert.ok(patch?.includes("\n-b\r\n+B\r\n"), patch ?? "");
});

test("non-UTF-8 bytes survive as latin1 and decode as UTF-8 for the client", () => {
  const utf8 = Buffer.from(diff("@@ -1 +1 @@", "-ä", "+ö"), "utf8").toString("latin1");
  const file = only(utf8);
  assert.equal(toHunk(file.hunks[0]).lines[0].text, "ä");
  const { patch } = buildPatch([file], [{ id: file.hunks[0].id }], "forward");
  assert.equal(Buffer.from(patch ?? "", "latin1").toString("utf8").includes("+ö"), true);
});

test("an empty context line that lost its space is still a line of both sides", () => {
  const file = only(diff("@@ -1,3 +1,3 @@", " a", "", "-b", "+c"));
  assert.deepEqual(
    file.hunks[0].lines.map((line) => [line.kind, line.text]),
    [
      ["context", "a"],
      ["context", ""],
      ["delete", "b"],
      ["add", "c"],
    ],
  );
});

test("an added file, a deleted one, a mode change alone and a binary file", () => {
  const added = parsePatch(["diff --git a/n.txt b/n.txt", "new file mode 100644", "index 0000000..1111111", "--- /dev/null", "+++ b/n.txt", "@@ -0,0 +1,2 @@", "+x", "+y", ""].join("\n"));
  assert.deepEqual([added[0].hunks[0].oldStart, added[0].hunks[0].oldLines, added[0].hunks[0].newLines], [0, 0, 2]);
  const deleted = parsePatch(["diff --git a/d.txt b/d.txt", "deleted file mode 100644", "index 1111111..0000000", "--- a/d.txt", "+++ /dev/null", "@@ -1 +0,0 @@", "-x", ""].join("\n"));
  assert.deepEqual(
    deleted[0].hunks[0].lines.map((line) => line.kind),
    ["delete"],
  );
  const mode = parsePatch(["diff --git a/m.sh b/m.sh", "old mode 100644", "new mode 100755", ""].join("\n"));
  assert.equal(mode[0].hunks.length, 0);
  assert.equal(mode[0].binary, false);
  const binary = parsePatch(["diff --git a/b.bin b/b.bin", "index 1111111..2222222 100644", "Binary files a/b.bin and b/b.bin differ", ""].join("\n"));
  assert.equal(binary[0].binary, true);
  assert.equal(binary[0].hunks.length, 0);
  // Two sections: each has its own hunks, and the same hunk in another section has another id.
  const both = parsePatch(diff("@@ -1 +1 @@", "-x", "+y") + diff("@@ -1 +1 @@", "-x", "+y"));
  assert.equal(both.length, 2);
  assert.notEqual(both[0].hunks[0].id, both[1].hunks[0].id);
});

test("an untracked file's content is one hunk that adds every line, as git shows it once added", () => {
  assert.equal(additionHunks("").length, 0);
  const [hunk] = additionHunks("a\r\nb\nc");
  assert.equal(hunk.header, "@@ -0,0 +1,3 @@");
  assert.deepEqual(
    hunk.lines.map((line) => [line.kind, line.text, line.newLine, line.noNewline]),
    [
      ["add", "a\r", 1, false],
      ["add", "b", 2, false],
      ["add", "c", 3, true],
    ],
  );
  assert.equal(additionHunks("only\n")[0].header, "@@ -0,0 +1 @@");
  // The same as git's own diff of the file once added with --intent-to-add.
  const git = only(["diff --git a/u.txt b/u.txt", "new file mode 100644", "index 0000000..1111111", "--- /dev/null", "+++ b/u.txt", "@@ -0,0 +1,3 @@", "+a\r", "+b", "+c", "\\ No newline at end of file", ""].join("\n"));
  assert.equal(git.hunks[0].id, hunk.id);
});

// --- building patches -------------------------------------------------------------------------------------

/** The hunk lines of a built patch (everything after its header). */
function body(patch: string | null): string[] {
  assert.notEqual(patch, null);
  const lines = (patch ?? "").split("\n");
  lines.pop();
  return lines.slice(lines.findIndex((line) => line.startsWith("@@")));
}

const MIXED = diff("@@ -1,4 +1,4 @@", " a", "-b", "-c", "+B", "+C", " d");

test("stage, whole and in part: an unchosen delete stays as context, an unchosen add is dropped", () => {
  const file = only(MIXED);
  const id = file.hunks[0].id;
  const whole = buildPatch([file], [{ id }], "forward");
  assert.deepEqual(body(whole.patch), ["@@ -1,4 +1,4 @@", " a", "-b", "-c", "+B", "+C", " d"]);
  assert.ok(whole.patch?.startsWith(`${HEADER.join("\n")}\n`));
  // Lines 1 (-b) and 3 (+B) only.
  const part = buildPatch([file], [{ id, lines: [1, 3] }], "forward");
  assert.deepEqual(body(part.patch), ["@@ -1,4 +1,4 @@", " a", "-b", " c", "+B", " d"]);
  // A context index means nothing.
  assert.deepEqual(body(buildPatch([file], [{ id, lines: [0, 2] }], "forward").patch), ["@@ -1,4 +1,3 @@", " a", " b", "-c", " d"]);
});

test("unstage and discard (reverse), in part: an unchosen add stays as context, an unchosen delete is dropped", () => {
  const file = only(MIXED);
  const id = file.hunks[0].id;
  assert.deepEqual(body(buildPatch([file], [{ id, lines: [1, 3] }], "reverse").patch), ["@@ -1,4 +1,4 @@", " a", "-b", "+B", " C", " d"]);
  assert.deepEqual(body(buildPatch([file], [{ id, lines: [4] }], "reverse").patch), ["@@ -1,3 +1,4 @@", " a", " B", "+C", " d"]);
});

test("a selection that changes nothing in a hunk drops the hunk; one that changes nothing at all is no patch", () => {
  const file = only(diff("@@ -1,2 +1,2 @@", " a", "-b", "+c", "@@ -10,2 +10,3 @@", " j", "+k", " l"));
  const [first, second] = file.hunks;
  // Only a context line of the first chosen: in reverse its delete is dropped and its add stays as context.
  const result = buildPatch([file], [{ id: first.id, lines: [0] }, { id: second.id }], "reverse");
  assert.deepEqual(body(result.patch), ["@@ -10,2 +10,3 @@", " j", "+k", " l"]);
  assert.equal(buildPatch([file], [{ id: first.id, lines: [0] }], "forward").patch, null);
  assert.deepEqual(buildPatch([file], [{ id: "nope" }], "forward"), { patch: null, missing: ["nope"] });
});

test("later hunks are renumbered on the side the patch is not applied to", () => {
  const file = only(diff("@@ -1,3 +1,4 @@", " a", "+x", "+y", "-b", " c", "@@ -10,2 +11,3 @@", " j", "+k", " l"));
  const [first, second] = file.hunks;
  // Forward: only +x of the first hunk is taken (-b stays as context), so the second hunk's new start moves by 1.
  const forward = buildPatch([file], [{ id: first.id, lines: [1] }, { id: second.id }], "forward");
  assert.deepEqual(body(forward.patch), ["@@ -1,3 +1,4 @@", " a", "+x", " b", " c", "@@ -10,2 +11,3 @@", " j", "+k", " l"]);
  const fewer = buildPatch([file], [{ id: first.id, lines: [3] }, { id: second.id }], "forward");
  assert.deepEqual(body(fewer.patch), ["@@ -1,3 +1,2 @@", " a", "-b", " c", "@@ -10,2 +9,3 @@", " j", "+k", " l"]);
  // Reverse: the new side is kept; the old side moves.
  const reverse = buildPatch([file], [{ id: first.id, lines: [3] }, { id: second.id }], "reverse");
  assert.deepEqual(body(reverse.patch), ["@@ -1,5 +1,4 @@", " a", " x", " y", "-b", " c", "@@ -12,2 +11,3 @@", " j", "+k", " l"]);
});

test("the no-newline marker follows the line that ends a side, and a line that must gain a break becomes a change", () => {
  // Old "a\nx" (no newline), new "a\nx\ny" (no newline).
  const file = only(diff("@@ -1,2 +1,3 @@", " a", "-x", "\\ No newline at end of file", "+x", "+y", "\\ No newline at end of file"));
  const id = file.hunks[0].id;
  assert.deepEqual(body(buildPatch([file], [{ id }], "forward").patch), ["@@ -1,2 +1,3 @@", " a", "-x", "\\ No newline at end of file", "+x", "+y", "\\ No newline at end of file"]);
  // Only +y, staged: x stays but needs a line break before y, so it is still deleted and added.
  assert.deepEqual(body(buildPatch([file], [{ id, lines: [3] }], "forward").patch), ["@@ -1,2 +1,3 @@", " a", "-x", "\\ No newline at end of file", "+x", "+y", "\\ No newline at end of file"]);
  // Only -x and +x, staged: the new side ends with x and a line break.
  assert.deepEqual(body(buildPatch([file], [{ id, lines: [1, 2] }], "forward").patch), ["@@ -1,2 +1,2 @@", " a", "-x", "\\ No newline at end of file", "+x"]);
  // Only +y, unstaged (reverse): x (with its break) stays; y goes, and the old side ends at x with a break.
  assert.deepEqual(body(buildPatch([file], [{ id, lines: [3] }], "reverse").patch), ["@@ -1,2 +1,3 @@", " a", " x", "+y", "\\ No newline at end of file"]);
  // Only -x, reverse: +x and +y stay as context and y ends both sides; the x put back is followed by them, so it
  // gets a line break.
  assert.deepEqual(body(buildPatch([file], [{ id, lines: [1] }], "reverse").patch), ["@@ -1,4 +1,3 @@", " a", "-x", " x", " y", "\\ No newline at end of file"]);
});

test("part of a created file in reverse, or of a deleted one forward, becomes a modification with git's own names", () => {
  const created = only(["diff --git a/n.txt b/n.txt", "new file mode 100644", "index 0000000..1111111", "--- /dev/null", "+++ b/n.txt", "@@ -0,0 +1,2 @@", "+x", "+y", ""].join("\n"));
  const id = created.hunks[0].id;
  // Whole, reverse: still a deletion of the file.
  const whole = buildPatch([created], [{ id }], "reverse").patch ?? "";
  assert.ok(whole.includes("new file mode 100644\n") && whole.includes("--- /dev/null\n"), whole);
  // Part, reverse: the file stays.
  const part = buildPatch([created], [{ id, lines: [1] }], "reverse").patch ?? "";
  assert.deepEqual(part.split("\n").slice(0, 3), ["diff --git a/n.txt b/n.txt", "--- a/n.txt", "+++ b/n.txt"]);
  assert.deepEqual(body(part), ["@@ -1,1 +1,2 @@", " x", "+y"]);
  // Part, forward: creating a file with fewer lines is fine as it is.
  const forward = buildPatch([created], [{ id, lines: [0] }], "forward").patch ?? "";
  assert.ok(forward.includes("--- /dev/null\n"), forward);
  assert.deepEqual(body(forward), ["@@ -0,0 +1,1 @@", "+x"]);

  // A quoted name (with a space, and git's tab after it) keeps its quoting.
  const deleted = only(['diff --git "a/d \\303\\244.txt" "b/d \\303\\244.txt"', "deleted file mode 100644", "index 1111111..0000000", '--- "a/d \\303\\244.txt"\t', "+++ /dev/null", "@@ -1,2 +0,0 @@", "-x", "-y", ""].join("\n"));
  const kept = buildPatch([deleted], [{ id: deleted.hunks[0].id, lines: [0] }], "forward").patch ?? "";
  assert.deepEqual(kept.split("\n").slice(0, 3), ['diff --git "a/d \\303\\244.txt" "b/d \\303\\244.txt"', '--- "a/d \\303\\244.txt"\t', '+++ "b/d \\303\\244.txt"\t']);
  assert.deepEqual(body(kept), ["@@ -1,2 +1,1 @@", "-x", " y"]);
});

test("selections of the same hunk add up, and a whole one wins", () => {
  const file = only(MIXED);
  const id = file.hunks[0].id;
  const twice = buildPatch([file], [{ id, lines: [1] }, { id, lines: [3] }], "forward");
  assert.deepEqual(body(twice.patch), ["@@ -1,4 +1,4 @@", " a", "-b", " c", "+B", " d"]);
  const whole = buildPatch([file], [{ id, lines: [1] }, { id }], "forward");
  assert.deepEqual(body(whole.patch), ["@@ -1,4 +1,4 @@", " a", "-b", "-c", "+B", "+C", " d"]);
});
