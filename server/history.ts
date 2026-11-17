// Reading history: the graph (with its search and filters), one commit, two revisions compared, a file's history and
// its blame (server/blame.ts).
//
// The graph is read as upstream reads it (`git log --date-order --decorate=full`, one commit more than asked to tell
// whether there are more), with VS Code's Auto scope: HEAD, its upstream and the branch on a remote it was made from.
// Revisions from the client go after `--end-of-options`, paths after `--`. Commit file lists are read as they come and
// cut at COMMIT_FILES_MAX; their totals count every file.
//
// `tracked` follows VS Code 1.142.0's extensions/git/src/historyProvider.ts (the refs its Auto mode shows).
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt
//
// Exported for the other domains and the unit tests: parseRefs, parseLog, filterPlan, parseNameStatus, parseNumstat,
// mergeCounts, changedFiles (server/stash.ts), parseShow, parseFileLog.

import type { output as ZodOutput } from "zod";
import { COMMIT_FILES_MAX, SEARCH_LIMIT } from "../shared/limits.ts";
import {
  historyBlameRpc,
  historyCompareRpc,
  historyFileRpc,
  historyLogRpc,
  historyShowRpc,
  isFilterEmpty,
  type FileCommit,
  type FileHistory,
  type logFilterSchema,
  type LogScope,
  type Sync,
} from "../shared/rpc/history.ts";
import type { Commit, CommitDetail, FileChange, Ref, Stats } from "../shared/schemas.ts";
import { blame } from "./blame.ts";
import { GitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { handle, type HandlerContext, type Registrar, type ServerDeps } from "./core/handler.ts";
import { assertInside, assertRevision } from "./core/validate.ts";
import { baseOf } from "./repo.ts";

export function register(server: Registrar, deps: ServerDeps): void {
  handle(server, deps, historyLogRpc, { kind: "read" }, (input, ctx) => log(ctx, input.scope, input.limit, input.skip, input.filter));
  handle(server, deps, historyShowRpc, { kind: "read" }, (input, ctx) => show(ctx, input.hash));
  handle(server, deps, historyCompareRpc, { kind: "read" }, (input, ctx) => compare(ctx, input.from, input.to));
  handle(server, deps, historyFileRpc, { kind: "read" }, (input, ctx) => fileHistory(ctx, input));
  handle(server, deps, historyBlameRpc, { kind: "read" }, (input, ctx) => blame(ctx, input.path, input.rev));
}

// --- the graph -----------------------------------------------------------------------------------

const FIELD = "\x1f";
const RECORD = "\x1e";
const FIELDS = ["%H", "%P", "%an", "%ae", "%at", "%D", "%s"];
const FORMAT = FIELDS.join("%x1f") + "%x1e";
const REMOTES = "refs/remotes/";

/** Reads `%D` as printed under `--decorate=full`. */
export function parseRefs(decoration: string): Ref[] {
  const refs: Ref[] = [];
  if (decoration.trim() === "") return refs;
  for (const entry of decoration.split(", ")) {
    const name = entry.replace(/^HEAD -> /, "");
    if (name === "HEAD") refs.push({ kind: "head", name });
    else if (name.startsWith("refs/heads/")) refs.push({ kind: entry === name ? "branch" : "head", name: name.slice(11) });
    else if (name.startsWith(REMOTES) && !name.endsWith("/HEAD")) refs.push({ kind: "remote", name: name.slice(13) });
    else if (name.startsWith("tag: refs/tags/")) refs.push({ kind: "tag", name: name.slice(15) });
  }
  return refs;
}

/** One record of FORMAT, without its separator. */
function parseCommit(record: string): Commit | null {
  const fields = record.replace(/^\n+/, "").split(FIELD);
  if (fields.length < 7) return null;
  const [hash, parents, author, email, time, refs] = fields;
  return { hash, parents: parents ? parents.split(" ") : [], author, email, time: Number(time), refs: parseRefs(refs), subject: fields.slice(6).join(FIELD) };
}

/** Reads `git log --format=FORMAT --decorate=full`. */
export function parseLog(out: string): Commit[] {
  return out
    .split(RECORD)
    .map(parseCommit)
    .filter((commit): commit is Commit => commit !== null);
}

type Filter = ZodOutput<typeof logFilterSchema>;

const escapeRegex = (text: string) => text.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
const escapeGlob = (text: string) => text.replace(/[*?[\]\\]/g, "\\$&");

export interface FilterPlan {
  /** Options for `git log`. */
  args: string[];
  /** Pathspecs, to follow `--`. */
  paths: string[];
  /** For the hash field: the prefix a commit's hash must start with (git cannot filter by it). */
  hashPrefix: string | null;
}

/** What a filter asks of `git log`. Every condition must hold, as git combines --grep, --author and the rest. */
export function filterPlan(filter: Filter | undefined): FilterPlan {
  const plan: FilterPlan = { args: [], paths: [], hashPrefix: null };
  if (filter === undefined) return plan;
  const ignoreCase = !filter.caseSensitive;
  let matching = false; // --grep or --author is used: they take --fixed-strings / --extended-regexp
  let pathFromText = false;
  if (filter.text !== undefined) {
    const text = filter.text;
    if (filter.field === "message") {
      plan.args.push(`--grep=${text}`);
      matching = true;
    } else if (filter.field === "author") {
      plan.args.push(`--author=${text}`);
      matching = true;
    } else if (filter.field === "hash") {
      const prefix = text.trim().toLowerCase();
      if (!/^[0-9a-f]{1,64}$/.test(prefix)) throw new GitError("INVALID_ARGUMENT", "A hash is made of the digits 0-9 and a-f");
      plan.hashPrefix = prefix;
    } else if (filter.field === "path") {
      // Paths holding the text anywhere: without the glob magic, `*` matches across `/` as well.
      const pattern = filter.regex ? text : escapeGlob(text);
      const within = filter.path === undefined ? "" : escapeGlob(filter.path);
      plan.paths.push(`:(${ignoreCase ? "icase" : ""})${within}*${pattern}*`);
      pathFromText = true;
    } else {
      // content: commits whose diff adds or removes a line matching the text.
      plan.args.push(`-G${filter.regex ? text : escapeRegex(text)}`);
    }
  }
  if (filter.author !== undefined) {
    plan.args.push(`--author=${filter.author}`);
    matching = true;
  }
  if (matching) plan.args.push(filter.regex ? "--extended-regexp" : "--fixed-strings");
  if (ignoreCase && (matching || (filter.text !== undefined && filter.field === "content"))) plan.args.push("--regexp-ignore-case");
  if (filter.since !== undefined) plan.args.push(`--max-age=${Math.floor(filter.since)}`);
  if (filter.until !== undefined) plan.args.push(`--min-age=${Math.ceil(filter.until)}`);
  if (filter.noMerges) plan.args.push("--no-merges");
  if (filter.path !== undefined && !pathFromText) plan.paths.push(`:(literal)${filter.path}`);
  return plan;
}

/** Where HEAD and `upstream` stand, for VS Code's Incoming and Outgoing Changes: null when they are one commit, or have none in common. */
async function syncOf(tools: GitTools, upstream: string): Promise<Sync> {
  if (!upstream) return null;
  // An upstream that was deleted, or HEAD before the first commit, verifies to nothing.
  const verify = async (ref: string) => (await tools.read(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`], [1])).trim();
  const [head, tip] = await Promise.all([verify("HEAD"), verify(upstream)]);
  if (!head || !tip || head === tip) return null;
  const base = (await tools.read(["merge-base", head, tip], [1])).trim();
  return base ? { head, upstream: tip, base } : null;
}

/** What VS Code's Auto shows besides HEAD: the checked-out branch's upstream, and the branch on a remote it was made from. */
async function tracked(tools: GitTools, upstream: string): Promise<string[]> {
  // --ignore-missing, in the log, covers an upstream that was deleted.
  const branch = (await tools.read(["symbolic-ref", "--quiet", "--short", "HEAD"], [1])).trim(); // nothing when HEAD is detached
  const base = branch ? await baseOf(tools, branch) : null;
  return [upstream, base ? REMOTES + base : ""].filter(Boolean);
}

async function log(ctx: HandlerContext, scope: LogScope, limit: number, skip: number, filter: Filter | undefined) {
  const filtered = !isFilterEmpty(filter);
  const searching = filter !== undefined && (filter.text !== undefined || filter.author !== undefined);
  const page = searching ? Math.min(limit, SEARCH_LIMIT) : limit;
  const plan = filterPlan(filter);
  const born = (await ctx.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim() !== "";
  // The checked-out branch's upstream, as a full ref name; nothing without one.
  const upstream = (await ctx.read(["for-each-ref", "--format=%(if)%(HEAD)%(then)%(upstream)%(end)", "refs/heads"])).trim();

  let pseudo: string[] = [];
  let revisions: string[];
  if (scope === "all") {
    pseudo = ["--branches", "--remotes", "--tags"];
    revisions = born ? ["HEAD"] : [];
  } else if (scope === "current") {
    revisions = born ? ["HEAD", ...(await tracked(ctx, upstream))] : [];
  } else {
    revisions = [...scope.refs];
  }
  const empty = { commits: [], more: false, sync: null };
  if (revisions.length === 0 && (pseudo.length === 0 || (await ctx.read(["for-each-ref", "--count=1", "--format=%(refname)", "refs/heads", "refs/remotes", "refs/tags"])).trim() === "")) {
    return empty;
  }
  // Auto's upstream and base may have been deleted: missing, they are left out. Refs the client names must exist.
  const missing = typeof scope === "string" ? ["--ignore-missing"] : [];
  const head = ["log", "--date-order", "--decorate=full", `--format=${FORMAT}`, ...missing, ...plan.args, ...pseudo];
  const tail = ["--end-of-options", ...revisions, "--", ...plan.paths];
  const sync = filtered ? null : await syncOf(ctx, upstream);

  if (plan.hashPrefix !== null) {
    // git cannot select commits by a part of their hash: the log is read as it comes and stopped once a page is full.
    const prefix = plan.hashPrefix;
    const found: Commit[] = [];
    let passed = 0;
    await ctx.stream([...head, ...tail], {
      delimiter: RECORD,
      onRecord: (record) => {
        const commit = parseCommit(record);
        if (commit === null || !commit.hash.startsWith(prefix)) return true;
        if (passed < skip) {
          passed++;
          return true;
        }
        found.push(commit);
        return found.length <= page;
      },
    });
    return { commits: found.slice(0, page), more: found.length > page, sync };
  }

  const out = await ctx.read([...head, `--max-count=${page + 1}`, `--skip=${skip}`, ...tail]);
  const commits = parseLog(out);
  return { commits: commits.slice(0, page), more: commits.length > page, sync };
}

// --- files a commit or a comparison changed -------------------------------------------------------

/** Reads the NUL-separated records of `--name-status -z`: status, path, and for a rename or copy the old path first. */
export function parseNameStatus(out: string): FileChange[] {
  const files: FileChange[] = [];
  const reader = nameStatusReader((file) => {
    files.push(file);
    return true;
  });
  for (const record of out.split("\0")) reader(record);
  return files;
}

/** A record-by-record reader of `--name-status -z`; `emit` returning false stops it. */
function nameStatusReader(emit: (file: FileChange) => boolean): (record: string) => boolean {
  let status = "";
  let from: string | null = null;
  let wanted = 0; // paths still to read for the current entry
  return (raw) => {
    if (wanted === 0) {
      const record = raw.replace(/^\n+/, "");
      if (record === "") return true;
      status = record[0];
      from = null;
      wanted = status === "R" || status === "C" ? 2 : 1;
      return true;
    }
    if (wanted === 2) {
      from = raw;
      wanted = 1;
      return true;
    }
    wanted = 0;
    return emit(from === null ? { path: raw, status } : { path: raw, from, status });
  };
}

interface NumstatEntry {
  path: string;
  additions: number | null; // null: binary
  deletions: number | null;
}

/** A record-by-record reader of `--numstat -z`: "a\td\tpath", or "a\td\t" then the old and new paths of a rename. */
function numstatReader(emit: (entry: NumstatEntry) => void): (record: string) => boolean {
  let pending: { additions: number | null; deletions: number | null } | null = null;
  let renameFrom = false; // the next record is a rename's old path
  return (raw) => {
    if (pending !== null) {
      if (renameFrom) {
        renameFrom = false;
        return true;
      }
      emit({ path: raw, ...pending });
      pending = null;
      return true;
    }
    const record = raw.replace(/^\n+/, "");
    if (record === "") return true;
    const [added = "", deleted = "", ...rest] = record.split("\t");
    const counts = { additions: added === "-" ? null : Number(added) || 0, deletions: deleted === "-" ? null : Number(deleted) || 0 };
    const path = rest.join("\t");
    if (path === "") {
      pending = counts;
      renameFrom = true;
    } else emit({ path, ...counts });
    return true;
  };
}

/** Reads `--numstat -z` whole, for tests. */
export function parseNumstat(out: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  const reader = numstatReader((entry) => entries.push(entry));
  for (const record of out.split("\0")) reader(record);
  return entries;
}

/** Name-status and numstat of the same diff, joined in the order git lists them. */
export function mergeCounts(files: readonly FileChange[], counts: readonly NumstatEntry[]): FileChange[] {
  return files.map((file, index) => {
    const entry = counts[index];
    if (entry === undefined || entry.path !== file.path) return file;
    if (entry.additions === null || entry.deletions === null) return { ...file, binary: true };
    return { ...file, additions: entry.additions, deletions: entry.deletions };
  });
}

/**
 * The files a diff changed, at most COMMIT_FILES_MAX of them, with their counts, and totals over every file. `diff` is
 * the command (`diff`, `show`…) and its arguments: `--name-status -z` and `--numstat -z` go in after its first word.
 */
export async function changedFiles(tools: GitTools, diff: readonly string[]): Promise<{ files: FileChange[]; truncated: boolean; stats: Stats }> {
  const files: FileChange[] = [];
  let truncated = false;
  const readNames = nameStatusReader((file) => {
    if (files.length >= COMMIT_FILES_MAX) {
      truncated = true;
      return false;
    }
    files.push(file);
    return true;
  });
  const counts: NumstatEntry[] = [];
  const stats: Stats = { files: 0, insertions: 0, deletions: 0 };
  const readCounts = numstatReader((entry) => {
    stats.files++;
    stats.insertions += entry.additions ?? 0;
    stats.deletions += entry.deletions ?? 0;
    if (counts.length < COMMIT_FILES_MAX) counts.push(entry);
  });
  await Promise.all([
    tools.stream([...diff.slice(0, 1), "--name-status", "-z", ...diff.slice(1)], { delimiter: "\0", onRecord: readNames }),
    tools.stream([...diff.slice(0, 1), "--numstat", "-z", ...diff.slice(1)], { delimiter: "\0", onRecord: readCounts }),
  ]);
  return { files: mergeCounts(files, counts), truncated, stats };
}

// --- one commit ---------------------------------------------------------------------------------------

const SHOW_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%D", "%s", "%B"].join("%x1f");

/** Reads `git show --no-patch --format=SHOW_FORMAT`. */
export function parseShow(out: string): Omit<CommitDetail, "files" | "filesTruncated" | "stats"> {
  const fields = out.split(FIELD);
  const [hash = "", parents = "", an = "", ae = "", at = "", cn = "", ce = "", ct = "", refs = "", subject = ""] = fields;
  const body = fields.slice(10).join(FIELD).trimEnd();
  return {
    hash: hash.trim(),
    parents: parents ? parents.split(" ") : [],
    author: { name: an, email: ae, time: Number(at) },
    committer: { name: cn, email: ce, time: Number(ct) },
    subject,
    body,
    refs: parseRefs(refs),
  };
}

async function show(ctx: HandlerContext, hash: string): Promise<CommitDetail> {
  const commit = await assertRevision(ctx.cwd, hash);
  const [out, changed] = await Promise.all([
    ctx.read(["show", "--no-patch", "--decorate=full", `--format=${SHOW_FORMAT}`, "--end-of-options", commit, "--"]),
    // A merge is shown against its first parent: what it brought into the branch.
    changedFiles(ctx, ["show", "--format=", "--diff-merges=first-parent", "--find-renames", "--end-of-options", commit, "--"]),
  ]);
  // The signature is left unchecked (absent): checking it runs gpg, which is not cheap.
  return { ...parseShow(out), files: changed.files, filesTruncated: changed.truncated, stats: changed.stats };
}

// --- two revisions compared -------------------------------------------------------------------------

async function compare(ctx: HandlerContext, fromRevision: string, toRevision: string) {
  const [from, to] = await Promise.all([assertRevision(ctx.cwd, fromRevision), assertRevision(ctx.cwd, toRevision)]);
  const [changed, counts] = await Promise.all([
    changedFiles(ctx, ["diff", "--find-renames", "--end-of-options", from, to, "--"]),
    ctx.read(["rev-list", "--left-right", "--count", "--end-of-options", `${from}...${to}`, "--"]),
  ]);
  const [behind = "0", ahead = "0"] = counts.trim().split(/\s+/);
  return { files: changed.files, truncated: changed.truncated, ahead: Number(ahead) || 0, behind: Number(behind) || 0, from, to };
}

// --- one file's history ---------------------------------------------------------------------------------

/** `git log -z --name-status --format=FILE_FORMAT`: each commit's header starts with U+001E and ends at a NUL. */
const FILE_FORMAT = "%x1e" + FIELDS.join("%x1f");

/**
 * Reads `git log -z --name-status --format=FILE_FORMAT -- <path>`, as git lays it out: a header record, then (after a
 * newline) the status and the path(s) of each file the commit changed, each record ending in NUL. A commit carries
 * the path of the file in it and the status of the first file listed (with --follow there is only that one). Across
 * a rename (R) or copy (C) the commit has the new path; the older commits carry the old one, which is where git goes
 * on. A commit listed with no file (a merge git shows no diff for) keeps the path the newer commits led to, as M.
 */
export function parseFileLog(out: string, path: string): FileCommit[] {
  const commits: FileCommit[] = [];
  let current: FileCommit | null = null;
  let follow = path; // the file's path in the next older commit
  let found = false; // the current commit has its file
  let status = "";
  let from: string | null = null;
  let wanted = 0; // paths still to read for the current entry
  for (const raw of out.split("\0")) {
    // A path is taken as it is (it may start with a newline); a header or a status follows git's newline.
    const record = wanted > 0 ? raw : raw.replace(/^\n+/, "");
    if (wanted === 0 && record.startsWith(RECORD)) {
      const commit = parseCommit(record.slice(RECORD.length));
      current = commit === null ? null : { ...commit, path: follow, status: "M" };
      if (current !== null) commits.push(current);
      found = false;
      continue;
    }
    if (current === null) continue;
    if (wanted === 0) {
      if (record === "") continue;
      status = record[0];
      from = null;
      wanted = status === "R" || status === "C" ? 2 : 1;
      continue;
    }
    if (wanted === 2) {
      from = record;
      wanted = 1;
      continue;
    }
    wanted = 0;
    if (found) continue; // a folder's other files: the first one stands for the commit
    found = true;
    current.path = record;
    current.status = status;
    follow = (status === "R" || status === "C") && from !== null ? from : record;
  }
  return commits;
}

type FileInput = ZodOutput<typeof historyFileRpc.input>;

async function fileHistory(ctx: HandlerContext, input: FileInput): Promise<FileHistory> {
  assertInside(ctx.cwd, input.path);
  let start: string;
  if (input.rev !== undefined) start = await assertRevision(ctx.cwd, input.rev);
  else {
    start = (await ctx.read(["rev-parse", "--verify", "--quiet", "HEAD"], [1])).trim();
    if (start === "") return { commits: [], more: false }; // no commit yet
  }
  // --follow takes one path, as given: --literal-pathspecs makes `:(glob)x` or `*` the file of that name. --root shows
  // the first commit as adding the file even where log.showRoot is off.
  const out = await ctx.read([
    "--literal-pathspecs",
    "log",
    ...(input.follow ? ["--follow"] : []),
    "--name-status",
    "-z",
    "--root",
    "--decorate=full",
    `--format=${FILE_FORMAT}`,
    `--max-count=${input.limit + 1}`,
    `--skip=${input.skip}`,
    "--end-of-options",
    start,
    "--",
    input.path,
  ]);
  const commits = parseFileLog(out, input.path);
  return { commits: commits.slice(0, input.limit), more: commits.length > input.limit };
}
