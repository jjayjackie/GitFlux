// The readers git.submodule.list joins: .gitmodules through `git config --null --get-regexp`, `git submodule status`,
// the parent's index (`git ls-files --stage -z`), and the state they make together.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGitlinks, parseGitmodules, parseSubmoduleStatus, submoduleState } from "../../../server/submodule.ts";

const H1 = "1".repeat(40);
const H2 = "2".repeat(40);
const H3 = "3".repeat(40);

test(".gitmodules: names with dots, paths with spaces and non-ASCII, URL and branch, the file's order", () => {
  const out = [
    "submodule.lib.path\nvendor/lib",
    "submodule.lib.url\nhttps://example.com/lib.git",
    "submodule.v1.2.path\nthird party/ライブラリ",
    "submodule.v1.2.url\n../sibling.git",
    "submodule.v1.2.branch\nstable",
    "submodule.orphan.url\nhttps://example.com/orphan.git", // no path: not a submodule git can use
    "submodule.nourl.path\nno-url",
    "",
  ].join("\0");
  assert.deepEqual(parseGitmodules(out), [
    { name: "lib", path: "vendor/lib", url: "https://example.com/lib.git" },
    { name: "v1.2", path: "third party/ライブラリ", url: "../sibling.git", branch: "stable" },
    { name: "nourl", path: "no-url", url: "" },
  ]);
  assert.equal(parseGitmodules("").length, 0);
});

test("submodule status: each flag, a describe suffix, a path holding ' ('", () => {
  const out = [
    ` ${H1} vendor/lib (v1.0.0)`,
    `+${H2} third party/ライブラリ (heads/main)`,
    `-${H3} not yet`,
    `U${"0".repeat(40)} conflicted`,
    ` ${H1} odd (name) (v2)`,
    ` ${H2} unknown/to/gitmodules (tag)`,
    "",
  ].join("\n");
  const known = ["vendor/lib", "third party/ライブラリ", "not yet", "conflicted", "odd (name)"];
  const lines = parseSubmoduleStatus(out, known);
  assert.deepEqual(lines.get("vendor/lib"), { flag: " ", hash: H1, describe: "v1.0.0" });
  assert.deepEqual(lines.get("third party/ライブラリ"), { flag: "+", hash: H2, describe: "heads/main" });
  assert.deepEqual(lines.get("not yet"), { flag: "-", hash: H3 });
  assert.deepEqual(lines.get("conflicted"), { flag: "U", hash: "0".repeat(40) });
  assert.deepEqual(lines.get("odd (name)"), { flag: " ", hash: H1, describe: "v2" });
  assert.deepEqual(lines.get("unknown/to/gitmodules"), { flag: " ", hash: H2, describe: "tag" });
});

test("the parent's index: submodules only, the recorded commit, a conflict", () => {
  const out = [
    `100644 ${H1} 0\tREADME.md`,
    `160000 ${H2} 0\tvendor/lib`,
    `160000 ${H1} 1\tconflicted`,
    `160000 ${H2} 2\tconflicted`,
    `160000 ${H3} 3\tconflicted`,
    `160000 ${H3} 0\tthird party/ライブラリ`,
    "",
  ].join("\0");
  const links = parseGitlinks(out);
  assert.equal(links.size, 3);
  assert.deepEqual(links.get("vendor/lib"), { expected: H2, conflict: false });
  assert.deepEqual(links.get("conflicted"), { expected: null, conflict: true });
  assert.deepEqual(links.get("third party/ライブラリ"), { expected: H3, conflict: false });
});

test("the state: conflict, then not initialised, then local changes, then another commit", () => {
  const base = { conflict: false, initialized: true, dirty: false, hash: H1, expected: H1 };
  assert.equal(submoduleState({ ...base, flag: " " }), "clean");
  assert.equal(submoduleState({ ...base, flag: "+", hash: H2 }), "ahead");
  assert.equal(submoduleState({ ...base, flag: "+", hash: H2, dirty: true }), "modified");
  assert.equal(submoduleState({ ...base, flag: " ", dirty: true }), "modified");
  assert.equal(submoduleState({ ...base, flag: "-", initialized: false, hash: null }), "uninitialized");
  assert.equal(submoduleState({ ...base, flag: "U" }), "conflict");
  assert.equal(submoduleState({ ...base, conflict: true }), "conflict");
  // Without a status line: compared here.
  assert.equal(submoduleState({ ...base }), "clean");
  assert.equal(submoduleState({ ...base, hash: H2 }), "ahead");
  assert.equal(submoduleState({ ...base, expected: null, hash: H2 }), "clean");
  assert.equal(submoduleState({ ...base, initialized: false, hash: null }), "uninitialized");
});
