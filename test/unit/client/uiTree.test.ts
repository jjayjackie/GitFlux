import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenTree, toggleKey } from "../../../client/ui/tree.ts";

interface Node {
  name: string;
  children?: Node[];
}

const roots: Node[] = [
  { name: "src", children: [{ name: "src/app", children: [{ name: "src/app/main.ts" }] }, { name: "src/index.ts" }] },
  { name: "empty", children: [] },
  { name: "README.md" },
];
const options = (expanded: string[], limit?: number) => ({
  childrenOf: (node: Node) => node.children ?? null,
  keyOf: (node: Node) => node.name,
  expanded: new Set(expanded),
  limit,
});

test("only the children of expanded nodes are rows, depth first", () => {
  const rows = flattenTree(roots, options(["src"]));
  assert.deepEqual(
    rows.map((row) => [row.key, row.depth, row.hasChildren, row.expanded]),
    [
      ["src", 0, true, true],
      ["src/app", 1, true, false],
      ["src/index.ts", 1, false, false],
      ["empty", 0, true, false],
      ["README.md", 0, false, false],
    ],
  );
});

test("a collapsed parent hides an expanded child", () => {
  const rows = flattenTree(roots, options(["src/app"]));
  assert.deepEqual(
    rows.map((row) => row.key),
    ["src", "empty", "README.md"],
  );
});

test("rows stop at the limit", () => {
  assert.equal(flattenTree(roots, options(["src", "src/app"], 3)).length, 3);
});

test("toggleKey adds and removes", () => {
  assert.deepEqual(toggleKey(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleKey(["a", "b"], "a"), ["b"]);
});
