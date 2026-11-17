// The graph's search and filters, field by field, paging, scopes; a commit's details; two revisions compared.

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { historyCompareRpc, historyLogRpc, historyShowRpc, type LogFilter } from "../../shared/rpc/history.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { dates, gitIn, repository, type Repo } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

// One history for every filter test: five commits by two authors, a day apart, touching different files.
// Built once, at load time; removed when the file's tests are done.
const fileScope = { after: (fn: () => void) => after(fn) } as unknown as Parameters<typeof repository>[0];
const repo: Repo = repository(fileScope);
const hashes: Record<string, string> = {};
const DAY = 86_400;

{
  const commit = (name: string, author: string, file: string, text: string, day: number, message: string) => {
    repo.write(file, text);
    repo.git("add", "--all");
    gitIn(repo.cwd, ["commit", "--quiet", `--message=${message}`], { ...dates(1_700_000_000 + day * DAY), GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com` });
    hashes[name] = repo.head();
  };
  commit("one", "Ada", "src/app.ts", "const value = 1;\n", 0, "feat: start the App");
  commit("two", "Bob", "docs/guide.md", "# Guide\n", 1, "docs: write the guide");
  commit("three", "Ada", "src/app.ts", "const value = 2;\nconst needle = true;\n", 2, "fix: Needle in the app (#12)");
  commit("four", "Bob", "src/util.ts", "export {};\n", 3, "chore: add util");
  repo.git("switch", "--quiet", "--create", "side");
  commit("five", "Bob", "side.txt", "side\n", 4, "side: work [wip]");
  repo.git("switch", "--quiet", "main");
  gitIn(repo.cwd, ["merge", "--quiet", "--no-ff", "--message=merge side", "side"], dates(1_700_000_000 + 5 * DAY));
  hashes.merge = repo.head();
}

const subjects = async (filter: LogFilter, extra: { limit?: number; skip?: number } = {}) => {
  const log = await plugin.call(historyLogRpc, { cwd: repo.cwd, scope: "all", limit: extra.limit ?? 50, skip: extra.skip, filter });
  return log.commits.map((commit) => commit.subject);
};

test("message: fixed strings, case-insensitive unless asked, or a regular expression", async () => {
  assert.deepEqual(await subjects({ text: "needle", field: "message" }), ["fix: Needle in the app (#12)"]);
  assert.deepEqual(await subjects({ text: "needle", field: "message", caseSensitive: true }), []);
  assert.deepEqual(await subjects({ text: "[wip]", field: "message" }), ["side: work [wip]"]); // a bracket is a bracket
  assert.deepEqual(await subjects({ text: "^(feat|fix):", field: "message", regex: true }), ["fix: Needle in the app (#12)", "feat: start the App"]);
});

test("author, by name or email, alone or beside a text", async () => {
  assert.deepEqual(await subjects({ text: "bob@example.com", field: "author", noMerges: true }), ["side: work [wip]", "chore: add util", "docs: write the guide"]);
  assert.deepEqual(await subjects({ text: "the", field: "message", author: "ada" }), ["fix: Needle in the app (#12)", "feat: start the App"]);
  assert.deepEqual(await subjects({ text: "guide", field: "message", author: "ada" }), []);
});

test("hash: a commit whose hash starts with the text", async () => {
  const prefix = hashes.three.slice(0, 7).toUpperCase();
  assert.deepEqual(await subjects({ text: prefix, field: "hash" }), ["fix: Needle in the app (#12)"]);
  assert.equal((await failure(plugin.call(historyLogRpc, { cwd: repo.cwd, scope: "all", limit: 5, filter: { text: "not-hex", field: "hash" } }))).code, "INVALID_ARGUMENT");
});

test("path: commits that touch paths holding the text; and a path filter of its own", async () => {
  assert.deepEqual(await subjects({ text: "APP", field: "path" }), ["fix: Needle in the app (#12)", "feat: start the App"]);
  assert.deepEqual(await subjects({ path: "docs" }), ["docs: write the guide"]);
  assert.deepEqual(await subjects({ path: "src/util.ts" }), ["chore: add util"]);
});

test("content: commits whose diff adds or removes a matching line", async () => {
  assert.deepEqual(await subjects({ text: "NEEDLE = true", field: "content" }), ["fix: Needle in the app (#12)"]);
  assert.deepEqual(await subjects({ text: "value = [0-9]", field: "content", regex: true }), ["fix: Needle in the app (#12)", "feat: start the App"]);
});

test("since, until and no merges", async () => {
  assert.deepEqual(await subjects({ since: 1_700_000_000 + 3 * DAY, noMerges: true }), ["side: work [wip]", "chore: add util"]);
  assert.deepEqual(await subjects({ until: 1_700_000_000 + DAY }), ["docs: write the guide", "feat: start the App"]);
});

test("paging: limit, skip and more", async () => {
  const first = await plugin.call(historyLogRpc, { cwd: repo.cwd, scope: "all", limit: 2 });
  assert.equal(first.commits.length, 2);
  assert.equal(first.more, true);
  const rest = await plugin.call(historyLogRpc, { cwd: repo.cwd, scope: "all", limit: 50, skip: 2 });
  assert.equal(rest.more, false);
  assert.equal(first.commits.length + rest.commits.length, 6);
  assert.equal(new Set([...first.commits, ...rest.commits].map((commit) => commit.hash)).size, 6);
});

test("scope: the refs named", async () => {
  const log = await plugin.call(historyLogRpc, { cwd: repo.cwd, scope: { refs: [hashes.two] }, limit: 50 });
  assert.deepEqual(
    log.commits.map((commit) => commit.subject),
    ["docs: write the guide", "feat: start the App"],
  );
  assert.equal((await failure(plugin.call(historyLogRpc, { cwd: repo.cwd, scope: { refs: ["no-such-branch"] }, limit: 5 }))).code, "REF_NOT_FOUND");
  assert.equal((await failure(plugin.call(historyLogRpc, { cwd: repo.cwd, scope: { refs: ["--output=x"] }, limit: 5 }))).code, "INVALID_ARGUMENT");
});

test("show: both people, the message, the files with their counts", async () => {
  const detail = await plugin.call(historyShowRpc, { cwd: repo.cwd, hash: hashes.three });
  assert.equal(detail.subject, "fix: Needle in the app (#12)");
  assert.equal(detail.author.name, "Ada");
  assert.equal(detail.author.email, "ada@example.com");
  assert.equal(detail.author.time, 1_700_000_000 + 2 * DAY);
  assert.equal(detail.committer.name, "Test Committer");
  assert.deepEqual(detail.parents, [hashes.two]);
  assert.deepEqual(detail.files, [{ path: "src/app.ts", status: "M", additions: 2, deletions: 1 }]);
  assert.deepEqual(detail.stats, { files: 1, insertions: 2, deletions: 1 });
  assert.equal(detail.filesTruncated, false);
  assert.equal(detail.signature, undefined);
  assert.equal((await failure(plugin.call(historyShowRpc, { cwd: repo.cwd, hash: "f".repeat(40) }))).code, "REF_NOT_FOUND");
});

test("compare: the files between two revisions, and how far apart they are", async () => {
  const comparison = await plugin.call(historyCompareRpc, { cwd: repo.cwd, from: "side", to: "main~1" });
  assert.equal(comparison.from, hashes.five);
  assert.equal(comparison.to, hashes.four);
  assert.deepEqual([comparison.ahead, comparison.behind], [0, 1]);
  assert.deepEqual(comparison.files, [{ path: "side.txt", status: "D", additions: 0, deletions: 1 }]);
  assert.equal(comparison.truncated, false);
  assert.equal((await failure(plugin.call(historyCompareRpc, { cwd: repo.cwd, from: "nope", to: "main" }))).code, "REF_NOT_FOUND");
});
