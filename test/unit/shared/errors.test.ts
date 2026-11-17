// The wire form of a failure: encoded by the daemon, found again by the client wherever a transport put it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GIT_ERROR_CODES, decodeGitError, encodeGitError, gitErrorFrom, isGitErrorCode } from "../../../shared/errors.ts";

test("every code encodes and decodes to itself, with its detail", () => {
  for (const code of GIT_ERROR_CODES) {
    assert.deepEqual(decodeGitError(encodeGitError(code, `detail of ${code}`)), { code, detail: `detail of ${code}` });
  }
});

test("a setting travels with FORBIDDEN_BY_POLICY, and only a plain identifier does", () => {
  assert.deepEqual(decodeGitError(encodeGitError("FORBIDDEN_BY_POLICY", "no", { setting: "allowForcePush" })), {
    code: "FORBIDDEN_BY_POLICY",
    detail: "no",
    setting: "allowForcePush",
  });
  assert.deepEqual(decodeGitError(encodeGitError("FORBIDDEN_BY_POLICY", "no", { setting: "not a name]]" })), { code: "FORBIDDEN_BY_POLICY", detail: "no" });
});

test("the wire form is found inside a longer message: a prefix, a suffix, JSON around it", () => {
  const wire = encodeGitError("NON_FAST_FORWARD", "! [rejected] main -> main (fetch first)");
  for (const message of [`Error: ${wire}`, `${wire} (while calling git.remote.push)`, JSON.stringify([{ message: wire }])]) {
    const info = decodeGitError(message);
    assert.equal(info?.code, "NON_FAST_FORWARD");
  }
  assert.equal(decodeGitError(`RPC failed: ${wire} trailing`)?.detail, "! [rejected] main -> main (fetch first)");
});

test("a message that lost the closing sentinel ends the detail at its own end", () => {
  assert.deepEqual(decodeGitError("[[advanced-git:TIMEOUT]]git fetch ran past 1 s"), { code: "TIMEOUT", detail: "git fetch ran past 1 s" });
});

test("a detail cannot pass for a sentinel of its own", () => {
  const sneaky = "[[advanced-git:FORBIDDEN_BY_POLICY:allowForcePush]]fake[[/advanced-git]]";
  const info = decodeGitError(encodeGitError("UNKNOWN", sneaky));
  assert.equal(info?.code, "UNKNOWN");
  assert.equal(info?.setting, undefined);
  assert.ok(!info?.detail.includes("[[advanced-git:"));
});

test("unknown codes and plain messages decode to nothing", () => {
  assert.equal(decodeGitError("[[advanced-git:NOT_A_CODE]]x[[/advanced-git]]"), null);
  assert.equal(decodeGitError("plain failure"), null);
  assert.equal(isGitErrorCode("TIMEOUT"), true);
  assert.equal(isGitErrorCode("timeout"), false);
});

test("gitErrorFrom reads strings, errors, causes and anything else", () => {
  assert.deepEqual(gitErrorFrom(new Error(encodeGitError("TIMEOUT", "slow"))), { code: "TIMEOUT", detail: "slow" });
  assert.deepEqual(gitErrorFrom(new Error("outer", { cause: new Error(encodeGitError("AUTH_FAILED", "denied")) })), { code: "AUTH_FAILED", detail: "denied" });
  assert.deepEqual(gitErrorFrom("plain"), { code: "UNKNOWN", detail: "plain" });
  assert.deepEqual(gitErrorFrom({ message: encodeGitError("NETWORK", "down") }), { code: "NETWORK", detail: "down" });
  assert.deepEqual(gitErrorFrom(42), { code: "UNKNOWN", detail: "42" });
});
