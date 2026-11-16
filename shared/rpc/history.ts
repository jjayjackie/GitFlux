// Reading history: the graph, a commit, a comparison, a file's history and its blame.

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { LOG_PAGE_MAX, LOG_REFS_MAX, LOG_SKIP_MAX, SEARCH_TEXT_MAX } from "../limits.ts";
import {
  commitDetailSchema,
  commitSchema,
  countSchema,
  cwdSchema,
  fileSchema,
  hashSchema,
  repoPathSchema,
  revisionSchema,
  timeSchema,
} from "../schemas.ts";

/** Upstream's graph scope. current: the checked-out branch, its upstream and the branch it was made from; all: every ref. */
export const scopeSchema = z.enum(["current", "all"]);
export type Scope = z.infer<typeof scopeSchema>;

/** What a log reads: upstream's scope, or the history of the refs (or revisions) named. */
export const logScopeSchema = z.union([scopeSchema, z.object({ refs: z.array(revisionSchema).min(1).max(LOG_REFS_MAX) })]);
export type LogScope = z.infer<typeof logScopeSchema>;

/** How many commits one call reads, from 1 to LOG_PAGE_MAX. */
const limitSchema = z.number().int().min(1).max(LOG_PAGE_MAX);
/** How many commits to pass over first, for paging. */
const skipSchema = countSchema.max(LOG_SKIP_MAX).default(0);

/** A search or filter on the graph. Every condition given must hold. */
export const logFilterSchema = z.object({
  text: z.string().min(1).max(SEARCH_TEXT_MAX).optional(), // looked for in `field`
  // message: --grep; author: --author (name or email); hash: a commit whose hash starts with `text`; path: commits
  // that touch paths matching `text`; content: -G, commits whose diff adds or removes a line matching `text`.
  field: z.enum(["message", "author", "hash", "path", "content"]).default("message"),
  author: z.string().min(1).max(SEARCH_TEXT_MAX).optional(), // --author, besides `text`
  since: timeSchema.optional(), // commits at or after, seconds since the epoch
  until: timeSchema.optional(), // commits at or before
  path: repoPathSchema.optional(), // only commits that touch this file or folder
  caseSensitive: z.boolean().default(false), // otherwise -i / --regexp-ignore-case
  regex: z.boolean().default(false), // `text` and `author` as extended regular expressions; otherwise fixed strings
  noMerges: z.boolean().default(false),
});
export type LogFilter = z.input<typeof logFilterSchema>;

/**
 * A page of the graph, newest first in topological order. `more`: there are commits past this page. With a text
 * filter, a page holds at most SEARCH_LIMIT commits whatever `limit` says.
 */
export const historyLogRpc = defineRpc({
  name: "git.history.log",
  input: z.object({ cwd: cwdSchema, scope: logScopeSchema, limit: limitSchema, skip: skipSchema, filter: logFilterSchema.optional() }),
  output: z.object({
    commits: z.array(commitSchema),
    more: z.boolean(),
    // Where HEAD and its upstream stand when they differ: their commits, and the last commit they share. Null when they
    // do not differ, there is no upstream, or the log is filtered.
    sync: z.object({ head: hashSchema, upstream: hashSchema, base: hashSchema }).nullable(),
  }),
});
export type Log = z.infer<typeof historyLogRpc.output>;

/** Where HEAD and its upstream stand, as the log reads it. */
export type Sync = Log["sync"];

/** Everything about one commit: both people, the full message, the files it changed with their counts, the signature. */
export const historyShowRpc = defineRpc({
  name: "git.history.show",
  input: z.object({ cwd: cwdSchema, hash: hashSchema }),
  output: commitDetailSchema,
});

/**
 * Two revisions compared. `files`: what differs between their trees (`git diff from to`), at most COMMIT_FILES_MAX
 * (`truncated` past it); open one with the diff source `{ kind: "compare", from, to }`. `ahead`: commits in `to` that
 * `from` lacks; `behind`: commits in `from` that `to` lacks. `from` and `to` come back resolved to commits.
 */
export const historyCompareRpc = defineRpc({
  name: "git.history.compare",
  input: z.object({ cwd: cwdSchema, from: revisionSchema, to: revisionSchema }),
  output: z.object({
    files: z.array(fileSchema),
    truncated: z.boolean(),
    ahead: countSchema,
    behind: countSchema,
    from: hashSchema,
    to: hashSchema,
  }),
});
export type Comparison = z.infer<typeof historyCompareRpc.output>;

/** A commit in a file's history. */
export const fileCommitSchema = commitSchema.extend({
  path: z.string(), // the file's path at that commit (it differs from the one asked for across a rename)
  status: z.string(), // what the commit did to it: one letter, as a FileChange's status
});
export type FileCommit = z.infer<typeof fileCommitSchema>;

/** The commits that changed one file, newest first: `git log --follow` from `rev` (HEAD when omitted). */
export const historyFileRpc = defineRpc({
  name: "git.history.file",
  input: z.object({
    cwd: cwdSchema,
    path: repoPathSchema,
    limit: limitSchema,
    skip: skipSchema,
    follow: z.boolean().default(true), // across renames
    rev: revisionSchema.optional(),
  }),
  output: z.object({ commits: z.array(fileCommitSchema), more: z.boolean() }),
});
export type FileHistory = z.infer<typeof historyFileRpc.output>;

/** A commit blame names. */
export const blameCommitSchema = z.object({
  author: z.string(),
  email: z.string(),
  time: timeSchema,
  subject: z.string(),
  path: z.string(), // the file's path in that commit
});
export type BlameCommit = z.infer<typeof blameCommitSchema>;

/**
 * Who last changed each line of a file: at `rev`, or the work-tree file when omitted. Lines not committed yet carry the
 * all-zero hash. `commits` has an entry for every hash in `lines`. At most BLAME_MAX_LINES lines (`truncated` past it).
 */
export const historyBlameRpc = defineRpc({
  name: "git.history.blame",
  input: z.object({ cwd: cwdSchema, path: repoPathSchema, rev: revisionSchema.optional() }),
  output: z.object({
    lines: z.array(
      z.object({
        line: countSchema, // in the file as read, from 1
        hash: hashSchema,
        originalLine: countSchema, // in that commit's version of the file, from 1
      }),
    ),
    commits: z.record(z.string(), blameCommitSchema), // by hash
    text: z.array(z.string()), // the file's lines, as read
    truncated: z.boolean(),
  }),
});
export type Blame = z.infer<typeof historyBlameRpc.output>;

/** Whether a filter asks for anything; an empty one is no filter. */
export function isFilterEmpty(filter: LogFilter | undefined): boolean {
  if (!filter) return true;
  return (
    filter.text === undefined &&
    filter.author === undefined &&
    filter.since === undefined &&
    filter.until === undefined &&
    filter.path === undefined &&
    !filter.noMerges
  );
}
