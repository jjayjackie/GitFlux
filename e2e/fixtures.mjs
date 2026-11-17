// Creates the deterministic e2e workspace (no network, no user configuration, fixed identities and dates, so hashes
// and screenshots are stable from run to run):
//
//   <root>/workspace                main repository: ~25 commits on main, feature/login, feature/search, release/1.0;
//                                   a merge commit; tags v0.9.0 (lightweight) and v1.0.0 (annotated); a stash; staged,
//                                   unstaged and untracked changes; origin = <root>/remotes/app.git with main ahead 2
//                                   and behind 1; submodule vendor/lib
//   <root>/workspace/packages/tools a nested repository two levels down
//   <root>/worktrees/search         a linked worktree of the main repository on feature/search
//   <root>/conflict                 a second repository with a merge stopped on a conflict in greeting.txt
//   <root>/remotes/app.git, lib.git bare repositories (origin, and the submodule's source)
//
//   node e2e/fixtures.mjs [<root>]          (default: $E2E_FIXTURE_ROOT, else <tmp>/advanced-git-e2e-fixtures)
//
// The root is deleted and recreated; it must be inside the temp directory or this repository's tmp/.

import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedGitEnv } from "../scripts/git-env.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(process.argv[2] ?? process.env.E2E_FIXTURE_ROOT ?? join(realpathSync(tmpdir()), "advanced-git-e2e-fixtures"));
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
};
if (!inside(realpathSync(tmpdir()), root) && !inside(resolve(tmpdir()), root) && !inside(join(repository, "tmp"), root)) {
  console.error(`fixtures: refusing to use ${root}: it must be inside ${tmpdir()} or ${join(repository, "tmp")}`);
  process.exit(1);
}

const env = isolatedGitEnv();
const AUTHORS = [
  ["Ada Example", "ada@example.com"],
  ["Lin Example", "lin@example.com"],
  ["Sam Example", "sam@example.com"],
];
const START = Date.UTC(2024, 0, 15, 9, 0, 0) / 1000;
let tick = 0;

/** Runs git; every run sees the current fixed date. @param {string} cwd @param {string[]} args */
function git(cwd, args, { allowFailure = false, author = 0 } = {}) {
  const date = `${START + tick * 3600} +0000`;
  const [name, email] = AUTHORS[author % AUTHORS.length];
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${args.join(" ")} (in ${cwd}) failed with ${result.status}:\n${result.stderr}`);
  return result;
}

/** @param {string} base @param {string} path @param {string} text */
function write(base, path, text) {
  const file = join(base, ...path.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

let commits = 0;
/** Stages everything and commits at the next tick. @param {string} cwd @param {string} message */
function commit(cwd, message, author = commits) {
  git(cwd, ["add", "-A"]);
  tick++;
  git(cwd, ["commit", "-q", "-m", message], { author });
  commits++;
}

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const workspace = join(root, "workspace");
const remotes = join(root, "remotes");
const scratch = join(root, ".scratch");
const origin = join(remotes, "app.git");

// --- the submodule's source -----------------------------------------------------------------------------------------
const libSource = join(scratch, "lib");
git(root, ["init", "-q", "-b", "main", libSource]);
write(libSource, "README.md", "# lib\n\nA small vendored library.\n");
write(libSource, "index.js", "export const version = '1.0.0';\n");
commit(libSource, "Create the library");
write(libSource, "index.js", "export const version = '1.1.0';\nexport const name = 'lib';\n");
commit(libSource, "Export the library name");
git(root, ["clone", "-q", "--bare", libSource, join(remotes, "lib.git")]);

// --- the main repository ------------------------------------------------------------------------------------------
git(root, ["init", "-q", "--bare", "-b", "main", origin]);
git(root, ["init", "-q", "-b", "main", workspace]);
git(workspace, ["remote", "add", "origin", origin]);

write(workspace, "README.md", "# Demo app\n\nA small application used by the Advanced Git end-to-end tests.\n");
write(workspace, ".gitignore", "node_modules/\n*.log\n");
commit(workspace, "Initial commit");
write(workspace, "src/app.js", "import { slugify } from './util.js';\n\nexport function main(argv) {\n  return argv.map(slugify);\n}\n");
commit(workspace, "Add the application entry point");
write(workspace, "src/util.js", "export function slugify(text) {\n  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');\n}\n");
commit(workspace, "Add string utilities");
write(workspace, "docs/guide.md", "# Guide\n\nRun the app with a list of words.\n");
commit(workspace, "Write the user guide");
git(workspace, ["tag", "v0.9.0"]);
write(workspace, "src/config.js", "export function load(text) {\n  return JSON.parse(text);\n}\n");
commit(workspace, "Add a configuration loader");
tick++;
git(workspace, ["submodule", "add", "-q", "../lib.git", "vendor/lib"]);
commit(workspace, "Vendor the library as a submodule");
write(workspace, "src/config.js", "export function load(text) {\n  if (!text) return {};\n  return JSON.parse(text);\n}\n");
commit(workspace, "Handle a missing configuration");
git(workspace, ["branch", "release/1.0"]);
write(workspace, "test/app.test.js", "import { main } from '../src/app.js';\n\nconsole.assert(main(['A B'])[0] === 'a-b');\n");
commit(workspace, "Add a test");
write(workspace, "docs/guide.md", "# Guide\n\nRun the app with a list of words.\n\n## Configuration\n\nPass a JSON file.\n");
commit(workspace, "Document the configuration");
git(workspace, ["branch", "feature/login"]);
git(workspace, ["branch", "feature/search"]);

git(workspace, ["switch", "-q", "release/1.0"]);
write(workspace, "src/app.js", "import { slugify } from './util.js';\n\nexport function main(argv = []) {\n  return argv.map(slugify);\n}\n");
commit(workspace, "Fix a crash on empty input");
write(workspace, "CHANGELOG.md", "# Changelog\n\n## 1.0.0\n\n- First release.\n");
commit(workspace, "Prepare the 1.0.0 release");
tick++;
git(workspace, ["tag", "-a", "v1.0.0", "-m", "Release 1.0.0"]);

git(workspace, ["switch", "-q", "feature/login"]);
for (const [file, message] of [
  ["src/login/form.js", "Add the login form"],
  ["src/login/validate.js", "Validate credentials"],
  ["src/login/session.js", "Remember the session"],
  ["src/login/logout.js", "Add logout"],
]) {
  write(workspace, file, `// ${message}\nexport default function () {}\n`);
  commit(workspace, message);
}

git(workspace, ["switch", "-q", "feature/search"]);
for (const [file, message] of [
  ["src/search/index.js", "Add a search index"],
  ["src/search/rank.js", "Rank search results"],
  ["src/search/highlight.js", "Highlight matches"],
]) {
  write(workspace, file, `// ${message}\nexport default function () {}\n`);
  commit(workspace, message);
}

git(workspace, ["switch", "-q", "main"]);
write(workspace, "package.json", '{\n  "name": "demo-app",\n  "version": "1.1.0",\n  "type": "module"\n}\n');
commit(workspace, "Add package metadata");
write(workspace, "src/config.js", "export function load(text) {\n  if (!text) return {};\n  try {\n    return JSON.parse(text);\n  } catch (error) {\n    throw new Error(`Invalid configuration: ${error.message}`);\n  }\n}\n");
commit(workspace, "Improve configuration errors");
tick++;
git(workspace, ["merge", "-q", "--no-ff", "-m", "Merge branch 'feature/login'", "feature/login"]);
commits++;
write(workspace, "CONTRIBUTING.md", "# Contributing\n\nOpen a pull request.\n");
commit(workspace, "Add a contributing guide");

// Publish, then let origin move on by one commit made elsewhere: main becomes behind 1.
git(workspace, ["push", "-q", "-u", "origin", "main"]);
git(workspace, ["push", "-q", "origin", "release/1.0", "feature/login", "feature/search"]);
git(workspace, ["push", "-q", "origin", "--tags"]);
const elsewhere = join(scratch, "elsewhere");
git(root, ["clone", "-q", origin, elsewhere]);
write(elsewhere, "README.md", "# Demo app\n\nA small application used by the Advanced Git end-to-end tests.\n\nSee docs/guide.md.\n");
commit(elsewhere, "Point the README at the guide", 2);
git(elsewhere, ["push", "-q", "origin", "main"]);
git(workspace, ["fetch", "-q", "origin"]);

// Two local commits not yet pushed: ahead 2.
write(workspace, "src/health.js", "export function health() {\n  return { ok: true };\n}\n");
commit(workspace, "Add a health check");
write(workspace, "src/app.js", "import { slugify } from './util.js';\n\nexport function main(argv) {\n  console.log('started');\n  return argv.map(slugify);\n}\n");
commit(workspace, "Log startup");

// A stash, then the working tree's own changes.
write(workspace, "src/util.js", "export function slugify(text) {\n  return text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-');\n}\n");
tick++;
git(workspace, ["stash", "push", "-q", "-m", "WIP: normalise before slugifying"]);
write(workspace, "src/app.js", "import { slugify } from './util.js';\n\nexport function main(argv) {\n  console.log('started at', Date.now());\n  return argv.map(slugify);\n}\n");
write(workspace, "src/flags.js", "export const flags = { search: false };\n");
git(workspace, ["add", "src/app.js", "src/flags.js"]);
write(workspace, "README.md", "# Demo app\n\nA small application used by the Advanced Git end-to-end tests.\n\nRun `node src/app.js`.\n");
write(workspace, "docs/guide.md", "# Guide\n\nRun the app with a list of words.\n\n## Configuration\n\nPass a JSON file, or nothing.\n");
rmSync(join(workspace, "test", "app.test.js"));
write(workspace, "notes.txt", "Remember to update the changelog.\n");
write(workspace, "scratch/todo.md", "- [ ] search\n- [ ] login\n");

// A linked worktree on feature/search.
git(workspace, ["worktree", "add", "-q", join(root, "worktrees", "search"), "feature/search"]);

// A nested repository two levels down.
const nested = join(workspace, "packages", "tools");
git(root, ["init", "-q", "-b", "main", nested]);
write(nested, "README.md", "# tools\n\nBuild helpers.\n");
commit(nested, "Create the tools package", 1);
write(nested, "build.js", "export function build() {}\n");
commit(nested, "Add a build helper", 1);

// A second repository with a merge stopped on a conflict.
const conflict = join(root, "conflict");
git(root, ["init", "-q", "-b", "main", conflict]);
write(conflict, "greeting.txt", "Hello\n");
write(conflict, "other.txt", "Unchanged\n");
commit(conflict, "Create the greeting", 0);
git(conflict, ["switch", "-q", "-c", "topic"]);
write(conflict, "greeting.txt", "Hello from topic\n");
commit(conflict, "Greet from topic", 1);
git(conflict, ["switch", "-q", "main"]);
write(conflict, "greeting.txt", "Hello from main\n");
commit(conflict, "Greet from main", 2);
tick++;
const merge = git(conflict, ["merge", "--no-edit", "topic"], { allowFailure: true });
if (merge.status !== 1) throw new Error(`fixtures: expected the merge to stop on a conflict, git exited ${merge.status}:\n${merge.stdout}${merge.stderr}`);

rmSync(scratch, { recursive: true, force: true });

const paths = {
  root,
  workspace,
  nested,
  submodule: join(workspace, "vendor", "lib"),
  worktree: join(root, "worktrees", "search"),
  conflict,
  origin,
};
writeFileSync(join(root, "fixture.json"), JSON.stringify(paths, null, 2) + "\n");
const status = git(workspace, ["status", "--short", "--branch"]).stdout.trim();
console.log(`fixtures: ${commits} commits under ${root}\n${status}`);
