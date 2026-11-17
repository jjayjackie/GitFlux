// Commits: amend (and amending what was pushed), signoff, an empty commit refused or allowed, a missing identity and a
// hook that refuses, each with its code.

import assert from "node:assert/strict";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { commitCreateRpc } from "../../shared/rpc/commit.ts";
import { withEnv } from "../helpers/env.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { published, repository } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());

test("signoff adds the committer's trailer, and an empty commit needs allowEmpty", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.git("add", "a.txt");
  const { hash } = await plugin.call(commitCreateRpc, { cwd: repo.cwd, message: "signed", amend: false, all: false, signoff: true });
  assert.equal(hash, repo.head());
  assert.match(repo.git("log", "-1", "--format=%B"), /Signed-off-by: Test Committer <committer@example\.com>/);

  assert.equal((await failure(plugin.call(commitCreateRpc, { cwd: repo.cwd, message: "empty", amend: false, all: false }))).code, "NOTHING_TO_COMMIT");
  const empty = await plugin.call(commitCreateRpc, { cwd: repo.cwd, message: "empty", amend: false, all: false, allowEmpty: true });
  assert.equal(repo.git("rev-parse", "HEAD^"), hash);
  assert.equal(empty.hash, repo.head());
});

test("a long message goes whole, newlines and all", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.git("add", "a.txt");
  const message = `subject\n\n${Array.from({ length: 3000 }, () => "long line of body text").join(" ")}\n- a list\n- of things`;
  await plugin.call(commitCreateRpc, { cwd: repo.cwd, message, amend: false, all: false });
  assert.equal(repo.git("log", "-1", "--format=%B"), message.trim());
});

test("amending a commit that is already on a remote needs confirmAmendPushed", async (t) => {
  const { repo } = published(t);
  const pushed = repo.head();
  const { code } = await failure(plugin.call(commitCreateRpc, { cwd: repo.cwd, message: "reworded", amend: true, all: false }));
  assert.equal(code, "CONFIRMATION_REQUIRED");
  assert.equal(repo.head(), pushed);
  await plugin.call(commitCreateRpc, { cwd: repo.cwd, message: "reworded", amend: true, all: false, confirmAmendPushed: true });
  assert.notEqual(repo.head(), pushed);
  assert.equal(repo.git("log", "-1", "--format=%s"), "reworded");

  // A commit not pushed yet is amended without asking.
  repo.write("b.txt", "b\n");
  repo.commit("local");
  await plugin.call(commitCreateRpc, { cwd: repo.cwd, message: "local, reworded", amend: true, all: false });
  assert.equal(repo.git("log", "-1", "--format=%s"), "local, reworded");
});

test("without an identity git is told of, the commit fails with IDENTITY_MISSING", async (t) => {
  const repo = repository(t);
  repo.write("a.txt", "a\n");
  repo.git("add", "a.txt");
  const anonymous = { GIT_AUTHOR_NAME: undefined, GIT_AUTHOR_EMAIL: undefined, GIT_COMMITTER_NAME: undefined, GIT_COMMITTER_EMAIL: undefined, EMAIL: undefined };
  const { code } = await withEnv(anonymous, () => failure(plugin.call(commitCreateRpc, { cwd: repo.cwd, message: "who?", amend: false, all: false })));
  assert.equal(code, "IDENTITY_MISSING");
});

test("a pre-commit hook that refuses fails the commit with HOOK_FAILED, and hooks are never skipped", async (t) => {
  const repo = repository(t);
  const hook = join(repo.cwd, ".git", "hooks", "pre-commit");
  repo.write(".git/hooks/pre-commit", "#!/bin/sh\necho 'lint failed: fix the code' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  repo.write("a.txt", "a\n");
  repo.git("add", "a.txt");
  const { code, detail } = await failure(plugin.call(commitCreateRpc, { cwd: repo.cwd, message: "blocked", amend: false, all: false }));
  assert.equal(code, "HOOK_FAILED");
  assert.match(detail, /lint failed/);
  assert.equal(repo.tryGit("rev-parse", "--verify", "--quiet", "HEAD"), false);
});
