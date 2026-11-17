// Interactive rebase for real: the plan, then reordering, dropping, squashing, fixing up, rewording, stopping at an
// edit and continuing, stopping on a conflict and aborting, and the refusals (stale plan, published commits, a
// protected branch, something under way). Each time, nothing of the plugin's is left in the git dir once no rebase is
// under way. Git for Windows' sh runs the sequence editor command on Windows runners.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, test } from "node:test";
import { operationControlRpc } from "../../shared/rpc/operation.ts";
import { rebasePlanRpc, rebaseStartRpc, type RebaseTodoItem } from "../../shared/rpc/rebase.ts";
import { repoStatusRpc } from "../../shared/rpc/repo.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { mergeConflict, published, repository, type Repo } from "../helpers/repo.ts";
import { commitsAdding, pluginFolderLeft, subjectsSince } from "../helpers/sequencer.ts";

const plugin = startPlugin();
after(() => plugin.stop());

/** A base commit and three commits after it, adding a.txt, b.txt and c.txt. */
function three(repo: Repo): { base: string; a: string; b: string; c: string } {
  repo.write("base.txt", "base\n");
  const base = repo.commit("base");
  const [a, b, c] = commitsAdding(repo, ["a", "b", "c"]);
  return { base, a, b, c };
}

const start = (repo: Repo, base: string, todo: RebaseTodoItem[], extra: { confirmPublished?: true; autostash?: boolean } = {}) =>
  plugin.call(rebaseStartRpc, { cwd: repo.cwd, base, todo, confirm: true, ...extra });

test("the plan lists the commits after the base, oldest first; a base that is not an ancestor is refused", async (t) => {
  const repo = repository(t);
  const { base, a, b, c } = three(repo);
  const plan = await plugin.call(rebasePlanRpc, { cwd: repo.cwd, base: "HEAD~3" });
  assert.equal(plan.base, base);
  assert.deepEqual(
    plan.commits.map((commit) => [commit.hash, commit.subject, commit.author, commit.pushed]),
    [
      [a, "a", "Test Author", false],
      [b, "b", "Test Author", false],
      [c, "c", "Test Author", false],
    ],
  );
  assert.deepEqual([plan.pushed, plan.merges, plan.truncated], [false, false, false]);
  assert.equal((await failure(plugin.call(rebasePlanRpc, { cwd: repo.cwd, base: "no-such-ref" }))).code, "REF_NOT_FOUND");
  repo.git("switch", "--quiet", "--create", "elsewhere", base);
  repo.write("e.txt", "e\n");
  const elsewhere = repo.commit("elsewhere");
  repo.git("switch", "--quiet", "main");
  assert.equal((await failure(plugin.call(rebasePlanRpc, { cwd: repo.cwd, base: elsewhere }))).code, "INVALID_ARGUMENT");
});

test("reorder, drop, squash and fixup", async (t) => {
  const reordered = repository(t);
  const one = three(reordered);
  assert.deepEqual(await start(reordered, one.base, [{ action: "pick", hash: one.c }, { action: "pick", hash: one.a }, { action: "pick", hash: one.b }]), { state: "done" });
  assert.deepEqual(subjectsSince(reordered, one.base), ["c", "a", "b"]);
  assert.equal(pluginFolderLeft(reordered), false);

  const dropped = repository(t);
  const two = three(dropped);
  await start(dropped, two.base, [{ action: "pick", hash: two.a }, { action: "drop", hash: two.b }, { action: "pick", hash: two.c }]);
  assert.deepEqual(subjectsSince(dropped, two.base), ["a", "c"]);
  assert.equal(existsSync(dropped.path("b.txt")), false);

  const squashed = repository(t);
  const sq = three(squashed);
  await start(squashed, sq.base, [{ action: "pick", hash: sq.a }, { action: "squash", hash: sq.b }, { action: "pick", hash: sq.c }]);
  assert.deepEqual(subjectsSince(squashed, sq.base), ["a", "c"]);
  const message = squashed.git("log", "-1", "--skip=1", "--format=%B");
  assert.match(message, /^a\n/);
  assert.match(message, /\nb$/);
  assert.equal(message.includes("#"), false);
  assert.equal(existsSync(squashed.path("b.txt")), true);

  const fixed = repository(t);
  const fx = three(fixed);
  await start(fixed, fx.base, [{ action: "pick", hash: fx.a }, { action: "fixup", hash: fx.b }, { action: "pick", hash: fx.c }]);
  assert.deepEqual(subjectsSince(fixed, fx.base), ["a", "c"]);
  assert.equal(fixed.git("log", "-1", "--skip=1", "--format=%B"), "a");
  assert.equal(pluginFolderLeft(fixed), false);
});

test("reword: a message with quotes, newlines, $ and non-ASCII letters is taken as it is", async (t) => {
  const repo = repository(t);
  const { base, a, b, c } = three(repo);
  const message = `Say "hi" and 'bye'\n\nÜnïcödé — 中文 $HOME \`not run\` \\ back\nlast line`;
  assert.deepEqual(await start(repo, base, [{ action: "pick", hash: a }, { action: "reword", hash: b, message }, { action: "pick", hash: c }]), { state: "done" });
  assert.deepEqual(subjectsSince(repo, base), ["a", `Say "hi" and 'bye'`, "c"]);
  assert.equal(repo.git("log", "-1", "--skip=1", "--format=%B"), message);
  assert.equal(repo.git("log", "-1", "--skip=1", "--format=%an"), "Test Author");
  assert.equal(pluginFolderLeft(repo), false);
});

test("edit stops the rebase; continuing it finishes, rewords after the stop included", async (t) => {
  const repo = repository(t);
  const { base, a, b, c } = three(repo);
  const state = await start(repo, base, [{ action: "edit", hash: a }, { action: "pick", hash: b }, { action: "reword", hash: c, message: "c, later" }]);
  assert.deepEqual(state, { state: "stopped" });
  const status = await plugin.call(repoStatusRpc, { cwd: repo.cwd });
  assert.equal(status.operation?.kind, "rebase");
  assert.equal(status.operation?.kind === "rebase" && status.operation.stoppedForEdit, true);
  assert.equal(pluginFolderLeft(repo), true); // the reword's message is still needed

  repo.write("a.txt", "a, edited\n");
  repo.git("add", "a.txt");
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "rebase", action: "continue" }), { conflicted: false, done: true });
  assert.deepEqual(subjectsSince(repo, base), ["a", "b", "c, later"]);
  assert.equal(repo.git("show", `${repo.git("rev-parse", "HEAD~2")}:a.txt`), "a, edited");
  assert.equal(pluginFolderLeft(repo), false);
});

test("a conflict stops the rebase; aborting it restores the branch", async (t) => {
  const repo = repository(t);
  repo.write("f.txt", "base\n");
  const base = repo.commit("base");
  repo.write("f.txt", "x\n");
  const x = repo.commit("x");
  repo.write("f.txt", "y\n");
  const y = repo.commit("y");
  assert.deepEqual(await start(repo, base, [{ action: "pick", hash: y }, { action: "pick", hash: x }]), { state: "conflict" });
  assert.equal(pluginFolderLeft(repo), true);
  assert.deepEqual(await plugin.call(operationControlRpc, { cwd: repo.cwd, operation: "rebase", action: "abort", confirm: true }), { conflicted: false, done: true });
  assert.equal(repo.head(), y);
  assert.equal(repo.git("symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(pluginFolderLeft(repo), false);
});

test("a plan that no longer matches the branch is STALE_STATE; a plan that changes nothing is done", async (t) => {
  const repo = repository(t);
  const { base, a, b, c } = three(repo);
  const before = repo.head();
  assert.deepEqual(await start(repo, base, [{ action: "pick", hash: a }, { action: "pick", hash: b }, { action: "pick", hash: c }]), { state: "done" });
  assert.equal(repo.head(), before);
  commitsAdding(repo, ["d"]);
  const stale = await failure(start(repo, base, [{ action: "pick", hash: c }, { action: "pick", hash: a }, { action: "pick", hash: b }]));
  assert.equal(stale.code, "STALE_STATE");
  const missing = await failure(start(repo, base, [{ action: "pick", hash: a }]));
  assert.equal(missing.code, "STALE_STATE");
  const unconfirmed = await failure(plugin.call(rebaseStartRpc, { cwd: repo.cwd, base, todo: [{ action: "pick", hash: a }] } as never));
  assert.equal(unconfirmed.code, "CONFIRMATION_REQUIRED");
  assert.equal(pluginFolderLeft(repo), false);
});

test("rewriting pushed commits needs confirmPublished, and is refused on a protected branch", async (t) => {
  const { repo } = published(t);
  const root = repo.head();
  const [a, b] = commitsAdding(repo, ["p", "q"]);
  repo.git("push", "--quiet", "origin", "main");
  const plan = await plugin.call(rebasePlanRpc, { cwd: repo.cwd, base: root });
  assert.equal(plan.pushed, true);
  const reorder: RebaseTodoItem[] = [
    { action: "pick", hash: b },
    { action: "pick", hash: a },
  ];
  // main is protected by default.
  assert.equal((await failure(start(repo, root, reorder, { confirmPublished: true }))).code, "PROTECTED_BRANCH");

  repo.git("switch", "--quiet", "--create", "feature");
  const [f, g] = commitsAdding(repo, ["f", "g"]);
  repo.git("push", "--quiet", "--set-upstream", "origin", "feature");
  const swap: RebaseTodoItem[] = [
    { action: "pick", hash: g },
    { action: "pick", hash: f },
  ];
  assert.equal((await failure(start(repo, b, swap))).code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(await start(repo, b, swap, { confirmPublished: true }), { state: "done" });
  assert.deepEqual(subjectsSince(repo, b), ["g", "f"]);
  assert.equal(pluginFolderLeft(repo), false);
});

test("a rebase is refused while something else is under way; autostash carries local changes across", async (t) => {
  const repo = repository(t);
  mergeConflict(repo);
  const head = repo.head();
  const busy = await failure(start(repo, `${head}~1`, [{ action: "pick", hash: head }]));
  assert.equal(busy.code, "OPERATION_IN_PROGRESS");

  const dirty = repository(t);
  const { base, a, b, c } = three(dirty);
  dirty.write("a.txt", "local change\n");
  const refused = await failure(start(dirty, base, [{ action: "pick", hash: b }, { action: "pick", hash: a }, { action: "pick", hash: c }]));
  assert.ok(refused.code === "WOULD_OVERWRITE_CHANGES" || refused.code === "UNKNOWN", refused.code);
  assert.equal(pluginFolderLeft(dirty), false);
  assert.deepEqual(await start(dirty, base, [{ action: "pick", hash: b }, { action: "pick", hash: a }, { action: "pick", hash: c }], { autostash: true }), { state: "done" });
  assert.deepEqual(subjectsSince(dirty, base), ["b", "a", "c"]);
  assert.equal(dirty.read("a.txt").replace(/\r\n/g, "\n"), "local change\n");
});
