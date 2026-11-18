// Helpers for the stash, worktree, submodule, file-history and blame tests: commits by a named person, a local bare
// repository to serve as a submodule's remote, a parent repository with submodules, and folders for new work trees.
// Everything goes through `git` with an argv array, in throwaway folders (test/helpers/repo.ts).

import "./env.ts";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { bareRemote, dates, fileUrl, gitIn, repoAt, repository, tempDir, type Repo } from "./repo.ts";

/** Writes `files` (path → text), stages everything and commits as `person` (author and committer); returns the commit. */
export function commitAs(repo: Repo, person: string, message: string, files: Record<string, string>, time?: number): string {
  for (const [path, text] of Object.entries(files)) repo.write(path, text);
  gitIn(repo.cwd, ["add", "--all"]);
  const email = `${person.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`;
  gitIn(repo.cwd, ["commit", "--quiet", "--allow-empty", `--message=${message}`], {
    GIT_AUTHOR_NAME: person,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: person,
    GIT_COMMITTER_EMAIL: email,
    ...(time === undefined ? {} : dates(time)),
  });
  return repo.head();
}

export interface Library {
  /** The bare repository: the submodule's remote. */
  remote: string;
  /** The repository that pushes to it. */
  work: Repo;
  /** Its first commit. */
  first: string;
}

/** A bare repository on `main` holding one commit (lib.txt), and the work repository that pushed it. */
export function libraryRemote(t: TestContext): Library {
  const remote = bareRemote(t);
  const work = repository(t, "gitflux-lib-");
  work.write("lib.txt", "one\n");
  const first = work.commit("lib: one");
  work.git("remote", "add", "origin", fileUrl(remote));
  work.git("push", "--quiet", "origin", "main");
  return { remote, work, first };
}

/** Pushes a new commit to the library's remote; returns it. */
export function advanceLibrary(library: Library, text: string): string {
  library.work.write("lib.txt", text);
  const commit = library.work.commit(`lib: ${text.trim()}`);
  library.work.git("push", "--quiet", "origin", "main");
  return commit;
}

/** A parent repository with a commit, and the submodules `paths` cloned from `remote`, committed. */
export function parentWith(t: TestContext, remote: string, paths: readonly string[]): Repo {
  const parent = repository(t, "gitflux-parent-");
  parent.write("README.md", "parent\n");
  parent.commit("root");
  for (const path of paths) parent.git("submodule", "add", "--quiet", fileUrl(remote), path);
  parent.commit("add submodules");
  return parent;
}

/** A clone of `parent` whose submodules are not initialised (registered in .gitmodules, no work tree yet). */
export function cloneWithoutSubmodules(t: TestContext, parent: Repo): Repo {
  const folder = tempDir(t, "gitflux-parent-clone-");
  const root = join(folder, "clone");
  gitIn(folder, ["clone", "--quiet", fileUrl(parent.cwd), root]);
  return repoAt(realpathSync.native(root));
}

/** A path for a new work tree, not created yet, inside a new empty folder. */
export function newFolder(t: TestContext, name: string): string {
  return join(tempDir(t, "gitflux-wt-"), name);
}
