// git's words (LC_ALL=C) to codes. The samples are what git and the usual transports print; the table must give each its
// code whatever surrounds it (hints, "fatal:" prefixes, the lines git adds after the cause).

import assert from "node:assert/strict";
import { test } from "node:test";
import { DETAIL_MAX, GitError, capDetail, classify, codeOf, subcommand } from "../../../server/core/errors.ts";
import type { GitErrorCode } from "../../../shared/errors.ts";

const SAMPLES: Array<[GitErrorCode, string]> = [
  ["NOT_A_REPOSITORY", "fatal: not a git repository (or any of the parent directories): .git"],
  ["NOT_A_REPOSITORY", "fatal: not a git repository: /tmp/w/broken/nowhere"],
  ["NOT_A_REPOSITORY", "fatal: invalid gitfile format: /tmp/w/broken/.git"],
  ["NOT_A_REPOSITORY", "fatal: gitfile does not point to a valid repository: /tmp/w/broken/.git"],
  ["NOT_A_REPOSITORY", "fatal: this operation must be run in a work tree"],
  ["NOT_A_REPOSITORY", "fatal: detected dubious ownership in repository at '/srv/r'"],
  ["NO_REMOTE", "fatal: 'nope' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights"],
  ["NO_REMOTE", "fatal: No configured push destination."],
  ["INDEX_LOCKED", "fatal: Unable to create '/r/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository"],
  ["HOST_KEY_VERIFICATION_FAILED", "Host key verification failed.\nfatal: Could not read from remote repository."],
  ["HOST_KEY_VERIFICATION_FAILED", "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @"],
  ["AUTH_FAILED", "remote: Invalid username or password.\nfatal: Authentication failed for 'https://example.com/r.git/'"],
  ["AUTH_FAILED", "fatal: could not read Username for 'https://example.com': terminal prompts disabled"],
  ["AUTH_FAILED", "git@example.com: Permission denied (publickey).\r\nfatal: Could not read from remote repository."],
  ["AUTH_FAILED", "fatal: unable to access 'https://example.com/r.git/': The requested URL returned error: 403"],
  ["AUTH_FAILED", "fatal: unable to access 'https://example.com/r.git/': The requested URL returned error: 401"],
  ["NETWORK", "fatal: unable to access 'https://example.invalid/r.git/': Could not resolve host: example.invalid"],
  ["NETWORK", "ssh: connect to host example.com port 22: Connection refused\nfatal: Could not read from remote repository."],
  ["NETWORK", "ssh: connect to host example.com port 22: Connection timed out"],
  ["NETWORK", "fatal: the remote end hung up unexpectedly"],
  ["REMOTE_REJECTED", " ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs to 'x'"],
  ["REMOTE_REJECTED", "remote: error: GH006: Protected branch update failed for refs/heads/main."],
  ["NON_FAST_FORWARD", " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'x'\nhint: Updates were rejected because the remote contains work that you do not"],
  ["NON_FAST_FORWARD", " ! [rejected]        main -> main (non-fast-forward)"],
  ["NON_FAST_FORWARD", " ! [rejected]        feature -> feature (stale info)"],
  ["NON_FAST_FORWARD", "fatal: Not possible to fast-forward, aborting."],
  ["NON_FAST_FORWARD", "hint: You have divergent branches and need to specify how to reconcile them."],
  ["REF_EXISTS", " ! [rejected]        v1 -> v1 (already exists)"],
  ["REF_EXISTS", "fatal: a branch named 'feature' already exists"],
  ["REF_EXISTS", "error: remote origin already exists."],
  ["NO_UPSTREAM", "fatal: The current branch feature has no upstream branch.\nTo push the current branch and set the remote as upstream, use"],
  ["NO_UPSTREAM", "There is no tracking information for the current branch.\nPlease specify which branch you want to merge with."],
  ["OPERATION_IN_PROGRESS", "error: You have not concluded your merge (MERGE_HEAD exists).\nhint: Please, commit your changes before merging."],
  ["OPERATION_IN_PROGRESS", "error: cherry-pick is already in progress"],
  ["MERGE_CONFLICT", "Auto-merging a.txt\nCONFLICT (content): Merge conflict in a.txt\nAutomatic merge failed; fix conflicts and then commit the result."],
  ["MERGE_CONFLICT", "error: could not apply 1234567... change\nhint: Resolve all conflicts manually, mark them as resolved with"],
  ["MERGE_CONFLICT", "error: Committing is not possible because you have unmerged files."],
  ["WOULD_OVERWRITE_CHANGES", "error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.\nAborting"],
  ["WOULD_OVERWRITE_CHANGES", "error: The following untracked working tree files would be overwritten by merge:\n\tb.txt"],
  ["WOULD_OVERWRITE_CHANGES", "error: cannot pull with rebase: You have unstaged changes."],
  ["UNMERGED_BRANCH", "error: The branch 'feature' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D feature'."],
  ["IDENTITY_MISSING", "Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email"],
  ["IDENTITY_MISSING", "fatal: no email was given and auto-detection is disabled"],
  ["IDENTITY_MISSING", "fatal: empty ident name (for <>) not allowed"],
  ["NOTHING_TO_COMMIT", "On branch main\nnothing to commit, working tree clean"],
  ["NOTHING_TO_COMMIT", "On branch main\nChanges not staged for commit:\n\tmodified:   a.txt\n\nno changes added to commit (use \"git add\" and/or \"git commit -a\")"],
  ["NO_OPERATION", "fatal: There is no merge to abort (MERGE_HEAD missing)."],
  ["NO_OPERATION", "fatal: No rebase in progress?"],
  ["NO_OPERATION", "error: no cherry-pick or revert in progress"],
  ["REF_NOT_FOUND", "fatal: ambiguous argument 'nope': unknown revision or path not in the working tree."],
  ["REF_NOT_FOUND", "error: pathspec 'x.txt' did not match any file(s) known to git"],
  ["REF_NOT_FOUND", "fatal: Not a valid object name nope"],
  ["REF_NOT_FOUND", "fatal: couldn't find remote ref refs/heads/gone"],
  ["REF_NOT_FOUND", "fatal: path 'gone.txt' does not exist in 'HEAD'"],
  ["REF_NOT_FOUND", "fatal: your current branch 'main' does not have any commits yet"],
  ["HOOK_FAILED", "error: failed to push some refs to 'x'\nerror: the pre-push hook declined"],
  ["INVALID_ARGUMENT", "error: unknown option `frobnicate'\nusage: git commit [<options>]"],
  ["UNKNOWN", "fatal: something nobody has seen before"],
  ["UNKNOWN", ""],
];

test("each sample gets its code", () => {
  for (const [code, text] of SAMPLES) assert.equal(codeOf(text), code, text);
});

test("classify reads stderr first, stdout when git said it there, and redacts what it keeps", () => {
  const fromStdout = classify("", "On branch main\nnothing to commit, working tree clean\n", 1, { args: ["commit", "--file=-"] });
  assert.ok(fromStdout instanceof GitError);
  assert.equal(fromStdout.code, "NOTHING_TO_COMMIT");
  assert.match(fromStdout.detail, /nothing to commit/);

  const secret = classify("fatal: unable to access 'https://user:hunter2-secret@example.invalid/r.git/': Could not resolve host: example.invalid\n", "", 128);
  assert.equal(secret.code, "NETWORK");
  assert.ok(!secret.detail.includes("hunter2-secret"), secret.detail);

  const silent = classify("", "", 1, { args: ["-c", "user.useConfigOnly=true", "commit"] });
  assert.equal(silent.code, "UNKNOWN");
  assert.equal(silent.detail, "git commit exited with code 1");
});

test("long details are cut, saying so", () => {
  const long = "x".repeat(DETAIL_MAX + 50);
  const cut = capDetail(long);
  assert.ok(cut.length < long.length);
  assert.match(cut, /50 more characters/);
  assert.equal(capDetail("short"), "short");
});

test("the subcommand of an argument list", () => {
  assert.equal(subcommand(["-c", "a=b", "--literal-pathspecs", "add", "--all"]), "add ");
  assert.equal(subcommand(["fetch", "origin"]), "fetch ");
  assert.equal(subcommand([]), "");
  assert.equal(subcommand(undefined), "");
});

test("a GitError carries its code, detail and setting", () => {
  const error = new GitError("FORBIDDEN_BY_POLICY", "off", { setting: "allowHardReset" });
  assert.equal(error.code, "FORBIDDEN_BY_POLICY");
  assert.equal(error.detail, "off");
  assert.equal(error.setting, "allowHardReset");
  assert.ok(error instanceof Error);
});
