// The navigator's rows (architecture §9): the whole left column is ONE virtualised list (ui/List.tsx) of section
// headings and the rows under each — repositories, branches, remotes, tags, stashes, worktrees, submodules — built here
// from the query results, the filter and the expanded set. Pure (no React): unit-tested in
// test/unit/client/navModel.test.ts.
//
// Usage (views/nav/index.tsx):
//   const rows = buildNavRows({ filter, collapsed, expanded, repositories, branches, remotes, … });
//   <List data={rows} keyOf={(row) => row.key} renderRow={(row) => …} />
//
// Expansion: `expanded` is the tab's set of tree keys (state/view.ts's useExpanded("nav")). Branch folders (`bf:…`),
// remotes (`r:…`) and remote folders (`rf:…`) are folded until their key is in it. Repositories (`repo:…`) are the other
// way round: open until their key is in it, so that nested repositories and submodules show at first. While a filter is
// typed, every section and every folder that holds a match is open, whatever the set says.

import type { BranchEntry, RemoteBranchEntry, RemoteEntry, Repository, StashEntry, SubmoduleEntry, TagEntry, WorktreeEntry } from "../../../shared/schemas.ts";

/** The sections, in the order they are drawn. Their folded state is kept with the tab as `nav.<section>`. */
export const NAV_SECTIONS = ["repositories", "branches", "remotes", "tags", "stashes", "worktrees", "submodules"] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

/** What a section's query gave: `items` stays null until it first answered. */
export interface Loaded<Item> {
  items: readonly Item[] | null;
  loading: boolean;
  error: unknown;
  /** The daemon cut the list (LIST_MAX). */
  truncated: boolean;
}

/** A remote with its remote-tracking branches. */
export interface RemoteGroup {
  remote: RemoteEntry;
  branches: readonly RemoteBranchEntry[];
}

export interface NavInput {
  filter: string;
  /** Folded sections. */
  collapsed: ReadonlySet<NavSection>;
  /** Tree keys turned from their default (see the header). */
  expanded: ReadonlySet<string>;
  repositories: readonly Repository[];
  repositoriesTruncated: boolean;
  branches: Loaded<BranchEntry>;
  remotes: Loaded<RemoteGroup>;
  tags: Loaded<TagEntry>;
  stashes: Loaded<StashEntry>;
  worktrees: Loaded<WorktreeEntry>;
  submodules: Loaded<SubmoduleEntry>;
}

/** One row of the navigator. `key` is unique in the whole list; `depth` is the tree level under the section. */
export type NavRow =
  | { kind: "section"; key: string; depth: 0; section: NavSection; count: number | null; collapsed: boolean }
  | { kind: "loading" | "empty" | "truncated"; key: string; depth: 0; section: NavSection }
  | { kind: "error"; key: string; depth: 0; section: NavSection; error: unknown }
  | { kind: "repository"; key: string; depth: number; repository: Repository; hasChildren: boolean; expanded: boolean }
  | { kind: "folder"; key: string; depth: number; section: "branches" | "remotes"; name: string; path: string; count: number; expanded: boolean }
  | { kind: "branch"; key: string; depth: number; branch: BranchEntry; label: string }
  | { kind: "remote"; key: string; depth: number; remote: RemoteEntry; count: number; expanded: boolean }
  | { kind: "remoteBranch"; key: string; depth: number; branch: RemoteBranchEntry; label: string }
  | { kind: "tag"; key: string; depth: number; tag: TagEntry }
  | { kind: "stash"; key: string; depth: number; stash: StashEntry }
  | { kind: "worktree"; key: string; depth: number; worktree: WorktreeEntry }
  | { kind: "submodule"; key: string; depth: number; submodule: SubmoduleEntry };

export type NavRowKind = NavRow["kind"];

// --- keys ------------------------------------------------------------------------------------------------------------

export const navKey = {
  section: (section: NavSection) => `s:${section}`,
  notice: (section: NavSection, kind: "loading" | "empty" | "truncated" | "error") => `n:${section}:${kind}`,
  repository: (root: string) => `repo:${root}`,
  branchFolder: (path: string) => `bf:${path}`,
  branch: (name: string) => `b:${name}`,
  remote: (name: string) => `r:${name}`,
  remoteFolder: (remote: string, path: string) => `rf:${remote}/${path}`,
  remoteBranch: (name: string) => `rb:${name}`,
  tag: (name: string) => `t:${name}`,
  stash: (hash: string) => `st:${hash}`,
  worktree: (path: string) => `w:${path}`,
  submodule: (path: string) => `sm:${path}`,
} as const;

/** Whether a tree key is open: repositories unless folded, everything else once expanded; all of them while filtering. */
export function isOpen(key: string, expanded: ReadonlySet<string>, filtering: boolean): boolean {
  if (filtering) return true;
  return key.startsWith("repo:") ? !expanded.has(key) : expanded.has(key);
}

// --- filtering ---------------------------------------------------------------------------------------------------------

/** The filter as it is compared: trimmed, lower case. Empty: no filter. */
export function normalizeFilter(filter: string): string {
  return filter.trim().toLowerCase();
}

/** Whether any of `texts` holds `needle` (normalised), ignoring case. An empty needle matches everything. */
export function matches(needle: string, ...texts: readonly (string | null | undefined)[]): boolean {
  if (needle === "") return true;
  return texts.some((text) => typeof text === "string" && text.toLowerCase().includes(needle));
}

// --- trees by "/" --------------------------------------------------------------------------------------------------------

export interface PathFolder<Item> {
  /** The last segment: `login` for `feature/login/`. Empty for the root. */
  name: string;
  /** Every segment up to here: `feature/login`. Empty for the root. */
  path: string;
  folders: PathFolder<Item>[];
  leaves: { name: string; item: Item }[];
  /** Leaves at any depth below. */
  count: number;
}

/**
 * Items as a tree of `/`-separated names (`feature/login` in folder `feature`), folders in the order they first appear
 * (the daemon sorts by name, so alphabetical), leaves likewise.
 */
export function pathTree<Item>(items: readonly Item[], pathOf: (item: Item) => string): PathFolder<Item> {
  const root: PathFolder<Item> = { name: "", path: "", folders: [], leaves: [], count: 0 };
  const index = new Map<string, PathFolder<Item>>();
  for (const item of items) {
    const parts = pathOf(item).split("/");
    let folder = root;
    folder.count++;
    for (let n = 0; n < parts.length - 1; n++) {
      const path = parts.slice(0, n + 1).join("/");
      let next = index.get(path);
      if (!next) {
        next = { name: parts[n], path, folders: [], leaves: [], count: 0 };
        index.set(path, next);
        folder.folders.push(next);
      }
      next.count++;
      folder = next;
    }
    folder.leaves.push({ name: parts[parts.length - 1], item });
  }
  return root;
}

/** Draws a path tree: each folder (folders before leaves), then, when it is open, what is in it. */
function emitPathTree<Item>(
  out: NavRow[],
  folder: PathFolder<Item>,
  depth: number,
  folderRow: (folder: PathFolder<Item>, depth: number) => NavRow & { expanded: boolean },
  leafRow: (leaf: { name: string; item: Item }, depth: number) => NavRow,
): void {
  for (const child of folder.folders) {
    const row = folderRow(child, depth);
    out.push(row);
    if (row.expanded) emitPathTree(out, child, depth + 1, folderRow, leafRow);
  }
  for (const leaf of folder.leaves) out.push(leafRow(leaf, depth));
}

// --- repositories -------------------------------------------------------------------------------------------------------

/** The repository a repository is drawn under: a linked worktree under its main work tree, the rest under `parent`. */
export function repositoryParent(repository: Repository): string | null {
  return repository.kind === "worktree" ? (repository.mainRoot ?? repository.parent) : repository.parent;
}

export interface RepositoryNode {
  repository: Repository;
  children: RepositoryNode[];
}

/**
 * The discovered repositories as a tree: nested repositories and submodules under their parent, linked worktrees under
 * their main work tree. One whose parent is not listed (or that is part of a loop of parents) is a root. Order is kept.
 */
export function repositoryTree(list: readonly Repository[]): RepositoryNode[] {
  const byRoot = new Map<string, Repository>();
  for (const repository of list) if (!byRoot.has(repository.root)) byRoot.set(repository.root, repository);
  const parentOf = (repository: Repository): string | null => {
    const parent = repositoryParent(repository);
    return parent !== null && parent !== repository.root && byRoot.has(parent) ? parent : null;
  };
  const inLoop = (repository: Repository): boolean => {
    let parent = parentOf(repository);
    for (let step = 0; parent !== null && step <= byRoot.size; step++) {
      if (parent === repository.root) return true;
      parent = parentOf(byRoot.get(parent)!);
    }
    return false;
  };
  const nodes = new Map<string, RepositoryNode>();
  for (const repository of byRoot.values()) nodes.set(repository.root, { repository, children: [] });
  const roots: RepositoryNode[] = [];
  for (const repository of byRoot.values()) {
    const node = nodes.get(repository.root)!;
    const parent = inLoop(repository) ? null : parentOf(repository);
    if (parent === null) roots.push(node);
    else nodes.get(parent)!.children.push(node);
  }
  return roots;
}

/** Keeps the nodes that match, and the ones above a match; returns null when nothing in `node` matches. */
function filterRepositories(node: RepositoryNode, needle: string): RepositoryNode | null {
  const children = node.children.map((child) => filterRepositories(child, needle)).filter((child): child is RepositoryNode => child !== null);
  const { repository } = node;
  if (children.length > 0 || matches(needle, repository.name, repository.branch)) return { repository, children };
  return null;
}

function emitRepositories(out: NavRow[], nodes: readonly RepositoryNode[], depth: number, expanded: ReadonlySet<string>, filtering: boolean): number {
  let count = 0;
  for (const node of nodes) {
    const key = navKey.repository(node.repository.root);
    const hasChildren = node.children.length > 0;
    const open = hasChildren && isOpen(key, expanded, filtering);
    out.push({ kind: "repository", key, depth, repository: node.repository, hasChildren, expanded: open });
    count++;
    if (open) count += emitRepositories(out, node.children, depth + 1, expanded, filtering);
    else count += countNodes(node.children);
  }
  return count;
}

function countNodes(nodes: readonly RepositoryNode[]): number {
  let count = 0;
  for (const node of nodes) count += 1 + countNodes(node.children);
  return count;
}

// --- remotes --------------------------------------------------------------------------------------------------------------

/** Each remote with its branches, in the remotes' order; branches of a remote not configured get a group of their own. */
export function groupRemotes(remotes: readonly RemoteEntry[], branches: readonly RemoteBranchEntry[]): RemoteGroup[] {
  const groups = remotes.map((remote) => ({ remote, branches: [] as RemoteBranchEntry[] }));
  const byName = new Map(groups.map((group) => [group.remote.name, group]));
  for (const branch of branches) {
    let group = byName.get(branch.remote);
    if (!group) {
      group = { remote: { name: branch.remote, fetchUrl: "", pushUrl: "" }, branches: [] };
      byName.set(branch.remote, group);
      groups.push(group);
    }
    group.branches.push(branch);
  }
  return groups;
}

// --- the rows -------------------------------------------------------------------------------------------------------------

interface Built {
  /** What the heading counts: the things listed (matches, while filtering). */
  count: number;
  rows: NavRow[];
}

/** Appends one section: its heading, then (unless folded) its rows or its loading / error / empty state. */
function emitSection(
  out: NavRow[],
  section: NavSection,
  input: NavInput,
  state: { loaded: boolean; loading: boolean; error: unknown; truncated: boolean },
  build: () => Built,
): void {
  const filtering = normalizeFilter(input.filter) !== "";
  const folded = input.collapsed.has(section) && !filtering;
  const built = state.loaded ? build() : null;
  out.push({ kind: "section", key: navKey.section(section), depth: 0, section, count: built ? built.count : null, collapsed: folded });
  if (folded) return;
  const failed = state.error !== null && state.error !== undefined;
  if (built) {
    if (built.rows.length === 0) {
      if (!filtering) out.push({ kind: "empty", key: navKey.notice(section, "empty"), depth: 0, section });
    } else {
      for (const row of built.rows) out.push(row);
      if (state.truncated) out.push({ kind: "truncated", key: navKey.notice(section, "truncated"), depth: 0, section });
    }
  } else if (!failed) {
    out.push({ kind: "loading", key: navKey.notice(section, "loading"), depth: 0, section });
  }
  if (failed) out.push({ kind: "error", key: navKey.notice(section, "error"), depth: 0, section, error: state.error });
}

const stateOf = <Item,>(loaded: Loaded<Item>) => ({ loaded: loaded.items !== null, loading: loaded.loading, error: loaded.error, truncated: loaded.truncated });

/** Every row of the navigator, in order. */
export function buildNavRows(input: NavInput): NavRow[] {
  const needle = normalizeFilter(input.filter);
  const filtering = needle !== "";
  const { expanded } = input;
  const out: NavRow[] = [];

  emitSection(out, "repositories", input, { loaded: true, loading: false, error: null, truncated: input.repositoriesTruncated }, () => {
    const tree = repositoryTree(input.repositories);
    const kept = filtering ? tree.map((node) => filterRepositories(node, needle)).filter((node): node is RepositoryNode => node !== null) : tree;
    const rows: NavRow[] = [];
    const count = emitRepositories(rows, kept, 0, expanded, filtering);
    return { count, rows };
  });

  emitSection(out, "branches", input, stateOf(input.branches), () => {
    const items = (input.branches.items ?? []).filter((branch) => matches(needle, branch.name));
    const rows: NavRow[] = [];
    emitPathTree(
      rows,
      pathTree(items, (branch) => branch.name),
      0,
      (folder, depth) => {
        const key = navKey.branchFolder(folder.path);
        return { kind: "folder", key, depth, section: "branches", name: folder.name, path: folder.path, count: folder.count, expanded: isOpen(key, expanded, filtering) };
      },
      (leaf, depth) => ({ kind: "branch", key: navKey.branch(leaf.item.name), depth, branch: leaf.item, label: leaf.name }),
    );
    return { count: items.length, rows };
  });

  emitSection(out, "remotes", input, stateOf(input.remotes), () => {
    const rows: NavRow[] = [];
    let count = 0;
    for (const group of input.remotes.items ?? []) {
      const own = matches(needle, group.remote.name);
      const branches = group.branches.filter((branch) => matches(needle, branch.name));
      if (!own && branches.length === 0) continue;
      const key = navKey.remote(group.remote.name);
      const open = isOpen(key, expanded, filtering);
      rows.push({ kind: "remote", key, depth: 0, remote: group.remote, count: branches.length, expanded: open });
      count += branches.length;
      if (!open) continue;
      emitPathTree(
        rows,
        pathTree(branches, (branch) => branch.branch),
        1,
        (folder, depth) => {
          const folderKey = navKey.remoteFolder(group.remote.name, folder.path);
          return { kind: "folder", key: folderKey, depth, section: "remotes", name: folder.name, path: `${group.remote.name}/${folder.path}`, count: folder.count, expanded: isOpen(folderKey, expanded, filtering) };
        },
        (leaf, depth) => ({ kind: "remoteBranch", key: navKey.remoteBranch(leaf.item.name), depth, branch: leaf.item, label: leaf.name }),
      );
    }
    return { count, rows };
  });

  emitSection(out, "tags", input, stateOf(input.tags), () => {
    const items = (input.tags.items ?? []).filter((tag) => matches(needle, tag.name, tag.message));
    return { count: items.length, rows: items.map((tag): NavRow => ({ kind: "tag", key: navKey.tag(tag.name), depth: 0, tag })) };
  });

  emitSection(out, "stashes", input, stateOf(input.stashes), () => {
    const items = (input.stashes.items ?? []).filter((stash) => matches(needle, stash.message, stash.branch, stash.ref));
    return { count: items.length, rows: items.map((stash): NavRow => ({ kind: "stash", key: navKey.stash(stash.hash), depth: 0, stash })) };
  });

  emitSection(out, "worktrees", input, stateOf(input.worktrees), () => {
    const items = (input.worktrees.items ?? []).filter((worktree) => matches(needle, worktree.path, worktree.branch));
    return { count: items.length, rows: items.map((worktree): NavRow => ({ kind: "worktree", key: navKey.worktree(worktree.path), depth: 0, worktree })) };
  });

  emitSection(out, "submodules", input, stateOf(input.submodules), () => {
    const items = (input.submodules.items ?? []).filter((submodule) => matches(needle, submodule.path));
    return { count: items.length, rows: items.map((submodule): NavRow => ({ kind: "submodule", key: navKey.submodule(submodule.path), depth: 0, submodule })) };
  });

  return out;
}

// --- small helpers the rows use ------------------------------------------------------------------------------------------

/** The last segment of a path, `/` or `\` separated (a worktree's folder name). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/** `root` relative to `parent`, `/`-separated (a submodule's path in its parent); null when it is not inside it. */
export function relativeTo(parent: string, root: string): string | null {
  const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm(parent);
  const full = norm(root);
  if (!full.startsWith(`${base}/`)) return null;
  const rest = full.slice(base.length + 1);
  return rest === "" ? null : rest;
}

/** The first 7 characters of a hash, as git abbreviates it by default. */
export const shortHash = (hash: string | null | undefined): string => (hash ? hash.slice(0, 7) : "");
