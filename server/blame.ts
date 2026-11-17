// Who last changed each line of a file: `git blame --porcelain`, read by a pure parser (parseBlame), for
// git.history.blame (registered in server/history.ts).
//
// The work-tree file is blamed when no revision is given, as `git blame <path>` does: lines not committed yet carry the
// all-zero hash, with a `commits` entry of their own ("Not Committed Yet"). Git's default whitespace handling. At most
// BLAME_MAX_LINES lines are read: git is asked for one more (`-L 1,<max + 1>`, which it clamps to the file's length),
// and getting it is what says the file was cut. No line count is read beforehand.
//
// Exported for the unit tests: parseBlame, unquotePath.

import { lstat } from "node:fs/promises";
import { BINARY_SNIFF_BYTES, BLAME_MAX_LINES } from "../shared/limits.ts";
import type { Blame, BlameCommit } from "../shared/rpc/history.ts";
import { GitError, isGitError } from "./core/errors.ts";
import type { GitTools } from "./core/exec.ts";
import { assertInside, assertRevision, resolveInside } from "./core/validate.ts";

/** "<hash> <line in that commit> <line in the file>[ <lines in this group>]" */
const HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) (\d+) (\d+)(?: \d+)?$/;

const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/**
 * A path as git writes it with write_name_quoted: as it is, or, when it holds a quote, a backslash or a control
 * character (or non-ASCII under core.quotePath), C-quoted with octal escapes for the bytes of UTF-8.
 */
export function unquotePath(text: string): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  const body = text.slice(1, -1);
  const bytes: number[] = [];
  let run = 0; // where the text not yet copied starts
  const flush = (end: number) => {
    for (const byte of Buffer.from(body.slice(run, end), "utf8")) bytes.push(byte);
  };
  for (let n = 0; n < body.length; n++) {
    if (body[n] !== "\\") continue;
    flush(n);
    const next = body[n + 1] ?? "";
    if (/^[0-7]$/.test(next)) {
      const digits = /^[0-7]{1,3}/.exec(body.slice(n + 1))?.[0] ?? next;
      bytes.push(parseInt(digits, 8) & 0xff);
      n += digits.length;
    } else if (next in ESCAPES) {
      bytes.push(ESCAPES[next]);
      n += 1;
    } else {
      bytes.push(92); // a lone backslash stands for itself
    }
    run = n + 1;
  }
  flush(body.length);
  return Buffer.from(bytes).toString("utf8");
}

interface Draft {
  author?: string;
  email?: string;
  time?: number;
  subject?: string;
  path?: string;
}

/**
 * Reads `git blame --porcelain`: per line a header, the commit's details the first time it appears (and its
 * `filename` again where one commit stands for more than one path), then the line itself after a tab. At most `max`
 * lines are kept; `truncated` when there were more. `commits` has an entry for every hash the kept lines name.
 */
export function parseBlame(out: string, max: number = BLAME_MAX_LINES): Blame {
  const lines: Blame["lines"] = [];
  const text: string[] = [];
  const drafts = new Map<string, Draft>();
  let truncated = false;
  let hash: string | null = null; // the commit of the line whose details are being read
  let draft: Draft = {};
  let original = 0;
  let final = 0;
  for (const raw of out.split("\n")) {
    if (hash === null) {
      const match = HEADER.exec(raw);
      if (match === null) continue;
      hash = match[1];
      original = Number(match[2]);
      final = Number(match[3]);
      draft = drafts.get(hash) ?? {};
      drafts.set(hash, draft);
      continue;
    }
    if (raw.startsWith("\t")) {
      if (lines.length >= max) {
        truncated = true;
        break;
      }
      lines.push({ line: final, hash, originalLine: original });
      text.push(raw.slice(1).replace(/\r$/, "")); // a CRLF file's lines, as the diff splits them
      hash = null;
      continue;
    }
    const space = raw.indexOf(" ");
    const key = space === -1 ? raw : raw.slice(0, space);
    const value = space === -1 ? "" : raw.slice(space + 1);
    if (key === "author") draft.author = value;
    else if (key === "author-mail") draft.email = value.replace(/^<|>$/g, "");
    else if (key === "author-time") draft.time = Number(value) || 0;
    else if (key === "summary") draft.subject = value;
    else if (key === "filename" && draft.path === undefined) draft.path = unquotePath(value);
  }
  const commits: Record<string, BlameCommit> = {};
  for (const { hash: named } of lines) {
    if (named in commits) continue;
    const info = drafts.get(named) ?? {};
    commits[named] = { author: info.author ?? "", email: info.email ?? "", time: info.time ?? 0, subject: info.subject ?? "", path: info.path ?? "" };
  }
  return { lines, commits, text, truncated };
}

const empty = (): Blame => ({ lines: [], commits: {}, text: [], truncated: false });

/** Whether the start of the text read holds a NUL, git's own test for a binary file. */
function looksBinary(text: readonly string[]): boolean {
  let length = 0;
  for (const line of text) {
    if (line.includes("\0")) return true;
    length += line.length + 1;
    if (length >= BINARY_SNIFF_BYTES) return false;
  }
  return false;
}

export async function blame(tools: GitTools, path: string, rev: string | undefined): Promise<Blame> {
  assertInside(tools.cwd, path);
  let hash: string | null = null;
  if (rev !== undefined) {
    hash = await assertRevision(tools.cwd, rev);
    const spec = `${hash}:${path}`;
    let type: string;
    try {
      type = (await tools.read(["cat-file", "-t", spec])).trim();
    } catch (error) {
      throw new GitError("REF_NOT_FOUND", `${path} does not exist in ${rev}`, { cause: error });
    }
    if (type !== "blob") throw new GitError("INVALID_ARGUMENT", `${path} is not a file in ${rev}`);
    // An empty file has no line for -L to start at (git: "file has only 0 lines").
    if (Number((await tools.read(["cat-file", "-s", spec])).trim()) === 0) return empty();
  } else {
    // The work-tree file: the folders on the way may not lead out of the root; a symlink is blamed as one, as git does.
    const absolute = await resolveInside(tools.cwd, path, { real: true, followLast: false });
    let info;
    try {
      info = await lstat(absolute);
    } catch (error) {
      throw new GitError("REF_NOT_FOUND", `${path} is not in the working tree`, { cause: error });
    }
    if (info.isDirectory()) throw new GitError("INVALID_ARGUMENT", `${path} is a folder`);
    if (info.isFile() && info.size === 0) return empty();
  }
  // The revision is a full hash already resolved (assertRevision), so it cannot be read as an option; the path follows
  // `--`. core.quotePath=false: a non-ASCII `filename` comes as it is.
  const args = ["-c", "core.quotePath=false", "blame", "--porcelain", "-L", `1,${BLAME_MAX_LINES + 1}`, ...(hash === null ? [] : [hash]), "--", path];
  let out: string;
  try {
    out = await tools.read(args);
  } catch (error) {
    if (isGitError(error) && /has only 0 lines/i.test(error.detail)) return empty();
    // An untracked file, or one the revision does not have.
    if (isGitError(error) && /no such path/i.test(error.detail)) throw new GitError("REF_NOT_FOUND", error.detail, { cause: error });
    throw error;
  }
  const result = parseBlame(out);
  if (looksBinary(result.text)) throw new GitError("INVALID_ARGUMENT", `${path} is a binary file`);
  return result;
}
