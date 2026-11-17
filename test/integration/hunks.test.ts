// Hunks against real git: reading them, and staging, unstaging and discarding them whole or line by line, with CRLF
// files, files without a final newline, untracked files, binary files, a staged rename, and stale ids.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { changesApplyHunksRpc, changesHunksRpc } from "../../shared/rpc/changes.ts";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { safetySnapshotsRpc } from "../../shared/rpc/safety.ts";
import type { FileChange, Hunk } from "../../shared/schemas.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { lf, repository, type Repo } from "../helpers/repo.ts";
import { blobBytes, indexText } from "../helpers/sequencer.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const read = (repo: Repo, file: FileChange, staged = false) => plugin.call(changesHunksRpc, { cwd: repo.cwd, file, staged });

/** The index of the first line of `hunk` with this kind and text. */
function lineOf(hunk: Hunk, kind: "add" | "delete", text: string): number {
  const index = hunk.lines.findIndex((line) => line.kind === kind && line.text === text);
  assert.notEqual(index, -1, `${kind} ${text}`);
  return index;
}

const numbered = (count: number) => Array.from({ length: count }, (_, n) => `line ${n + 1}`);

test("two hunks: ids hold between reads; staging one stages only it; unstaging and discarding go back", async (t) => {
  const repo = repository(t);
  const lines = numbered(20);
  repo.write("f.txt", `${lines.join("\n")}\n`);
  repo.commit("first");
  const changed = [...lines];
  changed[1] = "LINE 2";
  changed[17] = "LINE 18";
  repo.write("f.txt", `${changed.join("\n")}\n`);
  const file = { path: "f.txt", status: "M" };

  const first = await read(repo, file);
  assert.equal(first.hunks.length, 2);
  assert.equal(first.binary, false);
  assert.equal(first.truncated, false);
  assert.deepEqual(
    (await read(repo, file)).hunks.map((hunk) => hunk.id),
    first.hunks.map((hunk) => hunk.id),
  );
  assert.equal(first.hunks[0].lines[lineOf(first.hunks[0], "add", "LINE 2")].newLine, 2);

  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "f.txt", action: "stage", hunks: [{ id: first.hunks[0].id }] });
  const staged = indexText(repo, "f.txt");
  assert.match(staged, /^line 1\nLINE 2\n/);
  assert.match(staged, /\nline 18\n/);
  assert.equal((await read(repo, file, true)).hunks.length, 1);
  const rest = await read(repo, file);
  assert.equal(rest.hunks.length, 1);
  assert.equal(rest.hunks[0].id, first.hunks[1].id); // untouched, and nothing above it moved: the same id

  // The first hunk is gone from the unstaged diff: its id is stale now.
  const stale = await failure(plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "f.txt", action: "stage", hunks: [{ id: first.hunks[0].id }] }));
  assert.equal(stale.code, "STALE_STATE");

  const stagedHunks = await read(repo, file, true);
  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "f.txt", action: "unstage", hunks: [{ id: stagedHunks.hunks[0].id }] });
  assert.equal(repo.tryGit("diff", "--cached", "--quiet"), true);

  // Discarding needs confirm, takes a safety snapshot, and throws away only the hunk named.
  const both = await read(repo, file);
  const late = both.hunks.find((hunk) => hunk.lines.some((line) => line.text === "LINE 18"));
  assert.ok(late);
  const unconfirmed = await failure(plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "f.txt", action: "discard", hunks: [{ id: late.id }] } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "f.txt", action: "discard", hunks: [{ id: late.id }], confirm: true });
  const now = lf(repo.read("f.txt"));
  assert.match(now, /\nLINE 2\n/);
  assert.match(now, /\nline 18\n/);
  const { snapshots } = await plugin.call(safetySnapshotsRpc, { cwd: repo.cwd });
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].reason, "git.changes.apply-hunks");
});

test("lines of a hunk: an unchosen delete stays, an unchosen add is left out, in each direction", async (t) => {
  const repo = repository(t);
  repo.write("f.txt", "a\nb\nc\n");
  repo.commit("first");
  repo.write("f.txt", "a\nB\nc\nd\n");
  const file = { path: "f.txt", status: "M" };
  const [hunk] = (await read(repo, file)).hunks;
  // Only the added last line.
  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "f.txt", action: "stage", hunks: [{ id: hunk.id, lines: [lineOf(hunk, "add", "d")] }] });
  assert.equal(indexText(repo, "f.txt"), "a\nb\nc\nd\n");
  // Then -b and +B, from what is left.
  const [left] = (await read(repo, file)).hunks;
  await plugin.call(changesApplyHunksRpc, {
    cwd: repo.cwd,
    path: "f.txt",
    action: "stage",
    hunks: [{ id: left.id, lines: [lineOf(left, "delete", "b"), lineOf(left, "add", "B")] }],
  });
  assert.equal(indexText(repo, "f.txt"), "a\nB\nc\nd\n");
  assert.equal((await read(repo, file)).hunks.length, 0);
  // Unstage only the added d: B stays staged.
  const [staged] = (await read(repo, file, true)).hunks;
  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "f.txt", action: "unstage", hunks: [{ id: staged.id, lines: [lineOf(staged, "add", "d")] }] });
  assert.equal(indexText(repo, "f.txt"), "a\nB\nc\n");
  // Discard only the d left in the work tree.
  const [unstaged] = (await read(repo, file)).hunks;
  await plugin.call(changesApplyHunksRpc, {
    cwd: repo.cwd,
    path: "f.txt",
    action: "discard",
    hunks: [{ id: unstaged.id, lines: [lineOf(unstaged, "add", "d")] }],
    confirm: true,
  });
  assert.equal(lf(repo.read("f.txt")), "a\nB\nc\n");
  // A selection of nothing but context changes nothing.
  repo.write("f.txt", "a\nB\nc\ne\n");
  const [plain] = (await read(repo, file)).hunks;
  const contextOnly = plain.lines.findIndex((line) => line.kind === "context");
  const nothing = await failure(plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "f.txt", action: "stage", hunks: [{ id: plain.id, lines: [contextOnly] }] }));
  assert.equal(nothing.code, "INVALID_ARGUMENT");
});

test("CRLF lines go to the index byte for byte, and the client sees them without the CR", async (t) => {
  const repo = repository(t);
  repo.write("w.txt", "a\r\nb\r\nc\r\n");
  repo.commit("first");
  repo.write("w.txt", "a\r\nB\r\nc\r\nd\r\n");
  const [hunk] = (await read(repo, { path: "w.txt", status: "M" })).hunks;
  assert.equal(hunk.lines.some((line) => line.text.endsWith("\r")), false);
  await plugin.call(changesApplyHunksRpc, {
    cwd: repo.cwd,
    path: "w.txt",
    action: "stage",
    hunks: [{ id: hunk.id, lines: [lineOf(hunk, "delete", "b"), lineOf(hunk, "add", "B")] }],
  });
  assert.deepEqual(blobBytes(repo, ":w.txt"), Buffer.from("a\r\nB\r\nc\r\n"));
});

test("a file without a final newline: the marker is read, and a partial stage keeps the file whole", async (t) => {
  const repo = repository(t);
  repo.write("n.txt", "a\nb");
  repo.commit("first");
  repo.write("n.txt", "a\nb\nc");
  const [hunk] = (await read(repo, { path: "n.txt", status: "M" })).hunks;
  assert.equal(hunk.lines[lineOf(hunk, "delete", "b")].noNewline, true);
  assert.equal(hunk.lines[lineOf(hunk, "add", "c")].noNewline, true);
  // -b and +b only: the line gains its break, c stays out.
  await plugin.call(changesApplyHunksRpc, {
    cwd: repo.cwd,
    path: "n.txt",
    action: "stage",
    hunks: [{ id: hunk.id, lines: [lineOf(hunk, "delete", "b"), lineOf(hunk, "add", "b")] }],
  });
  assert.deepEqual(blobBytes(repo, ":n.txt"), Buffer.from("a\nb\n"));
  // Then only c: the rest.
  const [rest] = (await read(repo, { path: "n.txt", status: "M" })).hunks;
  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "n.txt", action: "stage", hunks: [{ id: rest.id, lines: [lineOf(rest, "add", "c")] }] });
  assert.deepEqual(blobBytes(repo, ":n.txt"), Buffer.from("a\nb\nc"));
});

test("an untracked file is one hunk; staging part of it adds just those lines, staging all of it adds the file", async (t) => {
  const repo = repository(t);
  repo.write("base.txt", "base\n");
  repo.commit("first");
  repo.write("u.txt", "one\ntwo\nthree\n");
  const untracked = { path: "u.txt", status: "?" };
  const { hunks } = await read(repo, untracked);
  assert.equal(hunks.length, 1);
  assert.deepEqual(
    hunks[0].lines.map((line) => [line.kind, line.text, line.newLine]),
    [
      ["add", "one", 1],
      ["add", "two", 2],
      ["add", "three", 3],
    ],
  );
  assert.equal(hunks[0].header, "@@ -0,0 +1,3 @@");
  const refused = await failure(plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "u.txt", action: "discard", hunks: [{ id: hunks[0].id }], confirm: true }));
  assert.equal(refused.code, "INVALID_ARGUMENT");
  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "u.txt", action: "stage", hunks: [{ id: hunks[0].id, lines: [0, 2] }] });
  assert.equal(indexText(repo, "u.txt"), "one\nthree\n");
  const status = await plugin.call(repoStatusRpc, { cwd: repo.cwd });
  assert.deepEqual(status.staged, [{ path: "u.txt", status: "A" }]);
  // The rest, now a tracked file's hunk.
  const [rest] = (await read(repo, { path: "u.txt", status: "M" })).hunks;
  assert.deepEqual(
    rest.lines.filter((line) => line.kind !== "context").map((line) => `${line.kind} ${line.text}`),
    ["add two"],
  );

  repo.write("whole.txt", "x\ny\n");
  const whole = await read(repo, { path: "whole.txt", status: "?" });
  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "whole.txt", action: "stage", hunks: [{ id: whole.hunks[0].id }] });
  assert.equal(indexText(repo, "whole.txt"), "x\ny\n");

  // An id that is not the file's: refused, and the file is not left half added.
  repo.write("other.txt", "p\nq\n");
  const stale = await failure(plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "other.txt", action: "stage", hunks: [{ id: "0".repeat(40) }] }));
  assert.equal(stale.code, "STALE_STATE");
  assert.equal(repo.git("ls-files", "--", "other.txt"), "");
});

test("a binary file has no hunks, tracked or not", async (t) => {
  const repo = repository(t);
  repo.write("b.bin", Buffer.from([0, 1, 2, 3, 0, 5]));
  repo.commit("first");
  repo.write("b.bin", Buffer.from([0, 1, 2, 4, 0, 5, 6]));
  assert.deepEqual(await read(repo, { path: "b.bin", status: "M" }), { hunks: [], binary: true, truncated: false });
  repo.write("new.bin", Buffer.from([7, 0, 7]));
  assert.deepEqual(await read(repo, { path: "new.bin", status: "?" }), { hunks: [], binary: true, truncated: false });
});

test("a staged rename's hunks are read with both its paths, and a path with spaces and non-ASCII letters works", async (t) => {
  const repo = repository(t);
  const lines = numbered(10);
  repo.write("old name.txt", `${lines.join("\n")}\n`);
  repo.write("ünï cödé.txt", "x\ny\n");
  repo.commit("first");
  repo.git("mv", "old name.txt", "new name.txt");
  const changed = [...lines];
  changed[4] = "LINE 5";
  repo.write("new name.txt", `${changed.join("\n")}\n`);
  repo.git("add", "new name.txt");
  const renamed = await read(repo, { path: "new name.txt", from: "old name.txt", status: "R" }, true);
  assert.equal(renamed.hunks.length, 1);
  assert.ok(renamed.hunks[0].lines.some((line) => line.kind === "add" && line.text === "LINE 5"));

  repo.write("ünï cödé.txt", "x\nY\n");
  const [hunk] = (await read(repo, { path: "ünï cödé.txt", status: "M" })).hunks;
  await plugin.call(changesApplyHunksRpc, { cwd: repo.cwd, path: "ünï cödé.txt", action: "stage", hunks: [{ id: hunk.id }] });
  assert.equal(indexText(repo, "ünï cödé.txt"), "x\nY\n");
});
