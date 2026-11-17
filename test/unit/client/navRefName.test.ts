import assert from "node:assert/strict";
import { test } from "node:test";
import { localNameFor, refNameProblem } from "../../../client/dialogs/refs/refName.ts";
import { NAME_MAX } from "../../../shared/limits.ts";
import { refNameSchema } from "../../../shared/schemas.ts";

const SAMPLES: readonly [name: string, problem: ReturnType<typeof refNameProblem>][] = [
  ["main", null],
  ["feature/login", null],
  ["release-1.2", null],
  ["v1.0.0", null],
  ["a.b/c_d", null],
  ["功能/登录", null],
  ["", "empty"],
  ["x".repeat(NAME_MAX + 1), "tooLong"],
  ["-x", "leadingDash"],
  ["has space", "characters"],
  ["tab\there", "characters"],
  ["a~1", "characters"],
  ["a^", "characters"],
  ["a:b", "characters"],
  ["a?", "characters"],
  ["a*", "characters"],
  ["a[b", "characters"],
  ["a\\b", "characters"],
  ["bell\u0007", "characters"],
  ["a..b", "form"],
  ["a@{b", "form"],
  ["a//b", "form"],
  ["/a", "form"],
  ["a/", "form"],
  ["a.", "form"],
  ["a.lock", "form"],
  ["@", "form"],
  [".hidden", "form"],
  ["a/.b", "form"],
];

test("refNameProblem names the rule a name breaks", () => {
  for (const [name, problem] of SAMPLES) assert.equal(refNameProblem(name), problem, JSON.stringify(name));
});

test("refNameProblem agrees with refNameSchema, which the daemon applies", () => {
  for (const [name] of SAMPLES) {
    assert.equal(refNameProblem(name) === null, refNameSchema.safeParse(name).success, JSON.stringify(name));
  }
});

test("localNameFor takes the remote's prefix off a remote-tracking branch", () => {
  assert.equal(localNameFor("origin/feat/x", "origin"), "feat/x");
  assert.equal(localNameFor("upstream/main", "upstream"), "main");
  assert.equal(localNameFor("feat/x", "origin"), "feat/x");
});
