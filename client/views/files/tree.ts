// Arranges changed files as a tree of folders, the way VS Code's "View as Tree" does: folders
// before files, both in name order, and a chain of folders with nothing else in them as one row.
//
// Adapted from upstream's paseo-source-control: client/tree.ts (paseo-source-control): `tree`, `everyFile` and `fileName` are
// upstream's; the nodes FileTree.tsx draws (folders and files with keys, the flat "list" mode, the folder's colour) are
// added here. Pure: unit-tested (test/unit/client/tree.test.ts, filesTree.test.ts).

import type { FileChange } from "../../../shared/schemas.ts";

export interface Folder {
  name: string; // a chain of folders reads "outer/inner"
  path: string; // from the repository's root
  folders: Folder[];
  files: FileChange[]; // the files directly inside
}

const inOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
export const fileName = (file: Pick<FileChange, "path">) => file.path.slice(file.path.lastIndexOf("/") + 1);
/** The folder a file is in, "" at the top. */
export const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Merges the chains below a folder and puts its contents in order. */
function tidy(folder: Folder): Folder {
  const folders = folder.folders
    .map(tidy)
    .map((child) => (child.folders.length === 1 && !child.files.length ? { ...child.folders[0], name: `${child.name}/${child.folders[0].name}` } : child))
    .sort((a, b) => inOrder(a.name, b.name));
  return { ...folder, folders, files: [...folder.files].sort((a, b) => inOrder(fileName(a), fileName(b))) };
}

/** The repository's root, holding the files at the top level and the folders of the rest. */
export function tree(files: readonly FileChange[]): Folder {
  const root: Folder = { name: "", path: "", folders: [], files: [] };
  const made = new Map<string, Folder>(); // by path: a folder can hold thousands of others
  for (const file of files) {
    let folder = root;
    for (const name of file.path.split("/").slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${name}` : name;
      let next = made.get(path);
      if (!next) {
        made.set(path, (next = { name, path, folders: [], files: [] }));
        folder.folders.push(next);
      }
      folder = next;
    }
    folder.files.push(file);
  }
  return tidy(root);
}

/** Every file in a folder, however deep. */
export const everyFile = (folder: Folder): FileChange[] => [...folder.folders.flatMap(everyFile), ...folder.files];

// --- the nodes FileTree.tsx draws -----------------------------------------------------------------------------------

/** "tree" groups files by folder; "list" is flat, in path order. */
export type FileTreeMode = "tree" | "list";

export interface FolderNode {
  kind: "folder";
  /** Unique in the tree: `d:` and the folder's path. */
  key: string;
  /** "outer/inner" for a chain of folders. */
  name: string;
  path: string;
  children: readonly FileNode[];
  /** Every file below it, however deep: what its actions apply to. */
  files: readonly FileChange[];
}

export interface FileLeaf {
  kind: "file";
  /** Unique in the tree: `f:` and the file's path (a file and a folder may share a path while one replaces the other). */
  key: string;
  name: string;
  path: string;
  /** The folder it is in, "" at the top: shown dimmed after the name in the "list" mode. */
  folder: string;
  file: FileChange;
}

export type FileNode = FolderNode | FileLeaf;

export const folderKey = (path: string) => `d:${path}`;
export const fileKey = (path: string) => `f:${path}`;

/** A node's children, for ui/tree.ts: a folder's contents, null for a file. Stable, so the flattening memoises. */
export const childrenOf = (node: FileNode): readonly FileNode[] | null => (node.kind === "folder" ? node.children : null);
export const keyOf = (node: FileNode): string => node.key;

const leaf = (file: FileChange): FileLeaf => ({ kind: "file", key: fileKey(file.path), name: fileName(file), path: file.path, folder: folderOf(file.path), file });

function folderNode(folder: Folder): FolderNode {
  return {
    kind: "folder",
    key: folderKey(folder.path),
    name: folder.name,
    path: folder.path,
    children: [...folder.folders.map(folderNode), ...folder.files.map(leaf)],
    files: everyFile(folder),
  };
}

// The same list of files is often arranged twice (the view that sizes the sections, and the tree itself): the answer is
// kept for as long as the list itself lives.
const arranged = new WeakMap<readonly FileChange[], Partial<Record<FileTreeMode, readonly FileNode[]>>>();

/** The top-level rows of `files`: folders then files (tree), or every file in path order (list). */
export function fileNodes(files: readonly FileChange[], mode: FileTreeMode): readonly FileNode[] {
  const known = arranged.get(files);
  const hit = known?.[mode];
  if (hit) return hit;
  let nodes: readonly FileNode[];
  if (mode === "list") {
    nodes = [...files].sort((a, b) => inOrder(a.path, b.path)).map(leaf);
  } else {
    const root = tree(files);
    nodes = [...root.folders.map(folderNode), ...root.files.map(leaf)];
  }
  arranged.set(files, { ...known, [mode]: nodes });
  return nodes;
}

/** The keys of every folder in `nodes`, however deep. */
export function folderKeys(nodes: readonly FileNode[]): string[] {
  const keys: string[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === "folder") {
      keys.push(node.key);
      stack.push(...node.children);
    }
  }
  return keys;
}

/** How many rows `nodes` takes with every folder open: what a section of the Changes view asks room for. */
export function rowCount(nodes: readonly FileNode[]): number {
  let count = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    count++;
    if (node.kind === "folder") stack.push(...node.children);
  }
  return count;
}

/** The colour of the dot after a folder, as upstream's: a conflict wins, then all added, else modified. */
export function folderTone(files: readonly FileChange[]): "danger" | "success" | "warning" {
  if (files.some((file) => file.status === "U")) return "danger";
  if (files.length > 0 && files.every((file) => file.status === "A" || file.status === "?")) return "success";
  return "warning";
}

/**
 * The files whose path holds `query`, ignoring case; every file for an empty query (the same array, so that what was
 * arranged for it is kept).
 */
export function filterFiles(files: readonly FileChange[], query: string): readonly FileChange[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return files;
  return files.filter((file) => file.path.toLowerCase().includes(needle) || (file.from !== undefined && file.from.toLowerCase().includes(needle)));
}
