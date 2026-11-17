// git.diff.file for every source, binary and too-large files, whitespace, and syntax tokens.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { diffFileRpc, type FileDiff } from "../../shared/rpc/diff.ts";
import { DIFF_MAX_BYTES } from "../../shared/limits.ts";
import type { DiffSource, FileChange } from "../../shared/schemas.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { repository, type Repo } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const diff = (repo: Repo, source: DiffSource, file: FileChange, extra: { highlight?: boolean; whitespace?: "ignore-trim" | "show" } = {}) =>
  plugin.call(diffFileRpc, { cwd: repo.cwd, source, file, ...extra });

/** The two sides of a diff, or the one side of a file, as text. */
function sidesOf(result: FileDiff): [string, string] | string {
  if (result.kind === "diff") return [result.original.join("\n"), result.modified.join("\n")];
  if (result.kind === "file") return result.lines.join("\n");
  return result.kind;
}

test("every source compares the sides it names", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "one\n");
  const first = repo.commit("first");
  repo.write("a.txt", "two\n");
  const second = repo.commit("second");
  const file: FileChange = { path: "a.txt", status: "M" };

  assert.deepEqual(sidesOf(await diff(repo, { kind: "commit", hash: second }, file)), ["one\n", "two\n"]);
  assert.deepEqual(sidesOf(await diff(repo, { kind: "incoming", from: first, to: second }, file)), ["one\n", "two\n"]);
  assert.deepEqual(sidesOf(await diff(repo, { kind: "outgoing", from: second, to: first }, file)), ["two\n", "one\n"]);
  assert.deepEqual(sidesOf(await diff(repo, { kind: "compare", from: "HEAD~1", to: "main" }, file)), ["one\n", "two\n"]);

  repo.write("a.txt", "three\n");
  repo.git("add", "a.txt");
  repo.write("a.txt", "four\n");
  assert.deepEqual(sidesOf(await diff(repo, { kind: "staged" }, file)), ["two\n", "three\n"]);
  assert.deepEqual(sidesOf(await diff(repo, { kind: "changes" }, file)), ["three\n", "four\n"]);

  // A stash: its tracked changes against the commit it was made on, and an untracked file it kept, as added.
  repo.write("new.txt", "kept aside\n");
  repo.git("stash", "push", "--quiet", "--include-untracked");
  const stash = repo.git("rev-parse", "stash@{0}");
  assert.deepEqual(sidesOf(await diff(repo, { kind: "stash", hash: stash }, file)), ["two\n", "four\n"]);
  assert.deepEqual(sidesOf(await diff(repo, { kind: "stash", hash: stash }, { path: "new.txt", status: "A" })), "kept aside\n");

  assert.equal((await failure(diff(repo, { kind: "compare", from: "nope", to: "main" }, file))).code, "REF_NOT_FOUND");
});

test("an added and a deleted file open as their one side", async (t) => {
  const repo = repository(t);
  repo.write("gone.txt", "old\n");
  repo.commit("first");
  repo.git("rm", "--quiet", "gone.txt");
  repo.write("added.txt", "new\n");
  const second = repo.commit("second");
  assert.deepEqual(await diff(repo, { kind: "commit", hash: second }, { path: "added.txt", status: "A" }), { kind: "file", lines: ["new", ""], truncated: false });
  assert.deepEqual(await diff(repo, { kind: "commit", hash: second }, { path: "gone.txt", status: "D" }), { kind: "file", lines: ["old", ""], truncated: false });
});

test("binary and too-large files are not compared", async (t) => {
  const repo = repository(t);
  repo.write("image.bin", Buffer.from([1, 2, 0, 3, 4]));
  repo.commit("binary");
  repo.write("image.bin", Buffer.from([1, 2, 0, 3, 4, 5, 6]));
  assert.deepEqual(await diff(repo, { kind: "changes" }, { path: "image.bin", status: "M" }), { kind: "binary", size: 7 });

  const size = DIFF_MAX_BYTES + 1024;
  repo.write("huge.txt", Buffer.alloc(size, "x"));
  assert.deepEqual(await diff(repo, { kind: "changes" }, { path: "huge.txt", status: "?" }), { kind: "too-large", bytes: size });
  repo.git("add", "huge.txt");
  assert.deepEqual(await diff(repo, { kind: "staged" }, { path: "huge.txt", status: "A" }), { kind: "too-large", bytes: size });
});

test("whitespace at the ends of lines is ignored unless asked to show it", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "x\ny\n");
  repo.commit("first");
  repo.write("a.txt", "x   \ny\n");
  const ignored = await diff(repo, { kind: "changes" }, { path: "a.txt", status: "M" });
  const shown = await diff(repo, { kind: "changes" }, { path: "a.txt", status: "M" }, { whitespace: "show" });
  assert.ok(ignored.kind === "diff" && shown.kind === "diff");
  if (ignored.kind !== "diff" || shown.kind !== "diff") return;
  assert.equal(ignored.changes.length, 0);
  assert.equal(shown.changes.length, 1);
});

test("CRLF files compare line by line", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "one\r\ntwo\r\n");
  repo.commit("first");
  repo.write("a.txt", "one\r\nTWO\r\n");
  const result = await diff(repo, { kind: "changes" }, { path: "a.txt", status: "M" });
  assert.ok(result.kind === "diff");
  if (result.kind !== "diff") return;
  assert.deepEqual(result.original, ["one", "two", ""]);
  assert.deepEqual(
    result.changes.map((change) => [change.original, change.modified]),
    [[[2, 3], [2, 3]]],
  );
});

test("with highlight, both sides come with one token line per line, and the language", async (t) => {
  const repo = repository(t);
  repo.write("app.ts", "// a comment\nconst a = 'x';\n");
  repo.commit("first");
  repo.write("app.ts", "// a comment\nconst a = 'y';\nlet b = 2;\n");
  const result = await diff(repo, { kind: "changes" }, { path: "app.ts", status: "M" }, { highlight: true });
  assert.equal(result.kind, "diff");
  if (result.kind !== "diff") return;
  assert.equal(result.language, "typescript");
  assert.ok(result.tokens);
  assert.equal(result.tokens.original.length, result.original.length);
  assert.equal(result.tokens.modified.length, result.modified.length);
  assert.ok(result.tokens.modified[0].length >= 2, "the comment line has a token");

  const plain = await diff(repo, { kind: "changes" }, { path: "app.ts", status: "M" });
  assert.ok(plain.kind === "diff" && plain.tokens === undefined && plain.language === undefined);

  repo.write("notes.unknownext", "text\n");
  const unknown = await diff(repo, { kind: "changes" }, { path: "notes.unknownext", status: "?" }, { highlight: true });
  assert.deepEqual(unknown, { kind: "file", lines: ["text", ""], truncated: false });
});
