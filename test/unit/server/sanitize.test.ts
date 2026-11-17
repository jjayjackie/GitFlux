// Credential redaction: what it hides, that it is idempotent and linear, and what it leaves alone. Token-shaped samples
// are built at run time so that no secret scanner mistakes this file for a leak.

import assert from "node:assert/strict";
import { test } from "node:test";
import { redact, redactUrl } from "../../../server/core/sanitize.ts";

const github = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const fineGrained = "github" + "_pat_" + "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz";
const gitlab = "gl" + "pat-" + "abcdefghij0123456789xy";
const aws = "AK" + "IA" + "ABCDEFGHIJ234567";

test("passwords and tokens in a URL's user part", () => {
  assert.equal(redactUrl("https://user:secret@example.com/r.git"), "https://***@example.com/r.git");
  assert.equal(redactUrl(`https://${github}@github.com/o/r.git`), "https://***@github.com/o/r.git");
  assert.equal(redactUrl(`https://x-access-token:${github}@github.com/o/r`), "https://***@github.com/o/r");
  assert.equal(redact("fatal: unable to access 'http://me:p%40ss@host:8080/x/': error"), "fatal: unable to access 'http://***@host:8080/x/': error");
  // A user name alone is not a secret.
  assert.equal(redactUrl("ssh://git@example.com/r.git"), "ssh://git@example.com/r.git");
  assert.equal(redactUrl("https://alice@example.com/r.git"), "https://alice@example.com/r.git");
});

test("headers, bearer tokens and key=value secrets", () => {
  assert.equal(redact("Authorization: Basic dXNlcjpwYXNz"), "Authorization: Basic ***");
  assert.equal(redact("proxy-authorization: Bearer abcdefghijklmnop"), "proxy-authorization: Bearer ***");
  assert.equal(redact("> Authorization: token-without-scheme-1234"), "> Authorization: ***");
  assert.equal(redact("sent Bearer abcdefghijkl1234 to the server"), "sent Bearer *** to the server");
  assert.equal(redact("https://example.com/x?access_token=abc123&page=2"), "https://example.com/x?access_token=***&page=2");
  assert.equal(redact("password=hunter2 user=ada"), "password=*** user=ada");
  assert.equal(redact("secret=s3cr3t;"), "secret=***;");
});

test("token shapes anywhere in text", () => {
  for (const token of [github, fineGrained, gitlab, aws]) {
    const out = redact(`the value ${token} leaked`);
    assert.ok(!out.includes(token), out);
    assert.match(out, /the value \*\*\* leaked/);
  }
});

test("redacting twice changes nothing more", () => {
  const samples = [
    "https://user:secret@example.com/r.git and Authorization: Basic dXNlcjpwYXNz",
    `token=${github} Bearer abcdefghijkl1234 ${aws}`,
    "plain text with nothing in it",
  ];
  for (const text of samples) assert.equal(redact(redact(text)), redact(text));
});

test("ordinary text is left alone", () => {
  const ordinary = [
    "0123456789abcdef0123456789abcdef01234567",
    "a".repeat(64),
    "src/components/Button.tsx",
    "C:\\Users\\dev\\repo\\file.txt",
    "fix: handle tokens in the parser (#123)",
    "Merge branch 'feature/sk-long-feature-branch-name' into main",
    "git@github.com:org/repo.git",
    "ssh://git@example.com:2222/org/repo.git",
    "Authorization: header parsing is documented",
    "the password field is required",
    "token: refresh",
    "https://example.com/path?page=2",
  ];
  for (const text of ordinary) assert.equal(redact(text), text, text);
});

test("linear time on hostile input", () => {
  const hostile = [
    "a://".repeat(50_000),
    "https://" + "x".repeat(200_000),
    "Authorization:" + " ".repeat(100_000) + "x",
    "Bearer " + "a".repeat(200_000),
    "password=" + "=".repeat(200_000),
    "sk-" + "a-".repeat(100_000),
  ];
  const start = Date.now();
  for (const text of hostile) redact(text);
  assert.ok(Date.now() - start < 5_000, `took ${Date.now() - start} ms`);
});
