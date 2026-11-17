import assert from "node:assert/strict";
import { test } from "node:test";
import { everyFile, tree } from "../../../client/views/files/tree.ts";
import type { Folder } from "../../../client/views/files/tree.ts";

const files = (...paths: string[]) => paths.map((path) => ({ path, status: "M" }));
/** A folder as an outline: its name, then what is in it. */
const outline = (folder: Folder): unknown => [folder.name, ...folder.folders.map(outline), ...folder.files.map((file) => file.path)];

test("folders come before files, and a chain of folders is one row", () => {
  const root = tree(files("web/.claude/rules/style.md", "api/.gitignore", "docs/.claude/CLAUDE.md", "api/.claude/CLAUDE.md", "README.md"));
  assert.deepEqual(outline(root), [
    "",
    ["api", [".claude", "api/.claude/CLAUDE.md"], "api/.gitignore"],
    ["docs/.claude", "docs/.claude/CLAUDE.md"],
    ["web/.claude/rules", "web/.claude/rules/style.md"],
    "README.md",
  ]);
  assert.equal(root.folders[1].path, "docs/.claude");
});

test("a chain stops where a folder holds something else", () => {
  const root = tree(files("a/b/c/deep.ts", "a/b/near.ts", "a/b/d/e/other.ts"));
  assert.deepEqual(outline(root), ["", ["a/b", ["c", "a/b/c/deep.ts"], ["d/e", "a/b/d/e/other.ts"], "a/b/near.ts"]]);
});

test("names are in the order a person would put them", () => {
  const root = tree(files("draft-10.md", "Zeta.md", "draft-2.md", "alpha.md"));
  assert.deepEqual(
    root.files.map((file) => file.path),
    ["alpha.md", "draft-2.md", "draft-10.md", "Zeta.md"],
  );
});

test("everything in a folder", () => {
  const root = tree(files("a/one.ts", "a/b/two.ts", "c/three.ts"));
  assert.deepEqual(everyFile(root.folders[0]).map((file) => file.path), ["a/b/two.ts", "a/one.ts"]);
  assert.equal(everyFile(root).length, 3);
});
