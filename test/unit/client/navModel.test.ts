import assert from "node:assert/strict";
import { test } from "node:test";
import type { BranchEntry, RemoteBranchEntry, RemoteEntry, Repository, StashEntry, SubmoduleEntry, TagEntry } from "../../../shared/schemas.ts";
import {
  baseName,
  buildNavRows,
  groupRemotes,
  isOpen,
  matches,
  navKey,
  pathTree,
  relativeTo,
  repositoryTree,
} from "../../../client/views/nav/model.ts";
import type { Loaded, NavInput, NavRow, NavSection, RemoteGroup } from "../../../client/views/nav/model.ts";

const HASH = "a".repeat(40);

function repo(root: string, extra: Partial<Repository> = {}): Repository {
  return {
    root,
    name: baseName(root),
    branch: "main",
    head: HASH,
    upstream: null,
    ahead: 0,
    behind: 0,
    changed: false,
    staged: false,
    merging: false,
    failed: null,
    kind: "repository",
    parent: null,
    mainRoot: null,
    depth: 0,
    conflicted: false,
    operation: null,
    initialized: true,
    ...extra,
  };
}

function branch(name: string, extra: Partial<BranchEntry> = {}): BranchEntry {
  return { name, hash: HASH, upstream: null, upstreamGone: false, ahead: 0, behind: 0, current: false, worktree: null, time: 0, subject: "", protected: false, ...extra };
}

function remoteBranch(name: string): RemoteBranchEntry {
  const [remote, ...rest] = name.split("/");
  return { name, remote, branch: rest.join("/"), hash: HASH, time: 0, subject: "", isHead: false };
}

const remote = (name: string): RemoteEntry => ({ name, fetchUrl: `https://example.invalid/${name}.git`, pushUrl: `https://example.invalid/${name}.git` });
const tag = (name: string, message?: string): TagEntry => ({ name, hash: HASH, annotated: message !== undefined, message, time: 0 });
const stash = (index: number, message: string, branchName: string | null = "main"): StashEntry => ({
  index,
  ref: `stash@{${index}}`,
  hash: String(index).repeat(40).slice(0, 40).replace(/[^0-9a-f]/g, "b"),
  message,
  branch: branchName,
  time: 0,
});

const ready = <Item>(items: readonly Item[], truncated = false): Loaded<Item> => ({ items, loading: false, error: null, truncated });
const pending = <Item>(): Loaded<Item> => ({ items: null, loading: true, error: null, truncated: false });

function input(extra: Partial<NavInput> = {}): NavInput {
  return {
    filter: "",
    collapsed: new Set<NavSection>(),
    expanded: new Set<string>(),
    repositories: [repo("/w/app")],
    repositoriesTruncated: false,
    branches: ready<BranchEntry>([]),
    remotes: ready<RemoteGroup>([]),
    tags: ready<TagEntry>([]),
    stashes: ready<StashEntry>([]),
    worktrees: ready([]),
    submodules: ready([]),
    ...extra,
  };
}

const keysOf = (rows: readonly NavRow[]) => rows.map((row) => row.key);
const sectionOf = (rows: readonly NavRow[], section: NavSection) => rows.find((row): row is Extract<NavRow, { kind: "section" }> => row.kind === "section" && row.section === section);

test("pathTree groups names by '/' segments and counts the leaves below each folder", () => {
  const tree = pathTree(["feature/login", "feature/ui/menu", "main", "fix/x"], (name) => name);
  assert.deepEqual(
    tree.folders.map((folder) => [folder.path, folder.count]),
    [
      ["feature", 2],
      ["fix", 1],
    ],
  );
  assert.deepEqual(
    tree.leaves.map((leaf) => leaf.name),
    ["main"],
  );
  const feature = tree.folders[0];
  assert.deepEqual(
    feature.leaves.map((leaf) => leaf.name),
    ["login"],
  );
  assert.equal(feature.folders[0].path, "feature/ui");
  assert.equal(feature.folders[0].leaves[0].item, "feature/ui/menu");
  assert.equal(tree.count, 4);
});

test("branch folders are folded until expanded; folders come before leaves", () => {
  const branches = ready([branch("feature/login"), branch("feature/signup"), branch("main", { current: true })]);
  const folded = buildNavRows(input({ branches }));
  const start = folded.findIndex((row) => row.key === navKey.section("branches"));
  assert.deepEqual(keysOf(folded.slice(start + 1, start + 3)), ["bf:feature", "b:main"]);
  assert.equal(sectionOf(folded, "branches")?.count, 3);

  const open = buildNavRows(input({ branches, expanded: new Set(["bf:feature"]) }));
  const at = open.findIndex((row) => row.key === "bf:feature");
  const rows = open.slice(at, at + 4);
  assert.deepEqual(keysOf(rows), ["bf:feature", "b:feature/login", "b:feature/signup", "b:main"]);
  assert.deepEqual(
    rows.map((row) => row.depth),
    [0, 1, 1, 0],
  );
  const leaf = rows[1];
  assert.ok(leaf.kind === "branch" && leaf.label === "login");
});

test("the filter matches case-insensitively, opens the folders that hold a match and counts the matches", () => {
  const branches = ready([branch("feature/Login"), branch("feature/signup"), branch("main")]);
  const rows = buildNavRows(input({ filter: "  LOGIN ", branches, tags: ready([tag("v1.0", "login release"), tag("v2.0")]) }));
  assert.ok(keysOf(rows).includes("bf:feature"));
  assert.ok(keysOf(rows).includes("b:feature/Login"));
  assert.ok(!keysOf(rows).includes("b:feature/signup"));
  assert.ok(!keysOf(rows).includes("b:main"));
  const folder = rows.find((row) => row.key === "bf:feature");
  assert.ok(folder?.kind === "folder" && folder.expanded);
  assert.equal(sectionOf(rows, "branches")?.count, 1);
  // A tag matches by its message too.
  assert.ok(keysOf(rows).includes("t:v1.0"));
  assert.ok(!keysOf(rows).includes("t:v2.0"));
  // A section with no match shows its heading and nothing else (no "empty" notice while filtering).
  assert.equal(sectionOf(rows, "stashes")?.count, 0);
  assert.ok(!rows.some((row) => row.kind === "empty"));
});

test("a filter opens folded sections; without one a folded section is its heading only", () => {
  const tags = ready([tag("v1.0")]);
  const folded = buildNavRows(input({ tags, collapsed: new Set<NavSection>(["tags"]) }));
  assert.equal(sectionOf(folded, "tags")?.collapsed, true);
  assert.ok(!keysOf(folded).includes("t:v1.0"));
  assert.equal(sectionOf(folded, "tags")?.count, 1);

  const filtered = buildNavRows(input({ tags, filter: "v1", collapsed: new Set<NavSection>(["tags"]) }));
  assert.equal(sectionOf(filtered, "tags")?.collapsed, false);
  assert.ok(keysOf(filtered).includes("t:v1.0"));
});

test("loading, failure, empty and cut sections say so", () => {
  const failure = new Error("boom");
  const rows = buildNavRows(
    input({
      branches: pending(),
      tags: { items: null, loading: false, error: failure, truncated: false },
      stashes: ready([]),
      worktrees: ready([], false),
      submodules: ready<SubmoduleEntry>([{ path: "lib", root: "/w/app/lib", url: "", hash: null, expected: null, state: "uninitialized" }], true),
    }),
  );
  assert.ok(keysOf(rows).includes(navKey.notice("branches", "loading")));
  assert.equal(sectionOf(rows, "branches")?.count, null);
  const error = rows.find((row) => row.key === navKey.notice("tags", "error"));
  assert.ok(error?.kind === "error" && error.error === failure);
  assert.ok(!keysOf(rows).includes(navKey.notice("tags", "loading")));
  assert.ok(keysOf(rows).includes(navKey.notice("stashes", "empty")));
  assert.ok(keysOf(rows).includes(navKey.notice("submodules", "truncated")));
});

test("sections come in order, and every key is unique", () => {
  const rows = buildNavRows(
    input({
      branches: ready([branch("main")]),
      remotes: ready(groupRemotes([remote("origin")], [remoteBranch("origin/main")])),
      tags: ready([tag("main")]),
      stashes: ready([stash(0, "wip")]),
      expanded: new Set(["r:origin"]),
    }),
  );
  assert.deepEqual(
    rows.filter((row) => row.kind === "section").map((row) => (row.kind === "section" ? row.section : "")),
    ["repositories", "branches", "remotes", "tags", "stashes", "worktrees", "submodules"],
  );
  assert.equal(new Set(keysOf(rows)).size, rows.length);
});

test("remotes hold their branches as a tree by '/', folded until expanded", () => {
  const groups = groupRemotes([remote("origin"), remote("upstream")], [remoteBranch("origin/main"), remoteBranch("origin/feat/a"), remoteBranch("upstream/main")]);
  const folded = buildNavRows(input({ remotes: ready(groups) }));
  assert.ok(keysOf(folded).includes("r:origin"));
  assert.ok(!keysOf(folded).includes("rb:origin/main"));
  assert.equal(sectionOf(folded, "remotes")?.count, 3);

  const open = buildNavRows(input({ remotes: ready(groups), expanded: new Set(["r:origin", "rf:origin/feat"]) }));
  const at = open.findIndex((row) => row.key === "r:origin");
  assert.deepEqual(keysOf(open.slice(at, at + 5)), ["r:origin", "rf:origin/feat", "rb:origin/feat/a", "rb:origin/main", "r:upstream"]);
  const folder = open[at + 1];
  assert.ok(folder.kind === "folder" && folder.depth === 1 && folder.path === "origin/feat");
});

test("groupRemotes keeps branches of a remote that is not configured", () => {
  const groups = groupRemotes([remote("origin")], [remoteBranch("origin/main"), remoteBranch("gone/x")]);
  assert.deepEqual(
    groups.map((group) => [group.remote.name, group.branches.length]),
    [
      ["origin", 1],
      ["gone", 1],
    ],
  );
});

test("repositories nest by parent, and linked worktrees under their main work tree", () => {
  const list = [
    repo("/w/app"),
    repo("/w/app/lib", { kind: "submodule", parent: "/w/app" }),
    repo("/w/app/lib/deep", { kind: "submodule", parent: "/w/app/lib" }),
    repo("/w/other"),
    repo("/w/app-wt", { kind: "worktree", parent: null, mainRoot: "/w/app" }),
  ];
  const tree = repositoryTree(list);
  assert.deepEqual(
    tree.map((node) => node.repository.root),
    ["/w/app", "/w/other"],
  );
  assert.deepEqual(
    tree[0].children.map((node) => node.repository.root),
    ["/w/app/lib", "/w/app-wt"],
  );
  assert.equal(tree[0].children[0].children[0].repository.root, "/w/app/lib/deep");

  // Open by default: every repository is listed, indented by its depth.
  const rows = buildNavRows(input({ repositories: list })).filter((row) => row.kind === "repository");
  assert.deepEqual(
    rows.map((row) => [row.key, row.depth]),
    [
      ["repo:/w/app", 0],
      ["repo:/w/app/lib", 1],
      ["repo:/w/app/lib/deep", 2],
      ["repo:/w/app-wt", 1],
      ["repo:/w/other", 0],
    ],
  );
  // Folding one (its key in the set) hides what is under it, and the heading still counts every repository.
  const folded = buildNavRows(input({ repositories: list, expanded: new Set(["repo:/w/app"]) }));
  assert.deepEqual(
    folded.filter((row) => row.kind === "repository").map((row) => row.key),
    ["repo:/w/app", "repo:/w/other"],
  );
  assert.equal(sectionOf(folded, "repositories")?.count, 5);
});

test("a loop of parents, or a parent not listed, makes roots rather than losing repositories", () => {
  const list = [repo("/a", { parent: "/b" }), repo("/b", { parent: "/a" }), repo("/c", { parent: "/missing" }), repo("/d", { parent: "/a" })];
  const tree = repositoryTree(list);
  assert.deepEqual(
    tree.map((node) => node.repository.root),
    ["/a", "/b", "/c"],
  );
  assert.deepEqual(
    tree[0].children.map((node) => node.repository.root),
    ["/d"],
  );
});

test("filtering repositories keeps a match's parents, open", () => {
  const list = [repo("/w/app"), repo("/w/app/lib", { kind: "submodule", parent: "/w/app" }), repo("/w/other")];
  const rows = buildNavRows(input({ repositories: list, filter: "lib", expanded: new Set(["repo:/w/app"]) })).filter((row) => row.kind === "repository");
  assert.deepEqual(
    rows.map((row) => row.key),
    ["repo:/w/app", "repo:/w/app/lib"],
  );
  assert.ok(rows[0].kind === "repository" && rows[0].expanded);
});

test("stashes match by message, branch and ref", () => {
  const stashes = ready([stash(0, "wip on parser", "feature/x"), stash(1, "other", null)]);
  assert.deepEqual(
    keysOf(buildNavRows(input({ stashes, filter: "feature" }))).filter((key) => key.startsWith("st:")).length,
    1,
  );
  assert.deepEqual(
    keysOf(buildNavRows(input({ stashes, filter: "stash@{1}" }))).filter((key) => key.startsWith("st:")).length,
    1,
  );
});

test("small helpers", () => {
  assert.equal(matches("", "anything"), true);
  assert.equal(matches("ab", null, undefined, "xABy"), true);
  assert.equal(matches("zz", "abc"), false);
  assert.equal(isOpen("repo:/x", new Set(), false), true);
  assert.equal(isOpen("repo:/x", new Set(["repo:/x"]), false), false);
  assert.equal(isOpen("bf:x", new Set(), false), false);
  assert.equal(isOpen("bf:x", new Set(), true), true);
  assert.equal(baseName("/w/app-wt/"), "app-wt");
  assert.equal(baseName("C:\\w\\app"), "app");
  assert.equal(relativeTo("/w/app", "/w/app/lib/x"), "lib/x");
  assert.equal(relativeTo("C:\\w\\app", "C:\\w\\app\\lib"), "lib");
  assert.equal(relativeTo("/w/app", "/w/application"), null);
  assert.equal(relativeTo("/w/app", "/w/app"), null);
});
