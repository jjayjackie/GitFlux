// The input guards every contract is built from: what they refuse, with which code, and what they let through.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ZodType } from "zod";
import { decodeGitError } from "../../../shared/errors.ts";
import { changesDiscardRpc } from "../../../shared/rpc/changes.ts";
import { commitCreateRpc } from "../../../shared/rpc/commit.ts";
import { remotePushRpc, remoteUrlSchema } from "../../../shared/rpc/remote.ts";
import { cwdSchema, hashSchema, refNameSchema, repoPathSchema, revisionSchema } from "../../../shared/schemas.ts";

/** The code an input's refusal carries, or "ok". */
function verdict(schema: ZodType, value: unknown): string {
  const result = schema.safeParse(value);
  if (result.success) return "ok";
  return decodeGitError(result.error.message)?.code ?? "no code";
}

test("ref names: what check-ref-format refuses that can be seen without git", () => {
  for (const name of ["main", "feat/x", "v1.0", "release/1.2", "a-b_c"]) assert.equal(verdict(refNameSchema, name), "ok", name);
  for (const name of ["", "-x", "--upload-pack=x", "a..b", "a b", "a~1", "a^", "a:b", "a?", "a*", "a[", "a\\b", "x.lock", "/a", "a/", "a//b", "@", ".hidden", "a/.b", "a.", "a@{1}", "a\u0001"]) {
    assert.equal(verdict(refNameSchema, name), "INVALID_ARGUMENT", JSON.stringify(name));
  }
});

test("revisions never start with '-' and hold no space", () => {
  for (const revision of ["HEAD~2", "main^2", "@{u}", "stash@{1}", "a..b", "abc1234"]) assert.equal(verdict(revisionSchema, revision), "ok", revision);
  for (const revision of ["-n", "--output=x", "a b", ""]) assert.equal(verdict(revisionSchema, revision), "INVALID_ARGUMENT", revision);
});

test("repository paths stay relative and inside", () => {
  for (const path of ["a.txt", "dir/file name.txt", "-n.txt", "日本語/ファイル.md", ".gitignore"]) assert.equal(verdict(repoPathSchema, path), "ok", path);
  for (const path of ["", "../outside", "a/../../b", "/etc/passwd", "\\\\server\\share", "C:\\Windows", "c:/x", "a\0b", "..\\x"]) {
    assert.equal(verdict(repoPathSchema, path), "INVALID_ARGUMENT", JSON.stringify(path));
  }
});

test("cwd is absolute", () => {
  assert.equal(verdict(cwdSchema, "/repo"), "ok");
  assert.equal(verdict(cwdSchema, "C:\\repo"), "ok");
  assert.equal(verdict(cwdSchema, "repo"), "INVALID_ARGUMENT");
  assert.equal(verdict(cwdSchema, "/re\0po"), "INVALID_ARGUMENT");
});

test("full hashes only", () => {
  assert.equal(verdict(hashSchema, "a".repeat(40)), "ok");
  assert.equal(verdict(hashSchema, "b".repeat(64)), "ok");
  assert.equal(verdict(hashSchema, "abc123"), "INVALID_ARGUMENT");
  assert.equal(verdict(hashSchema, "A".repeat(40)), "INVALID_ARGUMENT");
});

test("remote URLs: no credentials, no command transports, no options", () => {
  for (const url of ["https://example.com/r.git", "ssh://git@example.com/r", "git@example.com:org/r.git", "/srv/git/r.git", "file:///srv/git/r.git", "git://example.com/r"]) {
    assert.equal(verdict(remoteUrlSchema, url), "ok", url);
  }
  for (const url of ["https://user:secret@example.com/r.git", "ext::sh -c touch% /tmp/x", "fd::3", "-uhttps://x", "https://exa mple.com", ""]) {
    assert.equal(verdict(remoteUrlSchema, url), "INVALID_ARGUMENT", url);
  }
});

test("a destructive call needs confirm: true, and says so with its own code", () => {
  const discard = { cwd: "/repo", files: [{ path: "a.txt", status: "M" }], trash: false };
  assert.equal(verdict(changesDiscardRpc.input, discard), "CONFIRMATION_REQUIRED");
  assert.equal(verdict(changesDiscardRpc.input, { ...discard, confirm: false }), "CONFIRMATION_REQUIRED");
  assert.equal(verdict(changesDiscardRpc.input, { ...discard, confirm: true }), "ok");
  const push = { cwd: "/repo", force: "with-lease" };
  assert.equal(verdict(remotePushRpc.input, push), "CONFIRMATION_REQUIRED");
  assert.equal(verdict(remotePushRpc.input, { ...push, confirm: true }), "ok");
  assert.equal(verdict(remotePushRpc.input, { cwd: "/repo", force: "none" }), "ok");
  assert.equal(verdict(remotePushRpc.input, { cwd: "/repo", force: "bare" }), "no code"); // there is no bare force
});

test("a commit needs a message unless it amends", () => {
  const commit = { cwd: "/repo", amend: false, all: false };
  assert.equal(verdict(commitCreateRpc.input, { ...commit, message: "  " }), "INVALID_ARGUMENT");
  assert.equal(verdict(commitCreateRpc.input, { ...commit, message: "", amend: true }), "ok");
  assert.equal(verdict(commitCreateRpc.input, { ...commit, message: "fix" }), "ok");
});
