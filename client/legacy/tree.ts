// Arranges changed files as a tree of folders, the way VS Code's "View as Tree" does: folders
// before files, both in name order, and a chain of folders with nothing else in them as one row.

import type { FileChange } from "../../shared/git";

export interface Folder {
  name: string; // a chain of folders reads "outer/inner"
  path: string; // from the repository's root
  folders: Folder[];
  files: FileChange[]; // the files directly inside
}

const inOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
export const fileName = (file: FileChange) => file.path.slice(file.path.lastIndexOf("/") + 1);

/** Merges the chains below a folder and puts its contents in order. */
function tidy(folder: Folder): Folder {
  const folders = folder.folders
    .map(tidy)
    .map((child) => (child.folders.length === 1 && !child.files.length ? { ...child.folders[0], name: `${child.name}/${child.folders[0].name}` } : child))
    .sort((a, b) => inOrder(a.name, b.name));
  return { ...folder, folders, files: [...folder.files].sort((a, b) => inOrder(fileName(a), fileName(b))) };
}

/** The repository's root, holding the files at the top level and the folders of the rest. */
export function tree(files: FileChange[]): Folder {
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
