// Submodules: listing, updating, syncing their URLs.
//
// The list starts from .gitmodules (`git config --file .gitmodules --null --get-regexp`: names, paths, URLs,
// branches), joined with `git submodule status` (what is checked out in each), the parent's index (the commit it
// records, and conflicts) and, for initialised ones, whether their own work tree has changes (a status read that stops
// at the first file, a few submodules at a time). A path .gitmodules gives that would leave the parent is left out.
// URLs are redacted. `git submodule update` and `sync` only take paths that .gitmodules registers.
//
// Exported for the unit tests: parseGitmodules, parseSubmoduleStatus, parseGitlinks, submoduleState.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { LIST_MAX } from "../shared/limits.ts";
import { submoduleListRpc, submoduleSyncRpc, submoduleUpdateRpc } from "../shared/rpc/submodule.ts";
import type { SubmoduleEntry } from "../shared/schemas.ts";
import { GitError } from "./core/errors.ts";
import { chunkPaths, mapLimit, onPaths, type GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { redactUrl } from "./core/sanitize.ts";
import { assertInside } from "./core/validate.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, submoduleListRpc, { kind: "read" }, (_input, ctx) => list(ctx));
  handle(server, deps, submoduleUpdateRpc, { kind: "network" }, async (input, ctx) => {
    const paths = await registeredPaths(ctx, input.paths);
    const args = ["submodule", "update", ...(input.init ? ["--init"] : []), ...(input.recursive ? ["--recursive"] : []), ...(input.remote ? ["--remote"] : [])];
    // Never --force: local changes in a submodule make the update fail (WOULD_OVERWRITE_CHANGES), not vanish.
    if (paths === null) await ctx.git(args);
    else await onPaths(ctx.git, args, paths);
    return {};
  });
  handle(server, deps, submoduleSyncRpc, { kind: "write", index: false }, async (input, ctx) => {
    const paths = await registeredPaths(ctx, input.paths);
    const args = ["submodule", "sync", ...(input.recursive ? ["--recursive"] : [])];
    if (paths === null) await ctx.git(args);
    else await onPaths(ctx.git, args, paths);
    return {};
  });
}

// --- .gitmodules --------------------------------------------------------------------------------------------

export interface GitmodulesEntry {
  name: string;
  path: string;
  url: string;
  branch?: string;
}

/**
 * Reads `git config --null --get-regexp ^submodule\.` ("key\nvalue\0" records) into the submodules it registers, in
 * the file's order. The name is everything between `submodule.` and the last dot (it may hold dots); one without a
 * path is left out.
 */
export function parseGitmodules(out: string): GitmodulesEntry[] {
  const byName = new Map<string, { path?: string; url?: string; branch?: string }>();
  for (const record of out.split("\0")) {
    if (record === "") continue;
    const newline = record.indexOf("\n");
    const key = newline === -1 ? record : record.slice(0, newline);
    const value = newline === -1 ? "" : record.slice(newline + 1);
    const dot = key.lastIndexOf(".");
    if (!key.startsWith("submodule.") || dot <= "submodule.".length) continue;
    const name = key.slice("submodule.".length, dot);
    const variable = key.slice(dot + 1).toLowerCase();
    const entry = byName.get(name) ?? {};
    byName.set(name, entry);
    if (variable === "path") entry.path = value;
    else if (variable === "url") entry.url = value;
    else if (variable === "branch") entry.branch = value;
  }
  const entries: GitmodulesEntry[] = [];
  for (const [name, entry] of byName) {
    if (entry.path === undefined || entry.path === "") continue;
    entries.push({ name, path: entry.path, url: entry.url ?? "", ...(entry.branch !== undefined && { branch: entry.branch }) });
  }
  return entries;
}

/** Whether a path .gitmodules gives stays inside the parent's root. */
function safePath(root: string, path: string): boolean {
  try {
    assertInside(root, path);
    return true;
  } catch {
    return false;
  }
}

async function gitmodules(tools: GitTools): Promise<GitmodulesEntry[]> {
  if (!existsSync(join(tools.cwd, ".gitmodules"))) return [];
  // Exit 1: no key matches.
  const out = await tools.read(["config", "--file", ".gitmodules", "--null", "--get-regexp", "^submodule\\."], [1]);
  return parseGitmodules(out).filter((entry) => safePath(tools.cwd, entry.path));
}

/** `/`-separated, without a trailing `/`: how .gitmodules and git name a submodule's path. */
const normal = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * The paths a call names, each one .gitmodules registers (INVALID_ARGUMENT otherwise), as .gitmodules spells them;
 * null when the call names none (every submodule).
 */
async function registeredPaths(tools: GitTools, paths: readonly string[] | undefined): Promise<string[] | null> {
  if (paths === undefined) return null;
  const known = new Map((await gitmodules(tools)).map((entry) => [normal(entry.path), entry.path] as const));
  return paths.map((path) => {
    assertInside(tools.cwd, path);
    const found = known.get(normal(path));
    if (found === undefined) throw new GitError("INVALID_ARGUMENT", `'${path}' is not a submodule registered in .gitmodules`);
    return found;
  });
}

// --- git submodule status, and the parent's index ------------------------------------------------------------

export interface StatusLine {
  /** ' ' at the recorded commit, '+' at another one, '-' not initialised, 'U' in conflict. */
  flag: " " | "+" | "-" | "U";
  hash: string;
  describe?: string;
}

const STATUS = /^([ +\-U])([0-9a-f]{40}|[0-9a-f]{64}) (.*)$/;

/**
 * Reads `git submodule status` lines, "<flag><hash> <path>[ (<describe>)]", by path. A path is matched against the
 * paths .gitmodules gives (`known`), the longest first, so that one holding " (" is still read right.
 */
export function parseSubmoduleStatus(out: string, known: readonly string[]): Map<string, StatusLine> {
  const lines = new Map<string, StatusLine>();
  const paths = [...known].sort((a, b) => b.length - a.length);
  for (const raw of out.split(/\r?\n/)) {
    const match = STATUS.exec(raw);
    if (match === null) continue;
    const [, flag, hash, rest] = match;
    let path = paths.find((candidate) => rest === candidate || (rest.startsWith(`${candidate} (`) && rest.endsWith(")")));
    let describe: string | undefined;
    if (path !== undefined) {
      if (rest.length > path.length) describe = rest.slice(path.length + 2, -1);
    } else {
      const described = /^(.*) \((.*)\)$/.exec(rest);
      path = described ? described[1] : rest;
      describe = described ? described[2] : undefined;
    }
    lines.set(path, { flag: flag as StatusLine["flag"], hash, ...(describe !== undefined && describe !== "" && { describe }) });
  }
  return lines;
}

export interface Gitlink {
  /** The commit the parent's index records (stage 0); null when it is in conflict. */
  expected: string | null;
  conflict: boolean;
}

/** Reads `git ls-files --stage -z`: "<mode> <hash> <stage>\t<path>" records; only submodules (mode 160000) are kept. */
export function parseGitlinks(out: string): Map<string, Gitlink> {
  const links = new Map<string, Gitlink>();
  for (const record of out.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const [mode = "", hash = "", stage = ""] = record.slice(0, tab).split(" ");
    if (mode !== "160000") continue;
    const path = record.slice(tab + 1);
    const link = links.get(path) ?? { expected: null, conflict: false };
    if (stage === "0") link.expected = hash;
    else link.conflict = true;
    links.set(path, link);
  }
  return links;
}

/**
 * A submodule's state. In conflict in the parent first; then not initialised; then `modified` when its own work tree
 * has changes (whatever commit it is at: those changes are what an update would trip over); then `ahead` when it is
 * checked out at another commit than the one recorded, else `clean`.
 */
export function submoduleState(facts: { conflict: boolean; initialized: boolean; dirty: boolean; hash: string | null; expected: string | null; flag?: StatusLine["flag"] }): SubmoduleEntry["state"] {
  if (facts.conflict || facts.flag === "U") return "conflict";
  if (!facts.initialized || facts.flag === "-") return "uninitialized";
  if (facts.dirty) return "modified";
  if (facts.flag === "+") return "ahead";
  if (facts.flag === " ") return "clean";
  // Not in `git submodule status` (it failed, or the index does not record it): compared here.
  return facts.expected === null || facts.hash === facts.expected ? "clean" : "ahead";
}

/** Whether a work tree has changes, untracked files included: git status, stopped at the first one. */
async function dirty(tools: GitTools): Promise<boolean> {
  let found = false;
  try {
    await tools.stream(["status", "--porcelain", "-z", "--untracked-files=normal"], {
      delimiter: "\0",
      onRecord: (record) => {
        if (record === "") return true;
        found = true;
        return false;
      },
    });
  } catch {
    return false; // a submodule git cannot read is shown by its other facts
  }
  return found;
}

async function headOf(tools: GitTools): Promise<string | null> {
  try {
    const hash = (await tools.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim();
    return hash === "" ? null : hash;
  } catch {
    return null;
  }
}

async function gitlinks(tools: GitTools, paths: readonly string[]): Promise<Map<string, Gitlink>> {
  const links = new Map<string, Gitlink>();
  for (const chunk of chunkPaths(paths)) {
    const out = await tools.read(["--literal-pathspecs", "ls-files", "--stage", "-z", "--", ...chunk]);
    for (const [path, link] of parseGitlinks(out)) links.set(path, link);
  }
  return links;
}

async function list(ctx: HandlerContext): Promise<{ submodules: SubmoduleEntry[]; truncated: boolean }> {
  const all = await gitmodules(ctx);
  const entries = all.slice(0, LIST_MAX);
  if (entries.length === 0) return { submodules: [], truncated: false };
  const paths = entries.map((entry) => entry.path);
  const links = await gitlinks(ctx, paths);
  // `git submodule status` stops at the first submodule .gitmodules does not map: then each is read on its own.
  let status: Map<string, StatusLine> | null;
  try {
    status = parseSubmoduleStatus(await ctx.read(["submodule", "status"]), paths);
  } catch {
    status = null;
  }
  const submodules = await mapLimit(entries, 4, async (entry): Promise<SubmoduleEntry> => {
    const root = resolve(ctx.cwd, entry.path);
    const link = links.get(normal(entry.path)) ?? links.get(entry.path);
    const line = status?.get(entry.path) ?? status?.get(normal(entry.path));
    const initialized = line === undefined || line.flag !== "-" ? existsSync(join(root, ".git")) : false;
    const tools = ctx.at(root);
    const hash = !initialized ? null : line !== undefined && line.flag !== "U" ? line.hash : await headOf(tools);
    const conflict = link?.conflict ?? false;
    const isDirty = initialized && !conflict && (await dirty(tools));
    const state = submoduleState({ conflict, initialized, dirty: isDirty, hash, expected: link?.expected ?? null, flag: line?.flag });
    const describe = line?.describe;
    return {
      path: entry.path,
      root,
      url: redactUrl(entry.url),
      hash: state === "uninitialized" ? null : hash,
      expected: link?.expected ?? null,
      state,
      ...(entry.branch !== undefined && { branch: entry.branch }),
      ...(describe !== undefined && state !== "uninitialized" && { describe }),
    };
  });
  return { submodules, truncated: all.length > LIST_MAX };
}
