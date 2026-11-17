// The two settings documents: complete defaults from nothing, and protected-branch globs.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SAFETY_POLICY,
  DEFAULT_VIEW_PREFERENCES,
  SAFETY_SWITCHES,
  isProtectedBranch,
  isSafetySwitch,
  safetyPolicySchema,
  safetySettings,
  viewSettings,
} from "../../../shared/settings.ts";

test("the safety policy is on the safe side by default", () => {
  for (const name of SAFETY_SWITCHES) assert.equal(DEFAULT_SAFETY_POLICY[name], false, name);
  assert.equal(DEFAULT_SAFETY_POLICY.safetySnapshots, true);
  assert.deepEqual(DEFAULT_SAFETY_POLICY.protectedBranches, ["main", "master", "develop", "release/*"]);
});

test("both documents are host-scoped, versioned, and parse {} into a whole document", () => {
  assert.deepEqual([safetySettings.id, safetySettings.scope, safetySettings.version], ["safety", "host", 1]);
  assert.deepEqual([viewSettings.id, viewSettings.scope, viewSettings.version], ["view", "host", 1]);
  assert.deepEqual(viewSettings.schema.parse({}), DEFAULT_VIEW_PREFERENCES);
  assert.equal(DEFAULT_VIEW_PREFERENCES.diffWhitespace, "ignore-trim");
  assert.equal(DEFAULT_VIEW_PREFERENCES.syntaxHighlight, true);
});

test("a policy that is not one is refused", () => {
  assert.equal(safetyPolicySchema.safeParse({ allowForcePush: "yes" }).success, false);
  assert.equal(safetyPolicySchema.safeParse({ protectedBranches: [""] }).success, false);
});

test("switch names", () => {
  assert.equal(isSafetySwitch("allowForcePush"), true);
  assert.equal(isSafetySwitch("safetySnapshots"), false);
});

test("protected branches: exact names, * within a segment, ** across segments", () => {
  const patterns = ["main", "release/*", "team/**", "**/hotfix"];
  const cases: Array<[string, boolean]> = [
    ["main", true],
    ["refs/heads/main", true],
    ["Main", false], // ref names are case-sensitive
    ["mainline", false],
    ["release/1.2", true],
    ["release/1/2", false],
    ["release", false],
    ["team/a/b", true],
    ["hotfix", true],
    ["a/b/hotfix", true],
    ["hotfix2", false],
    ["feat/x", false],
  ];
  for (const [branch, expected] of cases) assert.equal(isProtectedBranch(branch, patterns), expected, branch);
  assert.equal(isProtectedBranch("a.b", ["a.b"]), true);
  assert.equal(isProtectedBranch("axb", ["a.b"]), false); // a dot is a dot
  assert.equal(isProtectedBranch("main", ["  main  "]), true);
  assert.equal(isProtectedBranch("main", []), false);
});
