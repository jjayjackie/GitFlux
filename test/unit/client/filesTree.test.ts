import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileChange } from "../../../shared/schemas.ts";
import { childrenOf, fileKey, fileName, fileNodes, filterFiles, folderKey, folderKeys, folderOf, folderTone, rowCount } from "../../../client/views/files/tree.ts";
import type { FileNode } from "../../../client/views/files/tree.ts";

const files = (...paths: string[]): FileChange[] => paths.map((path) => ({ path, status: "M" }));
/** Nodes as an outline: a folder's name and what is in it, a file's path. */
const outline = (nodes: readonly FileNode[]): unknown[] => nodes.map((node) => (node.kind === "folder" ? [node.name, ...outline(node.children)] : node.path));

test("the tree has folders first, chains of single folders as one row, and keys that tell folders from files", () => {
  const nodes = fileNodes(files("src/app/main.ts", "src/app/view.ts", "README.md", "docs/guide/intro.md"), "tree");
  assert.deepEqual(outline(nodes), [["docs/guide", "docs/guide/intro.md"], ["src/app", "src/app/main.ts", "src/app/view.ts"], "README.md"]);
  assert.equal(nodes[0].key, folderKey("docs/guide"));
  assert.equal(nodes[2].key, fileKey("README.md"));
  const folder = nodes[1];
  assert.equal(folder.kind, "folder");
  if (folder.kind === "folder") assert.deepEqual(folder.files.map((file) => file.path), ["src/app/main.ts", "src/app/view.ts"]);
});

test("a file and a folder of the same path keep separate keys", () => {
  const nodes = fileNodes([{ path: "a", status: "D" }, { path: "a/b.ts", status: "A" }], "tree");
  const keys = nodes.map((node) => node.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("the list is flat, in path order, each file knowing its folder", () => {
  const nodes = fileNodes(files("src/z.ts", "b.md", "src/a/x.ts", "A.md"), "list");
  assert.deepEqual(
    nodes.map((node) => node.path),
    ["A.md", "b.md", "src/a/x.ts", "src/z.ts"],
  );
  const last = nodes[3];
  assert.equal(last.kind === "file" ? last.folder : null, "src");
  assert.equal(nodes.every((node) => childrenOf(node) === null), true);
});

test("the arrangement of one list of files is computed once per mode", () => {
  const list = files("a/b.ts", "c.ts");
  assert.equal(fileNodes(list, "tree"), fileNodes(list, "tree"));
  assert.equal(fileNodes(list, "list"), fileNodes(list, "list"));
  assert.notEqual(fileNodes(list, "tree"), fileNodes(list, "list"));
});

test("every folder key, and the rows of a tree with every folder open", () => {
  const nodes = fileNodes(files("a/b/one.ts", "a/two.ts", "c/three.ts", "four.ts"), "tree");
  assert.deepEqual(folderKeys(nodes).sort(), [folderKey("a"), folderKey("a/b"), folderKey("c")].sort());
  // a, a/b, one.ts, two.ts, c, three.ts, four.ts
  assert.equal(rowCount(nodes), 7);
  assert.equal(rowCount(fileNodes(files("x.ts", "y.ts"), "list")), 2);
});

test("a folder's dot: a conflict first, then all added, else modified", () => {
  assert.equal(folderTone([{ path: "a", status: "M" }, { path: "b", status: "U" }]), "danger");
  assert.equal(folderTone([{ path: "a", status: "A" }, { path: "b", status: "?" }]), "success");
  assert.equal(folderTone([{ path: "a", status: "A" }, { path: "b", status: "D" }]), "warning");
});

test("the filter matches paths and a rename's old path, ignoring case; an empty one keeps the same list", () => {
  const list: FileChange[] = [
    { path: "src/Main.ts", status: "M" },
    { path: "docs/new.md", from: "docs/old.md", status: "R" },
    { path: "README.md", status: "?" },
  ];
  assert.equal(filterFiles(list, ""), list);
  assert.equal(filterFiles(list, "  "), list);
  assert.deepEqual(
    filterFiles(list, "main").map((file) => file.path),
    ["src/Main.ts"],
  );
  assert.deepEqual(
    filterFiles(list, "OLD").map((file) => file.path),
    ["docs/new.md"],
  );
  assert.equal(filterFiles(list, "nothing").length, 0);
});

test("a directory git lists whole (an untracked nested repository) is a leaf named for its folder", () => {
  const nested: FileChange[] = [{ path: "packages/tools/", status: "?" }];
  assert.equal(fileName(nested[0]), "tools/");
  assert.equal(folderOf("packages/tools/"), "packages");
  const nodes = fileNodes(nested, "tree");
  assert.equal(nodes.length, 1);
  const folder = nodes[0];
  assert.equal(folder.kind, "folder");
  if (folder.kind !== "folder") return;
  assert.equal(folder.path, "packages");
  assert.deepEqual(
    folder.children.map((child) => [child.kind, child.name]),
    [["file", "tools/"]],
  );
});
