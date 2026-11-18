// Looks for repositories in throwaway folders, against what VS Code lists for the same layout, and beyond it: nested
// repositories at any depth, submodules (initialised or not) and linked worktrees.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { after, test, type TestContext } from "node:test";
import { repoDiscoverRpc } from "../../shared/rpc/repo.ts";
import type { Repository } from "../../shared/schemas.ts";
import { failure, startPlugin } from "../helpers/plugin.ts";
import { addSubmodule, addWorktree, fileUrl, gitIn, gitTry, repoAt, repository, tempDir } from "../helpers/repo.ts";

const plugin = startPlugin();
after(() => plugin.stop());
const discover = (cwd: string, includeParent = true) => plugin.call(repoDiscoverRpc, { cwd, includeParent });

/** A temporary folder. `repo` makes a repository below it, `settings` writes its .vscode/settings.json. */
function workspace(t: TestContext) {
  const top = tempDir(t, "gitflux-workspace-");
  const at = (path: string) => (path === "." ? top : join(top, ...path.split("/")));
  const folder = (path: string) => mkdirSync(at(path), { recursive: true });
  const repo = (path: string) => {
    folder(path);
    gitIn(at(path), ["init", "--quiet", "--initial-branch=main"]);
    return repoAt(at(path));
  };
  const settings = (path: string, text: string) => {
    folder(`${path}/.vscode`);
    writeFileSync(join(at(path), ".vscode", "settings.json"), text);
  };
  const below = (root: string) => (root === top ? "." : root.slice(top.length + 1).split(/[\\/]/).join("/"));
  /** What is listed for a folder, by path below the temporary folder. */
  const list = async (path: string) => {
    const found = await discover(at(path));
    return { listed: found.repositories.map((repository) => below(repository.root)), offered: found.parent && below(found.parent.root) };
  };
  return { top, at, folder, repo, settings, list, below };
}

test("the folder's own repository and those below it, nested at any depth by default", async (t) => {
  const { repo, folder, list, top } = workspace(t);
  repo(".");
  repo("b");
  repo("a");
  repo("a/nested"); // two levels down
  repo("a/nested/deeper"); // three
  repo("node_modules/package"); // inside an ignored folder
  folder("plain");
  assert.deepEqual(await list("."), { listed: [".", "a", "b", "a/nested", "a/nested/deeper"], offered: null });

  const found = await discover(top);
  const [own] = found.repositories;
  // The repositories below are untracked folders to this one, and so changes.
  assert.deepEqual(own, {
    root: top,
    name: basename(top),
    branch: "main",
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    changed: true,
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
  });
  const byName = new Map(found.repositories.map((repository) => [repository.name, repository]));
  assert.equal(byName.get("deeper")?.depth, 3);
  assert.equal(byName.get("deeper")?.parent, join(top, "a", "nested"));
  assert.equal(byName.get("nested")?.parent, join(top, "a"));
  assert.equal(byName.get("a")?.parent, top);
  assert.equal(found.truncated, false);
});

test("the scan depth the folder's settings set is honoured", async (t) => {
  const { repo, settings, list } = workspace(t);
  repo(".");
  repo("a");
  repo("a/nested");
  settings(".", `{ "git.repositoryScanMaxDepth": 1 }`);
  assert.deepEqual((await list(".")).listed, [".", "a"]);
});

test("a repository git cannot read is listed with why, and does not hide the others", async (t) => {
  const { repo, folder, at, list, top } = workspace(t);
  repo("good");
  folder("broken");
  writeFileSync(join(at("broken"), ".git"), "gitdir: nowhere\n"); // a worktree whose repository is gone
  assert.deepEqual((await list(".")).listed, ["broken", "good"]);
  const [broken, good] = (await discover(top)).repositories;
  assert.equal(typeof broken.failed, "string");
  assert.notEqual(broken.failed, "");
  assert.equal(good.failed, null);
});

test("a folder inside a repository lists what is below it, and only offers the repository above", async (t) => {
  const { repo, folder, list, at } = workspace(t);
  repo("outer");
  folder("outer/work/notes");
  repo("outer/work/child");
  assert.deepEqual(await list("outer/work"), { listed: ["outer/work/child"], offered: "outer" });
  assert.deepEqual(await list("outer/work/notes"), { listed: [], offered: "outer" });
  assert.equal((await discover(at("outer/work"), false)).parent, null); // not looked for
});

test("the folder's settings: no scanning, and the repositories it names", async (t) => {
  const { repo, folder, settings, list } = workspace(t);
  repo(".");
  repo("a"); // one level down, but scanning is off
  repo("deep/er/repo");
  folder("deep/er/repo/src");
  folder("plain");
  settings(
    ".",
    `{
      // only the repositories named here
      "git.repositoryScanMaxDepth": 0,
      "git.autoRepositoryDetection": "subFolders",
      "git.scanRepositories": [
        "deep/er/repo/src", /* a folder inside a repository stands for that repository */
        "plain",
        "missing",
      ],
      "editor.tabSize": 2
    }`,
  );
  assert.deepEqual(await list("."), { listed: [".", "deep/er/repo"], offered: null });
});

test("deeper scanning, ignored repositories, and repositories above the folder", async (t) => {
  const { repo, settings, list } = workspace(t);
  repo("outer");
  repo("outer/work/a");
  repo("outer/work/a/nested");
  repo("outer/work/b");

  settings("outer/work", `{ "git.repositoryScanMaxDepth": -1, "git.ignoredRepositories": ["b"], "git.openRepositoryInParentFolders": "always" }`);
  assert.deepEqual(await list("outer/work"), { listed: ["outer", "outer/work/a", "outer/work/a/nested"], offered: null });

  settings("outer/work", `{ "git.openRepositoryInParentFolders": "never" }`);
  assert.deepEqual(await list("outer/work"), { listed: ["outer/work/a", "outer/work/b", "outer/work/a/nested"], offered: null });

  settings("outer/work", `{ "git.autoRepositoryDetection": false }`);
  assert.deepEqual(await list("outer/work"), { listed: [], offered: "outer" });
});

test("a detached HEAD has no branch", async (t) => {
  const { repo, top } = workspace(t);
  const own = repo(".");
  own.commit("first");
  own.git("switch", "--quiet", "--detach");
  const [detached] = (await discover(top)).repositories;
  assert.equal(detached.branch, null);
  assert.equal(detached.head, own.head());
});

test("how far a branch is from its upstream", async (t) => {
  const { repo, at, top } = workspace(t);
  const origin = repo("origin");
  origin.commit("first");
  gitIn(top, ["clone", "--quiet", "origin", "clone"]);
  const cloned = repoAt(at("clone"));
  origin.commit("theirs");
  origin.commit("theirs too");
  cloned.commit("mine");

  const read = async () => {
    const { upstream, ahead, behind } = (await discover(top)).repositories.find((repository) => repository.name === "clone")!;
    return { upstream, ahead, behind };
  };
  assert.deepEqual(await read(), { upstream: "origin/main", ahead: 1, behind: 0 }); // what the upstream has gained is not known before a fetch
  cloned.git("fetch", "--quiet");
  assert.deepEqual(await read(), { upstream: "origin/main", ahead: 1, behind: 2 });
});

test("what is pending, as VS Code marks it beside the branch", async (t) => {
  const { repo, top } = workspace(t);
  const own = repo(".");
  const read = async () => {
    const { changed, staged, merging, conflicted, operation } = (await discover(top)).repositories[0];
    return { changed, staged, merging, conflicted, operation };
  };
  own.write("file.txt", "first\n");
  assert.deepEqual(await read(), { changed: true, staged: false, merging: false, conflicted: false, operation: null }); // untracked
  own.git("add", "file.txt");
  assert.deepEqual(await read(), { changed: false, staged: true, merging: false, conflicted: false, operation: null });
  own.commit("first");
  assert.deepEqual(await read(), { changed: false, staged: false, merging: false, conflicted: false, operation: null });

  own.git("switch", "--quiet", "--create", "other");
  own.write("file.txt", "theirs\n");
  own.commit("theirs");
  own.git("switch", "--quiet", "main");
  own.write("file.txt", "ours\n");
  own.commit("ours");
  assert.equal(own.tryGit("merge", "other"), false); // a conflict
  // The file in conflict is neither changed nor staged.
  assert.deepEqual(await read(), { changed: false, staged: false, merging: true, conflicted: true, operation: "merge" });
  own.git("merge", "--abort");
  assert.deepEqual(await read(), { changed: false, staged: false, merging: false, conflicted: false, operation: null });
});

test("a settings file that cannot be used is reported", async (t) => {
  const { repo, settings, at } = workspace(t);
  repo(".");
  settings(".", `{ "git.scanRepositories": [ `);
  await assert.rejects(discover(at(".")), /settings\.json cannot be read/);
  settings(".", `{ "git.scanRepositories": "claude-plugins" }`);
  await assert.rejects(discover(at(".")), /settings\.json: .*git\.scanRepositories/s);
});

test("submodules, initialised and not, are listed with their parent", async (t) => {
  const source = repository(t, "gitflux-module-");
  source.write("lib.txt", "lib\n");
  source.commit("lib");
  const { repo, top } = workspace(t);
  const parent = repo("app");
  parent.write("app.txt", "app\n");
  parent.commit("app");
  addSubmodule(parent, source.cwd, "vendor/lib");

  // A clone of the parent has the submodule registered but not initialised.
  gitIn(top, ["clone", "--quiet", fileUrl(parent.cwd), "copy"]);

  const found = await discover(top);
  const byRoot = new Map<string, Repository>(found.repositories.map((repository) => [repository.root, repository]));
  const initialised = byRoot.get(join(top, "app", "vendor", "lib"));
  assert.ok(initialised, "the initialised submodule is listed");
  assert.equal(initialised.kind, "submodule");
  assert.equal(initialised.parent, join(top, "app"));
  assert.equal(initialised.initialized, true);
  assert.equal(initialised.depth, 3);
  assert.match(initialised.head ?? "", /^[0-9a-f]{40}$/);

  const empty = byRoot.get(join(top, "copy", "vendor", "lib"));
  assert.ok(empty, "the uninitialised submodule is listed");
  assert.deepEqual([empty.kind, empty.parent, empty.initialized, empty.failed, empty.head], ["submodule", join(top, "copy"), false, null, null]);
  const roots = found.repositories.map((repository) => repository.root);
  assert.ok(roots.indexOf(join(top, "app")) < roots.indexOf(join(top, "app", "vendor", "lib")), "a parent before its children");
  assert.equal(new Set(roots).size, roots.length, "each listed once");
});

test("linked worktrees are listed with their main work tree, inside the folder or not", async (t) => {
  const { repo, top, at } = workspace(t);
  const main = repo("main");
  main.write("a.txt", "a\n");
  main.commit("root");
  main.git("worktree", "add", "--quiet", "-b", "inside", at("wt-inside"));
  const outside = addWorktree(t, main, "outside");

  const found = await discover(top);
  const byRoot = new Map<string, Repository>(found.repositories.map((repository) => [repository.root, repository]));
  assert.equal(byRoot.get(at("main"))?.kind, "repository");
  const inside = byRoot.get(at("wt-inside"));
  assert.equal(inside?.kind, "worktree");
  assert.equal(inside?.mainRoot, at("main"));
  assert.equal(inside?.branch, "inside");
  const far = byRoot.get(outside);
  assert.equal(far?.kind, "worktree");
  assert.equal(far?.mainRoot, at("main"));
  assert.equal(far?.depth, 0);
  const roots = found.repositories.map((repository) => repository.root);
  assert.equal(new Set(roots).size, roots.length, "each listed once");
});

test("a workspace folder that is not there is refused", async (t) => {
  const { at } = workspace(t);
  assert.equal((await failure(discover(at("missing")))).code, "INVALID_ARGUMENT");
  // A folder that is no repository is a workspace with nothing in it.
  assert.equal(gitTry(at("."), ["rev-parse", "--git-dir"]), false);
  assert.deepEqual(await discover(at(".")), { repositories: [], parent: null, truncated: false });
});
