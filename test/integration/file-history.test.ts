// git.history.file against real git: a file's commits across a rename (with and without following it), paging, a
// starting revision, and the refusals.

import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { after, test } from "node:test";
import { historyFileRpc } from "../../shared/rpc/history.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { repository, type Repo } from "../helpers/repo.ts";
import { commitAs } from "../helpers/trees.ts";

const plugin = startPlugin();
after(() => plugin.stop());

const OLD = "old name.txt";
const NEW = "dir/新しい name.txt";
const text = (changed: string) => ["one", "two", "three", "four", "five", "six", "seven", "eight", changed, "ten", ""].join("\n");

/** A file added, edited, renamed (only renamed) and edited again, by two people, a day apart; and another file. */
function history(t: Parameters<typeof repository>[0]): { repo: Repo; hashes: string[] } {
  const repo = repository(t);
  const added = commitAs(repo, "Ada", "add it", { [OLD]: text("nine"), "other.txt": "x\n" }, 1_700_000_000);
  const edited = commitAs(repo, "Bob", "edit it", { [OLD]: text("NINE") }, 1_700_086_400);
  commitAs(repo, "Ada", "unrelated", { "other.txt": "y\n" }, 1_700_172_800);
  mkdirSync(repo.path("dir")); // git mv does not make the folder
  repo.git("mv", OLD, NEW);
  const renamed = commitAs(repo, "Ada", "move it", {}, 1_700_259_200);
  const again = commitAs(repo, "Bob", "edit it again", { [NEW]: text("Nine") }, 1_700_345_600);
  return { repo, hashes: [again, renamed, edited, added] };
}

test("with follow: every commit of the file, across the rename, each with the path it had", async (t) => {
  const { repo, hashes } = history(t);
  const { commits, more } = await plugin.call(historyFileRpc, { cwd: repo.cwd, path: NEW, limit: 50 });
  assert.equal(more, false);
  assert.deepEqual(
    commits.map((commit) => [commit.hash, commit.status, commit.path, commit.author, commit.subject]),
    [
      [hashes[0], "M", NEW, "Bob", "edit it again"],
      [hashes[1], "R", NEW, "Ada", "move it"],
      [hashes[2], "M", OLD, "Bob", "edit it"],
      [hashes[3], "A", OLD, "Ada", "add it"],
    ],
  );
  assert.equal(commits[0].time, 1_700_345_600);
  assert.deepEqual(commits[0].refs, [{ kind: "head", name: "main" }]);
  assert.equal(commits[1].parents.length, 1);
});

test("without follow: the history stops at the rename, which adds the file", async (t) => {
  const { repo, hashes } = history(t);
  const { commits } = await plugin.call(historyFileRpc, { cwd: repo.cwd, path: NEW, limit: 50, follow: false });
  assert.deepEqual(
    commits.map((commit) => [commit.hash, commit.status, commit.path]),
    [
      [hashes[0], "M", NEW],
      [hashes[1], "A", NEW],
    ],
  );
});

test("paging with limit, skip and more; from an older revision", async (t) => {
  const { repo, hashes } = history(t);
  const first = await plugin.call(historyFileRpc, { cwd: repo.cwd, path: NEW, limit: 2 });
  assert.deepEqual(
    first.commits.map((commit) => commit.hash),
    hashes.slice(0, 2),
  );
  assert.equal(first.more, true);
  const rest = await plugin.call(historyFileRpc, { cwd: repo.cwd, path: NEW, limit: 2, skip: 2 });
  assert.deepEqual(
    rest.commits.map((commit) => commit.hash),
    hashes.slice(2),
  );
  assert.equal(rest.more, false);

  const older = await plugin.call(historyFileRpc, { cwd: repo.cwd, path: OLD, limit: 50, rev: "HEAD~2" });
  assert.deepEqual(
    older.commits.map((commit) => commit.hash),
    hashes.slice(2),
  );
});

test("refusals, and a repository with no commit yet", async (t) => {
  const { repo } = history(t);
  assert.equal((await failure(plugin.call(historyFileRpc, { cwd: repo.cwd, path: NEW, limit: 5, rev: "no-such-rev" }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(historyFileRpc, { cwd: repo.cwd, path: NEW, limit: 5, rev: "--output=x" }))).code, "INVALID_ARGUMENT");
  assert.equal((await failure(plugin.call(historyFileRpc, { cwd: repo.cwd, path: "../outside.txt", limit: 5 }))).code, "INVALID_ARGUMENT");
  assert.deepEqual(await plugin.call(historyFileRpc, { cwd: repo.cwd, path: "never-there.txt", limit: 5 }), { commits: [], more: false });

  const empty = repository(t);
  assert.deepEqual(await plugin.call(historyFileRpc, { cwd: empty.cwd, path: "a.txt", limit: 5 }), { commits: [], more: false });
});
