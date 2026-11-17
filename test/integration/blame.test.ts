// git.history.blame against real git: a file two people wrote, its uncommitted lines, an older revision, a renamed
// file, the cut at BLAME_MAX_LINES, and the refusals (missing, untracked, binary, folder).

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, test } from "node:test";
import { BLAME_MAX_LINES } from "../../shared/limits.ts";
import { historyBlameRpc } from "../../shared/rpc/history.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { repository, type Repo } from "../helpers/repo.ts";
import { commitAs } from "../helpers/trees.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const ZERO = "0".repeat(40);
const FILE = "src/ファイル name.txt";

/** FILE written by Ada (three lines), then its second line changed by Bob. */
function written(t: Parameters<typeof repository>[0]): { repo: Repo; ada: string; bob: string } {
  const repo = repository(t);
  const ada = commitAs(repo, "Ada", "ada: write it", { [FILE]: "alpha\nbeta\ngamma\n" }, 1_700_000_000);
  const bob = commitAs(repo, "Bob", "bob: change beta", { [FILE]: "alpha\nBETA\ngamma\n" }, 1_700_086_400);
  return { repo, ada, bob };
}

test("each line's commit, from two people; uncommitted lines carry the all-zero hash", async (t) => {
  const { repo, ada, bob } = written(t);
  repo.write(FILE, "alpha\nBETA\ngamma, edited\n");
  const blame = await plugin.call(historyBlameRpc, { cwd: repo.cwd, path: FILE });
  assert.deepEqual(blame.text, ["alpha", "BETA", "gamma, edited"]);
  assert.deepEqual(blame.lines, [
    { line: 1, hash: ada, originalLine: 1 },
    { line: 2, hash: bob, originalLine: 2 },
    { line: 3, hash: ZERO, originalLine: 3 },
  ]);
  assert.deepEqual(blame.commits[ada], { author: "Ada", email: "ada@example.com", time: 1_700_000_000, subject: "ada: write it", path: FILE });
  assert.deepEqual(blame.commits[bob], { author: "Bob", email: "bob@example.com", time: 1_700_086_400, subject: "bob: change beta", path: FILE });
  assert.equal(blame.commits[ZERO].author, "Not Committed Yet");
  assert.equal(blame.truncated, false);
});

test("at an older revision; a path that revision does not have", async (t) => {
  const { repo, ada } = written(t);
  const blame = await plugin.call(historyBlameRpc, { cwd: repo.cwd, path: FILE, rev: "HEAD~1" });
  assert.deepEqual(blame.text, ["alpha", "beta", "gamma"]);
  assert.deepEqual(
    blame.lines.map((line) => line.hash),
    [ada, ada, ada],
  );
  assert.deepEqual(Object.keys(blame.commits), [ada]);

  commitAs(repo, "Ada", "add later", { "later.txt": "later\n" });
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "later.txt", rev: "HEAD~1" }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: FILE, rev: "no-such-rev" }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "src", rev: "HEAD" }))).code, "INVALID_ARGUMENT");
});

test("a renamed file: lines from before the rename name the old path", async (t) => {
  const { repo, ada } = written(t);
  mkdirSync(repo.path("moved"));
  repo.git("mv", FILE, "moved/new.txt");
  commitAs(repo, "Ada", "move it", {});
  const blame = await plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "moved/new.txt" });
  assert.equal(blame.lines[0].hash, ada);
  assert.equal(blame.commits[ada].path, FILE);
});

test("cut at BLAME_MAX_LINES", async (t) => {
  const repo = repository(t);
  const lines = Array.from({ length: BLAME_MAX_LINES + 5 }, (_, n) => `line ${n + 1}`);
  commitAs(repo, "Ada", "long", { "long.txt": lines.join("\n") + "\n" });
  const blame = await plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "long.txt" });
  assert.equal(blame.truncated, true);
  assert.equal(blame.lines.length, BLAME_MAX_LINES);
  assert.equal(blame.text.length, BLAME_MAX_LINES);
  assert.equal(blame.text[BLAME_MAX_LINES - 1], `line ${BLAME_MAX_LINES}`);
  assert.equal(blame.lines[BLAME_MAX_LINES - 1].line, BLAME_MAX_LINES);

  commitAs(repo, "Ada", "exact", { "exact.txt": lines.slice(0, BLAME_MAX_LINES).join("\n") + "\n" });
  const exact = await plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "exact.txt" });
  assert.deepEqual([exact.truncated, exact.lines.length], [false, BLAME_MAX_LINES]);
});

test("refusals: missing, untracked, binary, a folder; an empty file has no lines", async (t) => {
  const { repo } = written(t);
  commitAs(repo, "Ada", "more files", { "bin.dat": Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x0a, 0x00, 0x02]).toString("latin1"), "empty.txt": "" });
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "missing.txt" }))).code, "REF_NOT_FOUND");
  repo.write("untracked.txt", "new\n");
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "untracked.txt" }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "bin.dat" }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "bin.dat", rev: "HEAD" }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "src" }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "../outside.txt" }))).code, "INVALID_ARGUMENT");
  assert.deepEqual(await plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "empty.txt" }), { lines: [], commits: {}, text: [], truncated: false });
  assert.deepEqual(await plugin.call(historyBlameRpc, { cwd: repo.cwd, path: "empty.txt", rev: "HEAD" }), { lines: [], commits: {}, text: [], truncated: false });
});
