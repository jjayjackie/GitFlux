// The environment git runs with: no prompts, the C locale, no editor, batch-mode SSH only where the user configured no
// SSH command, nothing else of the user's removed, and process.env read at each call.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BATCH_SSH_COMMAND, gitEnv } from "../../../server/core/env.ts";
import { withEnv } from "../../helpers/env.ts";

const lookup = (env: Record<string, string>, name: string) => {
  const key = Object.keys(env).find((candidate) => (process.platform === "win32" ? candidate.toUpperCase() === name.toUpperCase() : candidate === name));
  return key === undefined ? undefined : env[key];
};

test("every command: no prompt, no askpass, no editor, no pager, the C locale", async () => {
  await withEnv({ GIT_ASKPASS: "/usr/bin/askpass", SSH_ASKPASS: "/usr/bin/ssh-askpass", LANG: "fr_FR.UTF-8", MY_VARIABLE: "kept" }, async () => {
    for (const kind of ["read", "write", "network"] as const) {
      const env = gitEnv(kind);
      assert.equal(lookup(env, "LC_ALL"), "C");
      assert.equal(lookup(env, "LANG"), "C");
      assert.equal(lookup(env, "GIT_TERMINAL_PROMPT"), "0");
      assert.equal(lookup(env, "GCM_INTERACTIVE"), "never");
      assert.equal(lookup(env, "SSH_ASKPASS_REQUIRE"), "never");
      assert.equal(lookup(env, "GIT_ASKPASS"), undefined);
      assert.equal(lookup(env, "SSH_ASKPASS"), undefined);
      assert.equal(lookup(env, "GIT_EDITOR"), "true");
      assert.equal(lookup(env, "GIT_SEQUENCE_EDITOR"), "true");
      assert.equal(lookup(env, "GIT_PAGER"), "cat");
      assert.equal(lookup(env, "GIT_MERGE_AUTOEDIT"), "no");
      assert.equal(lookup(env, "MY_VARIABLE"), "kept");
    }
  });
});

test("only reads skip optional locks", () => {
  assert.equal(lookup(gitEnv("read"), "GIT_OPTIONAL_LOCKS"), "0");
  assert.notEqual(lookup(gitEnv("write"), "GIT_OPTIONAL_LOCKS"), "0");
  assert.notEqual(lookup(gitEnv("network"), "GIT_OPTIONAL_LOCKS"), "0");
});

test("batch-mode SSH for network commands, unless the user has an SSH command of their own", async () => {
  await withEnv({ GIT_SSH_COMMAND: undefined, GIT_SSH: undefined }, async () => {
    assert.equal(lookup(gitEnv("network"), "GIT_SSH_COMMAND"), BATCH_SSH_COMMAND);
    assert.equal(lookup(gitEnv("read"), "GIT_SSH_COMMAND"), undefined);
    assert.equal(lookup(gitEnv("network", { sshBatch: false }), "GIT_SSH_COMMAND"), undefined); // the repository's core.sshCommand wins
  });
  await withEnv({ GIT_SSH_COMMAND: "ssh -i /keys/deploy", GIT_SSH: undefined }, async () => {
    assert.equal(lookup(gitEnv("network"), "GIT_SSH_COMMAND"), "ssh -i /keys/deploy");
  });
  await withEnv({ GIT_SSH_COMMAND: undefined, GIT_SSH: "/usr/local/bin/my-ssh" }, async () => {
    assert.equal(lookup(gitEnv("network"), "GIT_SSH_COMMAND"), undefined);
    assert.equal(lookup(gitEnv("network"), "GIT_SSH"), "/usr/local/bin/my-ssh");
  });
  assert.ok(!BATCH_SSH_COMMAND.includes("StrictHostKeyChecking"), "host keys are never accepted on their own");
});

test("extra variables are set last, and undefined removes one", () => {
  const env = gitEnv("write", { extra: { GIT_EDITOR: "my-editor", GIT_PAGER: undefined } });
  assert.equal(lookup(env, "GIT_EDITOR"), "my-editor");
  assert.equal(lookup(env, "GIT_PAGER"), undefined);
});

test("process.env is read at each call", async () => {
  await withEnv({ ADVANCED_GIT_PROBE: "one" }, async () => assert.equal(lookup(gitEnv("read"), "ADVANCED_GIT_PROBE"), "one"));
  await withEnv({ ADVANCED_GIT_PROBE: "two" }, async () => assert.equal(lookup(gitEnv("read"), "ADVANCED_GIT_PROBE"), "two"));
});
