// Input validation the schemas cannot do alone (architecture §5): it needs the file system or git. Every helper throws
// a GitError with the code the client should show.
//
// API
//   assertRepoRoot(cwd) → cwd            absolute, an existing folder, and the top level of a work tree:
//                                        `git rev-parse --show-toplevel` names it, compared after realpath on both
//                                        sides (macOS /var → /private/var, Windows short names and drive-letter
//                                        case). Positive answers are cached briefly per cwd; failures never are.
//                                        NOT_A_REPOSITORY otherwise (INVALID_ARGUMENT for a relative path).
//   repoDirs(cwd) → { gitDir, commonDir } where git keeps this work tree's files and the repository's shared ones
//                                        (they differ in a linked worktree), real paths, cached per cwd.
//   cachedRepoDirs(cwd)                  the same if already known, without running git (undefined otherwise).
//   assertWorkspaceDir(cwd) → cwd        absolute and an existing folder (git.repo.discover).
//   assertRelativePath(path)             a repository-relative path: not empty, no NUL, not absolute, no `..` part.
//   assertInside(root, path) → absolute  the same, and still inside `root` after normalisation (lexical only: what
//                                        git-mediated operations need; the path then goes after `--`).
//   resolveInside(root, path, { real?, followLast? }) → absolute
//                                        as assertInside; with `real`, also inside `root` after resolving symlinks,
//                                        for files the plugin itself reads or writes. `followLast: false` resolves
//                                        the parent folder only (a symlink is then read as a link, not followed).
//                                        PATH_OUTSIDE_REPOSITORY otherwise.
//   assertRefName(cwd, name, kind)       kind "branch": `git check-ref-format --branch`; "tag": refs/tags/<name>;
//                                        "ref": the name as given, or refs/heads/<name>. INVALID_ARGUMENT otherwise.
//   assertRemoteName(cwd, name, { exists = true })
//                                        a valid remote name (as git checks one) and, by default, a configured remote
//                                        (NO_REMOTE otherwise).
//   assertRevision(cwd, rev) → hash      resolves `rev` to a commit with `rev-parse --verify --end-of-options`;
//                                        REF_NOT_FOUND otherwise.
//   samePathText(a, b), within(root, p), withinReal(root, p), realOrSelf(p)
//                                        path comparisons as the file system makes them (case-insensitive on Windows
//                                        and macOS), containment, and realpath that falls back to the path itself.
//   assertRemoteUrl(url) → url           https, http, ssh, git, file URLs, scp-like `user@host:path` and plain paths;
//                                        never credentials in it, never `ext::`/`fd::` or another `<transport>::`,
//                                        never a leading `-`. INVALID_ARGUMENT otherwise.

import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { NAME_MAX, URL_MAX } from "../../shared/limits.ts";
import { GitError } from "./errors.ts";
import { runGit } from "./exec.ts";

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

/** Two absolute paths compared as the file system compares them. */
export function samePathText(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** Whether `path` is `root` or below it (both absolute, normalised). */
export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

export function withinReal(root: string, path: string): boolean {
  return caseInsensitive ? within(root.toLowerCase(), path.toLowerCase()) : within(root, path);
}

export async function realOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

/** The real path of `path`, resolving as much of it as exists (a file not created yet resolves through its folder). */
async function realpathOfExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await realpathOfExisting(parent), basename(path));
  }
}

function assertAbsolute(cwd: string): void {
  if (typeof cwd !== "string" || cwd === "" || cwd.includes("\0") || !isAbsolute(cwd)) {
    throw new GitError("INVALID_ARGUMENT", "cwd must be an absolute path");
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

// --- folders ------------------------------------------------------------------------------

const ROOT_CACHE_MS = 5_000;
const ROOT_CACHE_MAX = 256;
const knownRoots = new Map<string, number>(); // cwd → until when it is known to be a repository's root

export async function assertRepoRoot(cwd: string): Promise<string> {
  assertAbsolute(cwd);
  const now = Date.now();
  const until = knownRoots.get(cwd);
  if (until !== undefined && until > now) return cwd;
  knownRoots.delete(cwd);
  if (!(await isDirectory(cwd))) throw new GitError("NOT_A_REPOSITORY", `No such folder: ${cwd}`);
  let top: string;
  try {
    top = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim();
  } catch (error) {
    if (error instanceof GitError && (error.code === "UNKNOWN" || error.code === "NOT_A_REPOSITORY")) {
      throw new GitError("NOT_A_REPOSITORY", error.detail, { cause: error });
    }
    throw error;
  }
  if (top === "") throw new GitError("NOT_A_REPOSITORY", `${cwd} has no work tree`);
  const [realTop, realCwd] = await Promise.all([realOrSelf(top), realOrSelf(cwd)]);
  if (!samePathText(realTop, realCwd)) {
    throw new GitError("NOT_A_REPOSITORY", `${cwd} is not the top level of its repository's work tree (${top} is)`);
  }
  if (knownRoots.size >= ROOT_CACHE_MAX) {
    const oldest = knownRoots.keys().next();
    if (!oldest.done) knownRoots.delete(oldest.value);
  }
  knownRoots.set(cwd, now + ROOT_CACHE_MS);
  return cwd;
}

export interface RepoDirs {
  /** Where git keeps this work tree's files (`.git`, or `<common>/worktrees/<name>` for a linked worktree), real path. */
  gitDir: string;
  /** Where the repository's shared files are (the same for every worktree of it), real path. */
  commonDir: string;
}

const DIRS_CACHE_MAX = 256;
const knownDirs = new Map<string, RepoDirs>(); // by cwd; a repository's folders do not move while it is open

export async function repoDirs(cwd: string): Promise<RepoDirs> {
  const known = knownDirs.get(cwd);
  if (known) return known;
  const lines = (await runGit(cwd, ["rev-parse", "--absolute-git-dir", "--git-common-dir"])).stdout.split(/\r?\n/);
  const gitDir = (lines[0] ?? "").trim();
  const common = (lines[1] ?? "").trim();
  if (gitDir === "" || common === "") throw new GitError("NOT_A_REPOSITORY", `git names no repository for ${cwd}`);
  // --git-common-dir is relative to cwd when git prints it relative.
  const [realGit, realCommon] = await Promise.all([realOrSelf(gitDir), realOrSelf(resolve(cwd, common))]);
  const dirs = { gitDir: realGit, commonDir: realCommon };
  if (knownDirs.size >= DIRS_CACHE_MAX) {
    const oldest = knownDirs.keys().next();
    if (!oldest.done) knownDirs.delete(oldest.value);
  }
  knownDirs.set(cwd, dirs);
  return dirs;
}

/** repoDirs if they were read before, without running git. */
export function cachedRepoDirs(cwd: string): RepoDirs | undefined {
  return knownDirs.get(cwd);
}

export async function assertWorkspaceDir(cwd: string): Promise<string> {
  assertAbsolute(cwd);
  if (!(await isDirectory(cwd))) throw new GitError("INVALID_ARGUMENT", `No such folder: ${cwd}`);
  return cwd;
}

// --- paths ---------------------------------------------------------------------------------

export function assertRelativePath(path: string): void {
  if (typeof path !== "string" || path === "") throw new GitError("INVALID_ARGUMENT", "A path cannot be empty");
  if (path.includes("\0")) throw new GitError("INVALID_ARGUMENT", "A path cannot hold NUL");
  if (isAbsolute(path) || /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path)) {
    throw new GitError("PATH_OUTSIDE_REPOSITORY", `${path} is not relative to the repository's root`);
  }
  if (path.split(/[\\/]/).includes("..")) throw new GitError("PATH_OUTSIDE_REPOSITORY", `${path} leaves the repository`);
}

export function assertInside(root: string, path: string): string {
  assertRelativePath(path);
  const absolute = resolve(root, path);
  if (!within(resolve(root), absolute)) throw new GitError("PATH_OUTSIDE_REPOSITORY", `${path} leaves the repository`);
  return absolute;
}

export interface InsideOptions {
  /** Check the real path too, symlinks resolved: for files the plugin reads or writes itself. */
  real?: boolean;
  /** With `real`: false resolves the parent folder only, so that the file itself may be a symlink (read as one). */
  followLast?: boolean;
}

export async function resolveInside(root: string, path: string, options: InsideOptions = {}): Promise<string> {
  const absolute = assertInside(root, path);
  if (!options.real) return absolute;
  const realRoot = await realOrSelf(root);
  const target = options.followLast === false ? join(await realpathOfExisting(dirname(absolute)), basename(absolute)) : await realpathOfExisting(absolute);
  if (!withinReal(realRoot, target)) throw new GitError("PATH_OUTSIDE_REPOSITORY", `${path} leads out of the repository`);
  return absolute;
}

// --- names -----------------------------------------------------------------------------------

function assertPlainName(name: string, what: string): void {
  if (typeof name !== "string" || name === "") throw new GitError("INVALID_ARGUMENT", `A ${what} cannot be empty`);
  if (name.length > NAME_MAX) throw new GitError("INVALID_ARGUMENT", `The ${what} is too long`);
  if (name.startsWith("-")) throw new GitError("INVALID_ARGUMENT", `A ${what} cannot start with '-'`);
  if (CONTROL.test(name) || /\s/.test(name)) throw new GitError("INVALID_ARGUMENT", `A ${what} cannot hold spaces or control characters`);
}

/** `git check-ref-format <ref>`: exit 0 when valid, 1 when not. */
async function checkRefFormat(cwd: string, ref: string): Promise<boolean> {
  const { code } = await runGit(cwd, ["check-ref-format", ref], { accept: [1] });
  return code === 0;
}

export async function assertRefName(cwd: string, name: string, kind: "branch" | "tag" | "ref"): Promise<string> {
  assertPlainName(name, `${kind === "ref" ? "ref" : kind} name`);
  if (kind === "branch") {
    try {
      await runGit(cwd, ["check-ref-format", "--branch", name]);
    } catch (error) {
      throw new GitError("INVALID_ARGUMENT", `'${name}' is not a valid branch name`, { cause: error });
    }
    // --branch accepts what expands to a branch (`@{-1}`); a name must be one as written.
    if (!(await checkRefFormat(cwd, `refs/heads/${name}`))) throw new GitError("INVALID_ARGUMENT", `'${name}' is not a valid branch name`);
    return name;
  }
  const full = kind === "tag" ? `refs/tags/${name}` : name.startsWith("refs/") ? name : `refs/heads/${name}`;
  if (!(await checkRefFormat(cwd, full))) throw new GitError("INVALID_ARGUMENT", `'${name}' is not a valid ${kind === "tag" ? "tag" : "ref"} name`);
  return name;
}

export async function assertRemoteName(cwd: string, name: string, options: { exists?: boolean } = {}): Promise<string> {
  assertPlainName(name, "remote name");
  // As git's valid_remote_name: the name must make a valid remote-tracking ref.
  if (!(await checkRefFormat(cwd, `refs/remotes/${name}/test`))) throw new GitError("INVALID_ARGUMENT", `'${name}' is not a valid remote name`);
  if (options.exists !== false) {
    const remotes = (await runGit(cwd, ["remote"])).stdout.split("\n").map((line) => line.trim());
    if (!remotes.includes(name)) throw new GitError("NO_REMOTE", `No such remote: '${name}'`);
  }
  return name;
}

export async function assertRevision(cwd: string, revision: string): Promise<string> {
  assertPlainName(revision, "revision");
  const { stdout } = await runGit(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`], { accept: [1] });
  const hash = stdout.trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) throw new GitError("REF_NOT_FOUND", `Unknown revision: '${revision}'`);
  return hash;
}

// --- remote URLs -----------------------------------------------------------------------------

const URL_SCHEMES = new Set(["https", "http", "ssh", "git", "file"]);

export function assertRemoteUrl(input: string): string {
  const url = typeof input === "string" ? input.trim() : "";
  if (url === "") throw new GitError("INVALID_ARGUMENT", "A URL cannot be empty");
  if (url.length > URL_MAX) throw new GitError("INVALID_ARGUMENT", "The URL is too long");
  if (url.startsWith("-")) throw new GitError("INVALID_ARGUMENT", "A URL cannot start with '-'");
  if (CONTROL.test(url) || /\s/.test(url)) throw new GitError("INVALID_ARGUMENT", "A URL cannot hold spaces or control characters");
  // `<transport>::<address>` runs git-remote-<transport>; ext:: and fd:: run commands.
  if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(url)) throw new GitError("INVALID_ARGUMENT", "This transport runs commands and is not allowed");
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(url);
  if (scheme) {
    if (!URL_SCHEMES.has(scheme[1].toLowerCase())) throw new GitError("INVALID_ARGUMENT", `The ${scheme[1]}:// transport is not allowed`);
    const authority = url.slice(scheme[0].length).split(/[/?#]/, 1)[0];
    const at = authority.lastIndexOf("@");
    if (at !== -1) {
      const user = authority.slice(0, at);
      // A user name alone is fine (ssh://git@host); a password, or a user part that is a token, is a credential.
      if (user.includes(":") || /^(?:gh[pousr]_|github_pat_|glpat-|ATBB|x-access-token|x-token-auth|oauth2)/i.test(user) || (user.length >= 20 && /\d/.test(user) && /[A-Za-z]/.test(user))) {
        throw new GitError("INVALID_ARGUMENT", "Credentials do not belong in a remote's URL");
      }
    }
    return url;
  }
  if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith("/") || url.startsWith("\\") || url.startsWith(".")) return url; // a path
  const scp = /^(?:([^@/:]+)@)?([^/:]+):/.exec(url);
  if (scp && scp[1] !== undefined && scp[1].includes(":")) throw new GitError("INVALID_ARGUMENT", "Credentials do not belong in a remote's URL");
  return url; // scp-like `user@host:path`, or a relative path
}
