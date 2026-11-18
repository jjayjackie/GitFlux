// Finding a workspace folder's repositories, and reading one repository's state.
//
// Discovery follows VS Code's git extension, reading the same settings from the folder's .vscode/settings.json:
//
// - the repository at the folder itself;
// - the repositories in its subfolders: `git.repositoryScanMaxDepth` levels down when the folder's settings set it
//   (-1: no limit), else down to SCAN_MAX_DEPTH, never opening more than SCAN_MAX_FOLDERS folders;
// - the repositories named in `git.scanRepositories`;
// - none of those in `git.ignoredRepositories`;
// - a repository whose root lies above the folder only under `git.openRepositoryInParentFolders: "always"`.
//   Otherwise it is offered (`parent`), unless "never";
// - and beyond VS Code: every submodule of a listed repository, initialised or not, and its linked worktrees.
//
// The status is read as VS Code reads it: `git status --porcelain=v2`, stopped after STATUS_LIMIT files.
//
// `scan` is adapted from traverseWorkspaceFolder in VS Code 1.142.0's extensions/git/src/model.ts, and `baseOf` and
// `createdFrom` from getBranchBase and getBranchBaseFromReflog in its extensions/git/src/repository.ts.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt
//
// Exported for the other domains and the unit tests: readPorcelain, parseStatus, parseStatusRecords, operationKindOf,
// readOperation, readSmall, uncommented, commitTemplate, baseOf, parseWorktrees.

import { createHash } from "node:crypto";
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import stripJsonComments from "strip-json-comments";
import { z } from "zod";
import { MESSAGE_MAX, SCAN_MAX_DEPTH, SCAN_MAX_FOLDERS, SCAN_MAX_REPOSITORIES, STATUS_LIMIT } from "../shared/limits.ts";
import { repoDiscoverRpc, repoStatusRpc } from "../shared/rpc/repo.ts";
import type { ConflictKind, FileChange, Operation, OperationState, Repository, Status } from "../shared/schemas.ts";
import { GitError } from "./core/errors.ts";
import { mapLimit, type GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { redact } from "./core/sanitize.ts";
import { realOrSelf, repoDirs, samePathText, within, withinReal } from "./core/validate.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, repoDiscoverRpc, { kind: "read", cwd: "workspace" }, (input, ctx) => discover(ctx, input.includeParent));
  handle(server, deps, repoStatusRpc, { kind: "read" }, (_input, ctx) => status(ctx));
}

// --- small files git keeps -------------------------------------------------------------------

const SMALL_FILE_MAX = 256 * 1024;

/** The start of a file (at most `max` bytes) as text, or null when it cannot be read. */
export async function readSmall(path: string, max: number = SMALL_FILE_MAX): Promise<string | null> {
  let file;
  try {
    file = await open(path, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(max);
    const { bytesRead } = await file.read(buffer, 0, max, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await file.close().catch(() => {});
  }
}

/** The same, synchronously, for the few bytes discovery reads per repository. */
function readStart(path: string, max: number): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(max);
    const read = readSync(fd, buffer, 0, max, 0);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** VS Code's stripCommitMessageComments. */
export const uncommented = (text: string) => text.replace(/^\s*#.*$\n?/gm, "").trim();

// --- status ---------------------------------------------------------------------------------------

export interface ParsedStatus {
  branch: string | null;
  head: string | null;
  detached: boolean;
  upstream: string | null;
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  stashCount: number;
  conflicts: FileChange[];
  staged: FileChange[];
  changes: FileChange[];
}

const CONFLICT_KINDS: ReadonlySet<string> = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const moved = (letter: string) => letter === "R" || letter === "C";

/** Reads the NUL-separated records of `git status --porcelain=v2 --branch --show-stash -z`. */
export function parseStatusRecords(entries: readonly string[]): ParsedStatus {
  const status: ParsedStatus = {
    branch: null,
    head: null,
    detached: false,
    upstream: null,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    stashCount: 0,
    conflicts: [],
    staged: [],
    changes: [],
  };
  let ab = false; // branch.ab is printed only when the upstream exists
  for (let n = 0; n < entries.length; n++) {
    const entry = entries[n];
    if (entry === "") continue;
    const parts = entry.split(" ");
    if (parts[0] === "#") {
      const value = parts.slice(2).join(" ");
      if (parts[1] === "branch.oid") status.head = value === "(initial)" ? null : value;
      else if (parts[1] === "branch.head") {
        status.detached = value === "(detached)";
        status.branch = status.detached ? null : value;
      } else if (parts[1] === "branch.upstream") status.upstream = value;
      else if (parts[1] === "branch.ab") {
        ab = true;
        status.ahead = Math.abs(Number(parts[2])) || 0;
        status.behind = Math.abs(Number(parts[3])) || 0;
      } else if (parts[1] === "stash") status.stashCount = Number(parts[2]) || 0;
    } else if (parts[0] === "1" || parts[0] === "2") {
      // "<type> <XY> … <path>": X is the index against HEAD, Y the working tree against the index.
      const renamed = parts[0] === "2";
      const xy = parts[1] ?? "..";
      const index = xy[0] ?? ".";
      const tree = xy[1] ?? ".";
      const path = parts.slice(renamed ? 9 : 8).join(" ");
      const from = renamed ? entries[++n] : undefined;
      if (index !== ".") status.staged.push({ path, status: index, ...(moved(index) && from !== undefined && { from }) });
      if (tree !== ".") status.changes.push({ path, status: tree, ...(moved(tree) && from !== undefined && { from }) });
    } else if (parts[0] === "u") {
      const kind = parts[1] ?? "UU";
      status.conflicts.push({ path: parts.slice(10).join(" "), status: "U", ...(CONFLICT_KINDS.has(kind) && { conflict: kind as ConflictKind }) });
    } else if (parts[0] === "?") {
      status.changes.push({ path: entry.slice(2), status: "?" });
    }
  }
  status.upstreamGone = status.upstream !== null && !ab;
  return status;
}

/** Reads the whole output of `git status --porcelain=v2 --branch -z`. */
export function parseStatus(out: string): ParsedStatus {
  return parseStatusRecords(out.split("\0"));
}

/**
 * Reads `git status --porcelain=v2 --branch --show-stash -z` as it comes, and stops git, as VS Code does, once more
 * than STATUS_LIMIT files are listed: a folder of untracked files can hold hundreds of thousands, and listing them all
 * chokes the panel. `cut` tells whether files were left out.
 */
export async function readPorcelain(tools: GitTools, untracked: "all" | "normal"): Promise<{ records: string[]; cut: boolean }> {
  const records: string[] = [];
  let files = 0;
  let renamed = false; // the next record is the old path of a rename, which ends its entry
  let cut = false;
  await tools.stream(["status", "--porcelain=v2", "--branch", "--show-stash", "-z", `--untracked-files=${untracked}`], {
    delimiter: "\0",
    onRecord: (record) => {
      if (renamed) {
        renamed = false;
        records.push(record);
        return true;
      }
      if (record === "" || record.startsWith("#")) {
        records.push(record);
        return true;
      }
      if (++files > STATUS_LIMIT) {
        cut = true;
        return false;
      }
      records.push(record);
      renamed = record.startsWith("2 ");
      return true;
    },
  });
  return { records, cut };
}

// --- what is under way ------------------------------------------------------------------------------

const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const hashIn = (text: string | null) => {
  const value = (text ?? "").trim();
  return HASH.test(value) ? value : null;
};
const countIn = (text: string | null) => {
  const value = (text ?? "").trim();
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
};

/** The kind of the sequencer's pending operation (a multi-commit cherry-pick or revert between two commits). */
function sequencerKind(gitDir: string): Operation {
  const todo = readStart(join(gitDir, "sequencer", "todo"), 4096) ?? "";
  const first = todo.split("\n").find((line) => line.trim() !== "" && !line.trimStart().startsWith("#")) ?? "";
  return /^\s*(?:revert|r)\b/.test(first) ? "revert" : "cherry-pick";
}

/** What is under way in the work tree whose git dir is `gitDir`, from the files git keeps there; no git is run. */
export function operationKindOf(gitDir: string): Operation | null {
  const at = (name: string) => existsSync(join(gitDir, name));
  if (at("rebase-merge")) return "rebase";
  if (at("rebase-apply")) return at(join("rebase-apply", "applying")) ? "am" : "rebase";
  if (at("MERGE_HEAD")) return "merge";
  if (at("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (at("REVERT_HEAD")) return "revert";
  if (at(join("sequencer", "todo"))) return sequencerKind(gitDir);
  if (at("BISECT_LOG")) return "bisect";
  return null;
}

/** A commit's full message, as `%B` prints it, without the trailing newline. */
async function messageOf(tools: GitTools, hash: string): Promise<string | null> {
  try {
    return (await tools.read(["log", "-1", "--format=%B", hash, "--"])).trimEnd();
  } catch {
    return null;
  }
}

/** The operation under way, read as git lays out rebase-merge/, rebase-apply/ and the *_HEAD files. */
export async function readOperation(tools: GitTools, gitDir: string, conflicted: boolean): Promise<OperationState | null> {
  const kind = operationKindOf(gitDir);
  if (kind === null) return null;
  const file = (name: string) => readSmall(join(gitDir, name));
  const prepared = async () => {
    const text = uncommented(((await file("MERGE_MSG")) ?? "").slice(0, MESSAGE_MAX));
    return text === "" ? null : text;
  };
  switch (kind) {
    case "merge":
      return { kind, current: hashIn(await file("MERGE_HEAD")), message: await prepared() };
    case "cherry-pick":
      return { kind, current: hashIn(await file("CHERRY_PICK_HEAD")), message: await prepared() };
    case "revert":
      return { kind, current: hashIn(await file("REVERT_HEAD")), message: await prepared() };
    case "bisect":
      return { kind, current: hashIn(await tools.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])), message: null };
    case "am": {
      const message = uncommented(((await file(join("rebase-apply", "final-commit"))) ?? "").slice(0, MESSAGE_MAX));
      return {
        kind,
        current: null,
        message: message === "" ? null : message,
        step: countIn(await file(join("rebase-apply", "next"))),
        total: countIn(await file(join("rebase-apply", "last"))),
      };
    }
    case "rebase": {
      const merge = existsSync(join(gitDir, "rebase-merge"));
      const dir = merge ? "rebase-merge" : "rebase-apply";
      const current = hashIn(await file("REBASE_HEAD"));
      const headName = ((await file(join(dir, "head-name"))) ?? "").trim();
      const amend = merge && existsSync(join(gitDir, "rebase-merge", "amend"));
      return {
        kind,
        current,
        message: current === null ? null : await messageOf(tools, current),
        step: countIn(await file(join(dir, merge ? "msgnum" : "next"))),
        total: countIn(await file(join(dir, merge ? "end" : "last"))),
        onto: hashIn(await file(join(dir, "onto"))),
        branch: headName.startsWith("refs/heads/") ? headName.slice("refs/heads/".length) : null,
        interactive: merge && existsSync(join(gitDir, "rebase-merge", "interactive")),
        // An `edit` leaves `amend`; a `break` stops with no commit being applied. A conflict leaves neither.
        stoppedForEdit: !conflicted && (amend || current === null),
      };
    }
  }
}

// --- the commit message to start from ----------------------------------------------------------------

/** git's commit.template, found as git finds it: "~" is the home folder, and a relative path is from the repository's root. */
export async function commitTemplate(tools: GitTools): Promise<string> {
  const set = (await tools.read(["config", "--get", "commit.template"], [1])).trim();
  if (!set) return "";
  const path = set.replace(/^~([^/]*)\//, (_, user: string) => `${user ? join(homedir(), "..", user) : homedir()}/`);
  const file = isAbsolute(path) ? path : join(tools.cwd, path);
  // As in VS Code, a template that is not there is none.
  return uncommented((await readSmall(file, MESSAGE_MAX)) ?? "");
}

const HUGE = ["node_modules"]; // VS Code's Repository.KnownHugeFolderNames

/** What VS Code offers to ignore when a repository has too many changes: the folders of HUGE at its root that git does not ignore. */
async function hugeFolders(tools: GitTools): Promise<string[]> {
  const there = HUGE.filter((name) => existsSync(join(tools.cwd, name)));
  if (!there.length) return [];
  const ignored = (await tools.read(["check-ignore", "--", ...there], [1])).split(/\r?\n/);
  return there.filter((name) => !ignored.includes(name));
}

async function status(ctx: HandlerContext): Promise<Status> {
  const [{ records, cut }, refsOut, dirs] = await Promise.all([
    readPorcelain(ctx, "all"),
    ctx.read(["for-each-ref", "--format=%(objectname) %(refname)"]),
    repoDirs(ctx.cwd),
  ]);
  const now = parseStatusRecords(records);
  const operation = await readOperation(ctx, dirs.gitDir, now.conflicts.length > 0);
  const file = async (name: string) => uncommented(((await readSmall(join(dirs.gitDir, name))) ?? "").slice(0, MESSAGE_MAX));
  const template = (await file("MERGE_MSG")) || (await file("SQUASH_MSG")) || (await commitTemplate(ctx));
  const refs = createHash("sha1").update(refsOut).digest("hex");
  // A branch without a commit yet has no reflog to read.
  const base = now.branch !== null && now.head !== null ? await knownBase(ctx, now.branch, refs) : null;
  return {
    branch: now.branch,
    head: now.head,
    detached: now.detached,
    upstream: now.upstream,
    upstreamGone: now.upstreamGone,
    base: base === now.upstream ? null : base,
    ahead: now.ahead,
    behind: now.behind,
    conflicts: now.conflicts,
    staged: now.staged,
    changes: now.changes,
    refs,
    cutAt: cut ? STATUS_LIMIT : null,
    hugeFolders: cut ? await hugeFolders(ctx) : [],
    operation,
    rebaseMessage: operation?.kind === "rebase" ? operation.message : null,
    template,
    stashCount: now.stashCount,
  };
}

// --- the branch a branch was made from -------------------------------------------------------------

const CREATED = "branch: Created from ";
const REMOTES = "refs/remotes/";

/**
 * The branch on a remote that `branch` was made from, found as VS Code finds it: the `vscode-merge-base` VS Code
 * keeps in the branch's config, else what the reflog says the branch was created from, else the default branch of
 * the default remote. VS Code writes what it finds back to the config; this reads only.
 */
export async function baseOf(tools: GitTools, branch: string): Promise<string | null> {
  const kept = (await tools.read(["config", "--get", `branch.${branch}.vscode-merge-base`], [1])).trim();
  const fromConfig = kept && (await onRemote(tools, kept, false));
  if (fromConfig) return fromConfig;
  const created = await createdFrom(tools, branch);
  const fromReflog = created && (await onRemote(tools, created, true));
  if (fromReflog) return fromReflog;
  const remotes = (await tools.read(["remote"])).split(/\r?\n/).filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (!remote) return null;
  const head = (await tools.read(["symbolic-ref", "--quiet", "--short", `${REMOTES}${remote}/HEAD`], [1])).trim();
  return head ? onRemote(tools, head, false) : null;
}

/** What the reflog says `branch` was created from, read as VS Code reads it: nothing unless it says so exactly once. */
async function createdFrom(tools: GitTools, branch: string): Promise<string | null> {
  const reflog = async (ref: string) => (await tools.read(["reflog", "show", "--format=%gs", ref, "--"], [128])).split(/\r?\n/);
  const created = (await reflog(`refs/heads/${branch}`)).filter((entry) => entry.startsWith(CREATED));
  if (created.length !== 1) return null;
  const from = created[0].slice(CREATED.length);
  if (from !== "HEAD") return from;
  // Made from HEAD: the branch HEAD left the first time it moved to this one, as "checkout: moving from <it> to <branch>".
  const moves = (await reflog("HEAD")).filter((entry) => entry.startsWith("checkout: moving from ") && entry.endsWith(` to ${branch}`));
  return moves.length ? (moves[moves.length - 1].split(" ")[3] ?? null) : null;
}

/**
 * The branch on a remote that `name` stands for, such as origin/main: the name itself when it is one, or with
 * `follow` the upstream of the local branch it names. As in VS Code, a local branch of that name comes first.
 */
async function onRemote(tools: GitTools, name: string, follow: boolean): Promise<string | null> {
  if (name.startsWith("-")) return null;
  const out = await tools.read(["for-each-ref", "--format=%(refname)%00%(upstream)", `refs/heads/${name}`, `${REMOTES}${name}`]);
  const refs = new Map(out.split(/\r?\n/).map((line) => line.split("\0") as [string, string]));
  const upstream = refs.get(`refs/heads/${name}`);
  if (upstream !== undefined) return follow && upstream.startsWith(REMOTES) ? upstream.slice(REMOTES.length) : null;
  return refs.has(`${REMOTES}${name}`) ? name : null;
}

const bases = new Map<string, { branch: string; refs: string; base: string | null }>(); // by repository: the last base found

/** The base, looked for again only when the branch changes or a ref moves: the status is read every few seconds. */
async function knownBase(tools: GitTools, branch: string, refs: string): Promise<string | null> {
  const known = bases.get(tools.cwd);
  if (known?.branch === branch && known.refs === refs) return known.base;
  const base = await baseOf(tools, branch);
  if (bases.size > 256) bases.clear();
  bases.set(tools.cwd, { branch, refs, base });
  return base;
}

// --- worktrees ---------------------------------------------------------------------------------------

export interface WorktreeRecord {
  path: string;
  head: string | null;
  branch: string | null; // full ref name, refs/heads/…
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/** Reads `git worktree list --porcelain -z`: attributes ending in NUL, an empty record between work trees. */
export function parseWorktrees(out: string): WorktreeRecord[] {
  const list: WorktreeRecord[] = [];
  let current: WorktreeRecord | null = null;
  for (const record of out.split("\0")) {
    if (record.startsWith("worktree ")) {
      current = { path: record.slice("worktree ".length), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false };
      list.push(current);
    } else if (current === null || record === "") {
      current = null;
    } else if (record.startsWith("HEAD ")) current.head = hashIn(record.slice(5));
    else if (record.startsWith("branch ")) current.branch = record.slice(7);
    else if (record === "detached") current.detached = true;
    else if (record === "bare") current.bare = true;
    else if (record === "locked" || record.startsWith("locked ")) current.locked = true;
    else if (record === "prunable" || record.startsWith("prunable ")) current.prunable = true;
  }
  return list;
}

// --- discovery ---------------------------------------------------------------------------------------

// VS Code's own defaults, except the scan depth: unset, the scan goes SCAN_MAX_DEPTH levels down.
const settingsSchema = z.object({
  "git.autoRepositoryDetection": z.union([z.boolean(), z.enum(["subFolders", "openEditors"])]).default(true),
  "git.repositoryScanMaxDepth": z.number().int().optional(), // -1: no limit (SCAN_MAX_FOLDERS still holds)
  "git.repositoryScanIgnoredFolders": z.array(z.string()).default(["node_modules"]),
  "git.scanRepositories": z.array(z.string()).default([]),
  "git.ignoredRepositories": z.array(z.string()).default([]),
  "git.openRepositoryInParentFolders": z.enum(["always", "never", "prompt"]).default("prompt"),
});

const SETTINGS_MAX_BYTES = 1024 * 1024;

/** The folder's own settings file is JSON with comments, and need not exist. */
async function readSettings(folder: string) {
  const file = join(folder, ".vscode", "settings.json");
  if (!existsSync(file)) return settingsSchema.parse({});
  let settings: unknown;
  try {
    const text = await readSmall(file, SETTINGS_MAX_BYTES);
    if (text === null) throw new Error("it could not be opened");
    // A file holding nothing but comments is an empty one, as it is to VS Code.
    settings = JSON.parse(stripJsonComments(text, { trailingCommas: true }).trim() || "{}");
  } catch (error) {
    throw new GitError("UNKNOWN", `${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const checked = settingsSchema.safeParse(settings);
  if (!checked.success) throw new GitError("UNKNOWN", `${file}: ${z.prettifyError(checked.error)}`);
  return checked.data;
}

/** The root of the repository a path lies in: the nearest folder at or above it with a `.git`. */
function enclosing(path: string): string | null {
  for (let folder = path; ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".git"))) return folder;
    if (folder === dirname(folder)) return null;
  }
}

/** The repositories below a folder, `depth` levels down, breadth first, opening SCAN_MAX_FOLDERS folders at most. */
async function scan(folder: string, depth: number, ignored: readonly string[]): Promise<{ found: string[]; truncated: boolean }> {
  const found: string[] = [];
  const queue = [{ path: folder, level: 0 }];
  let truncated = false;
  for (let n = 0; n < queue.length; n++) {
    const { path, level } = queue[n];
    if (level > 0 && existsSync(join(path, ".git"))) found.push(path);
    if (level >= depth) continue;
    let names: string[];
    try {
      const entries = await readdir(path, { withFileTypes: true });
      names = entries.filter((entry) => entry.isDirectory() && entry.name !== ".git" && !ignored.includes(entry.name)).map((entry) => entry.name);
    } catch (error) {
      // One unreadable folder does not hide the rest.
      console.warn(`[gitflux] not scanned for repositories: ${redact(error instanceof Error ? error.message : String(error))}`);
      continue;
    }
    for (const name of names.sort()) {
      if (queue.length >= SCAN_MAX_FOLDERS) {
        truncated = true;
        break;
      }
      queue.push({ path: join(path, name), level: level + 1 });
    }
  }
  return { found, truncated };
}

/** What discovery learns about one root, besides the Repository the client sees. */
interface Found {
  repository: Repository;
  superproject: string | null; // real root of the repository it is a submodule of
  commonDir: string | null;
}

const detailOf = (error: unknown) => redact(error instanceof GitError ? error.detail : error instanceof Error ? error.message : String(error));

function blank(root: string): Repository {
  return {
    root,
    name: basename(root),
    branch: null,
    head: null,
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
  };
}

/** Reads one repository: its status (untracked folders not looked into), what it is, what is under way. */
async function describe(ctx: HandlerContext, root: string): Promise<Found> {
  const tools = ctx.at(root);
  try {
    const [{ records }, lines] = await Promise.all([
      // An untracked file is a change, as it is to VS Code. Only whether there is one matters, so an untracked
      // folder is not looked into.
      readPorcelain(tools, "normal"),
      tools.read(["rev-parse", "--absolute-git-dir", "--git-common-dir", "--show-superproject-working-tree"]),
    ]);
    const [gitDirText = "", commonText = "", superText = ""] = lines.split(/\r?\n/).map((line) => line.trim());
    const gitDir = await realOrSelf(gitDirText);
    const commonDir = await realOrSelf(resolve(root, commonText));
    const superproject = superText === "" ? null : await realOrSelf(superText);
    const worktree = !samePathText(gitDir, commonDir);
    const now = parseStatusRecords(records);
    const operation = operationKindOf(gitDir);
    let mainRoot: string | null = null;
    if (worktree) {
      const main = parseWorktrees(await tools.read(["worktree", "list", "--porcelain", "-z"]))[0];
      mainRoot = main ? await realOrSelf(main.path) : null;
    }
    return {
      repository: {
        ...blank(root),
        branch: now.branch,
        head: now.head,
        upstream: now.upstream,
        ahead: now.ahead,
        behind: now.behind,
        changed: now.changes.length > 0,
        staged: now.staged.length > 0,
        // Where VS Code looks for a merge or a rebase under way.
        merging: operation === "merge" || operation === "rebase",
        kind: superproject !== null ? "submodule" : worktree ? "worktree" : "repository",
        mainRoot,
        conflicted: now.conflicts.length > 0,
        operation,
      },
      superproject,
      commonDir,
    };
  } catch (error) {
    // One repository git cannot read does not hide the others: it is listed with why.
    return { repository: { ...blank(root), failed: detailOf(error) }, superproject: null, commonDir: null };
  }
}

/** A submodule path from .gitmodules that stays inside its parent: relative, no `..`, no NUL. */
function safeSubmodulePath(path: string): boolean {
  return path !== "" && !path.includes("\0") && !isAbsolute(path) && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes("..");
}

/** The submodules .gitmodules registers: initialised ones as roots to read, the others as entries of their own. */
async function submodulesOf(ctx: HandlerContext, found: Found): Promise<{ roots: string[]; uninitialized: Found[] }> {
  const root = found.repository.root;
  if (!existsSync(join(root, ".gitmodules"))) return { roots: [], uninitialized: [] };
  let out: string;
  try {
    out = await ctx.at(root).read(["config", "--file", ".gitmodules", "--null", "--get-regexp", "^submodule\\..*\\.path$"], [1]);
  } catch {
    return { roots: [], uninitialized: [] };
  }
  const roots: string[] = [];
  const uninitialized: Found[] = [];
  for (const record of out.split("\0")) {
    const newline = record.indexOf("\n");
    if (newline === -1) continue;
    const path = record.slice(newline + 1);
    if (!safeSubmodulePath(path)) continue;
    const where = resolve(root, path);
    if (!within(root, where)) continue;
    const real = await realOrSelf(where);
    if (!withinReal(root, real)) continue;
    if (existsSync(join(real, ".git"))) roots.push(real);
    else uninitialized.push({ repository: { ...blank(real), kind: "submodule", parent: root, initialized: false }, superproject: root, commonDir: null });
  }
  return { roots, uninitialized };
}

/** The linked worktrees of a repository (its main work tree and bare or vanished ones left out). */
async function worktreesOf(ctx: HandlerContext, found: Found): Promise<string[]> {
  if (found.commonDir === null || !existsSync(join(found.commonDir, "worktrees"))) return [];
  try {
    const list = parseWorktrees(await ctx.at(found.repository.root).read(["worktree", "list", "--porcelain", "-z"]));
    const linked = list.slice(1).filter((tree) => !tree.bare && !tree.prunable && existsSync(tree.path));
    return Promise.all(linked.map((tree) => realOrSelf(tree.path)));
  } catch {
    return [];
  }
}

/** Folder levels from `folder` down to `root`; 0 for the folder itself and for anything outside it. */
function depthBelow(folder: string, root: string): number {
  if (!withinReal(folder, root)) return 0;
  const rel = relative(folder, root);
  return rel === "" ? 0 : rel.split(sep).length;
}

/** The nearest of `roots` that holds `root` (not `root` itself). */
function nearestHolder(root: string, roots: readonly string[]): string | null {
  let best: string | null = null;
  for (const candidate of roots) {
    if (samePathText(candidate, root) || !withinReal(candidate, root)) continue;
    if (best === null || candidate.length > best.length) best = candidate;
  }
  return best;
}

async function discover(ctx: HandlerContext, includeParent: boolean) {
  const folder = await realOrSelf(ctx.cwd);
  const settings = await readSettings(folder);
  const detection = settings["git.autoRepositoryDetection"];
  const parents = settings["git.openRepositoryInParentFolders"];
  const inside = (root: string) => withinReal(folder, root);

  // The roots to list, in order: the folder's own (or the one above it, under "always"), then those below.
  const initial: string[] = [];
  let truncated = false;
  const above = enclosing(folder);
  const aboveReal = above === null ? null : await realOrSelf(above);
  if (aboveReal !== null && (samePathText(aboveReal, folder) || (includeParent && parents === "always"))) initial.push(aboveReal);
  if (detection === true || detection === "subFolders") {
    const set = settings["git.repositoryScanMaxDepth"];
    const depth = set === undefined ? SCAN_MAX_DEPTH : set < 0 ? Number.POSITIVE_INFINITY : set;
    const scanned = await scan(folder, depth, settings["git.repositoryScanIgnoredFolders"]);
    truncated ||= scanned.truncated;
    for (const root of scanned.found) initial.push(await realOrSelf(root));
    for (const path of settings["git.scanRepositories"]) {
      const root = enclosing(resolve(folder, path));
      if (root !== null) initial.push(await realOrSelf(root));
    }
  }
  const ignored = settings["git.ignoredRepositories"].map((path) => resolve(folder, path));
  const wanted = initial.filter((root) => !ignored.some((path) => samePathText(path, root)) && (inside(root) || parents === "always"));

  // Read them, then what they lead to (submodules, worktrees), until nothing new turns up or the bound is reached.
  const entries = new Map<string, Found>();
  const has = (root: string) => [...entries.keys()].some((known) => samePathText(known, root));
  let pending = wanted;
  while (pending.length > 0) {
    const fresh: string[] = [];
    for (const root of pending) if (!has(root) && !fresh.some((other) => samePathText(other, root))) fresh.push(root);
    const room = SCAN_MAX_REPOSITORIES - entries.size;
    if (fresh.length > room) {
      truncated = true;
      fresh.length = Math.max(0, room);
    }
    const described = await mapLimit(fresh, 8, (root) => describe(ctx, root));
    for (const found of described) entries.set(found.repository.root, found);
    pending = [];
    for (const found of described) {
      if (found.repository.failed !== null) continue;
      const { roots, uninitialized } = await submodulesOf(ctx, found);
      pending.push(...roots);
      for (const sub of uninitialized) {
        if (has(sub.repository.root)) continue;
        if (entries.size >= SCAN_MAX_REPOSITORIES) {
          truncated = true;
          break;
        }
        entries.set(sub.repository.root, sub);
      }
      pending.push(...(await worktreesOf(ctx, found)));
    }
  }

  const offeredRoot = aboveReal !== null && !samePathText(aboveReal, folder) && includeParent && parents === "prompt" && !has(aboveReal) ? aboveReal : null;
  const offered = offeredRoot === null ? null : await describe(ctx, offeredRoot);
  const known = [...entries.keys(), ...(offeredRoot === null ? [] : [offeredRoot])];
  const repositories = [...entries.values()].map(({ repository, superproject }) => ({
    ...repository,
    parent: superproject ?? repository.parent ?? nearestHolder(repository.root, known),
    depth: depthBelow(folder, repository.root),
  }));
  return { repositories, parent: offered === null ? null : offered.repository, truncated };
}
