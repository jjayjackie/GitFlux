// The failure every handler throws, and the reading of git's own words into one of the codes of shared/errors.ts.
//
// API
//   new GitError(code, detail, { setting?, cause? })  a failure with a code (shared/errors.ts) and git's own words.
//                                                    core/handler.ts turns it into the wire form; `setting` names
//                                                    the safety switch for FORBIDDEN_BY_POLICY.
//   isGitError(value)                                 narrows an unknown thrown value.
//   classify(stderr, stdout, exitCode, context?)      the GitError for a git command that failed: the code read from
//                                                    its output (CLASSIFICATION, first match wins), the detail its
//                                                    redacted, length-capped words. Git must run with LC_ALL=C
//                                                    (core/env.ts) for these English patterns to hold.
//   codeOf(text)                                      the code the table gives a text alone (unit-tested).
//
// Codes that do not come from git's output (TIMEOUT, OUTPUT_TOO_LARGE, GIT_NOT_FOUND, REPOSITORY_BUSY, the policy
// codes) are thrown where they arise: core/exec.ts, core/locks.ts, core/safety.ts, core/validate.ts.

import type { GitErrorCode } from "../../shared/errors.ts";
import { redact } from "./sanitize.ts";

export interface GitErrorOptions {
  /** For FORBIDDEN_BY_POLICY: the safety switch that is off, e.g. `allowForcePush`. */
  setting?: string;
  cause?: unknown;
}

export class GitError extends Error {
  readonly code: GitErrorCode;
  /** Git's own words (or the plugin's, in git's manner), redacted before they leave the process. */
  readonly detail: string;
  readonly setting: string | undefined;

  constructor(code: GitErrorCode, detail: string, options: GitErrorOptions = {}) {
    super(`${code}: ${detail}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GitError";
    this.code = code;
    this.detail = detail;
    this.setting = options.setting;
  }
}

export function isGitError(value: unknown): value is GitError {
  return value instanceof GitError;
}

/** What a failure's caller knows besides the output: the arguments git was run with. */
export interface ClassifyContext {
  args?: readonly string[];
}

/**
 * git's words → code, in order: the first pattern that matches wins, so the more specific come first (a push the
 * remote's hook declined says "rejected" too; an SSH key refused is followed by "Could not read from remote").
 */
export const CLASSIFICATION: ReadonlyArray<readonly [GitErrorCode, RegExp]> = [
  ["NO_REMOTE", /does not appear to be a git repository|No such remote\b(?! ref)|No configured push destination|No remote repository specified/i],
  // A `.git` file whose repository is gone is worded differently across git versions; every wording counts.
  [
    "NOT_A_REPOSITORY",
    /not a git repository|detected dubious ownership|must be run in a work tree|invalid gitfile format|gitfile does not point to a valid repository|unable to read gitfile|gitdir file points to non-existent location|not a gitdir|cannot chdir to '?[^\n]*'?: No such file/i,
  ],
  ["INDEX_LOCKED", /\.lock': File exists|Another git process seems to be running/i],
  ["HOST_KEY_VERIFICATION_FAILED", /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No \S+ host key is known for/i],
  [
    "AUTH_FAILED",
    // Forges answer "Repository not found" for a repository the credentials cannot see, so it counts as refused.
    /Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|Permission denied \((?:publickey|password|keyboard-interactive)|Permission denied, please try again|The requested URL returned error: 40[13]\b|HTTP Basic: Access denied|Invalid username or (?:password|token)|support for password authentication was removed|Repository not found/i,
  ],
  ["REMOTE_REJECTED", /\[remote rejected\]|pre-receive hook declined|protected branch hook declined|remote: error: GH\d+/i],
  ["REF_EXISTS", /\[rejected\][^\n]*\(already exists\)/i],
  [
    "NON_FAST_FORWARD",
    /\[rejected\][^\n]*\((?:non-fast-forward|fetch first|stale info)\)|Updates were rejected because|non-fast-forward|Not possible to fast-forward|Need to specify how to reconcile divergent branches|You have divergent branches/i,
  ],
  [
    "NETWORK",
    /Could not resolve host|Connection refused|Connection timed out|Operation timed out|Network is unreachable|No route to host|unable to access|Failed to connect to|Connection reset by peer|Connection closed by|remote end hung up unexpectedly|early EOF|RPC failed|ssh: connect to host|kex_exchange_identification|Could not read from remote repository/i,
  ],
  ["NO_UPSTREAM", /has no upstream branch|There is no tracking information|no upstream configured|no tracking information/i],
  [
    "OPERATION_IN_PROGRESS",
    /You have not concluded your (?:merge|cherry-pick|revert)|MERGE_HEAD exists|there is already a rebase-(?:merge|apply) directory|in the middle of another rebase|(?:cherry-pick|revert|cherry-pick or revert) is already in progress|You are currently bisecting|in the middle of an am session/i,
  ],
  [
    "MERGE_CONFLICT",
    /^CONFLICT \(|Automatic merge failed|could not apply|Resolve all conflicts manually|fix conflicts and then|after resolving the conflicts|is not possible because you have unmerged files|you need to resolve your current index first|needs merge$|Merge conflict in/im,
  ],
  [
    "WOULD_OVERWRITE_CHANGES",
    /would be overwritten by|Please commit your changes or stash them|Your local changes to the following files|untracked working tree files would be (?:overwritten|removed)|You have unstaged changes|Your index contains uncommitted changes|contains modified or untracked files|cannot (?:pull|rebase) with rebase/i,
  ],
  ["UNMERGED_BRANCH", /is not fully merged/i],
  ["REF_EXISTS", /already exists/i],
  [
    "IDENTITY_MISSING",
    /Please tell me who you are|no (?:email|name) was given|unable to auto-detect email address|empty ident name|(?:Author|Committer) identity unknown/i,
  ],
  [
    "NOTHING_TO_COMMIT",
    /nothing to commit|no changes added to commit|nothing added to commit|would make it empty|You have nothing to amend|The previous cherry-pick is now empty/i,
  ],
  [
    "NO_OPERATION",
    /There is no merge to abort|There is no merge in progress|No rebase in progress|no cherry-pick or revert in progress|no (?:cherry-pick|revert) in progress|We are not bisecting|not bisecting|Resolve operation not in progress|No am in progress/i,
  ],
  [
    "REF_NOT_FOUND",
    /unknown revision|bad revision|did not match any file|not a valid object name|invalid object name|Not a valid commit name|invalid reference|couldn't find remote ref|not a valid ref|No such ref|no such branch|branch '[^']*' not found|is not a commit|bad object|No stash entries found|is not a stash-like commit|is not a valid reference|unknown commit|Needed a single revision|does not have any commits yet|does not exist in '|exists on disk, but not in/i,
  ],
  [
    "HOOK_FAILED",
    /hook declined|\b(?:pre-commit|commit-msg|prepare-commit-msg|pre-merge-commit|pre-push|pre-rebase|pre-applypatch|applypatch-msg|post-checkout|reference-transaction) hook\b[^\n]*(?:failed|declined|refused|exited)/i,
  ],
  [
    "INVALID_ARGUMENT",
    /is not a valid (?:branch|tag|remote)? ?name|not a valid remote name|unknown option|unknown switch|usage: git|invalid option|option `[^`]*' requires a value/i,
  ],
];

/** The code CLASSIFICATION gives `text`; UNKNOWN when nothing matches. */
export function codeOf(text: string): GitErrorCode {
  for (const [code, pattern] of CLASSIFICATION) if (pattern.test(text)) return code;
  return "UNKNOWN";
}

/** A detail longer than this is cut: git can list thousands of files in one refusal. */
export const DETAIL_MAX = 8_000;

/** `text` cut to DETAIL_MAX characters, saying so. */
export function capDetail(text: string): string {
  return text.length <= DETAIL_MAX ? text : `${text.slice(0, DETAIL_MAX)}\n… (${text.length - DETAIL_MAX} more characters)`;
}

/** The GitError for a git command that exited with `exitCode`: its code from the output, its detail git's words. */
export function classify(stderr: string, stdout: string, exitCode: number, context: ClassifyContext = {}): GitError {
  // `git commit` and `git merge` say why on stdout; most commands on stderr.
  const code = codeOf(`${stderr}\n${stdout}`);
  const words = stderr.trim() || stdout.trim() || `git ${subcommand(context.args)}exited with code ${exitCode}`.trim();
  return new GitError(code, capDetail(redact(words)));
}

/** The subcommand of an argument list, for messages: `fetch ` from `-c x=y fetch origin`, else nothing. */
export function subcommand(args: readonly string[] | undefined): string {
  if (!args) return "";
  for (let n = 0; n < args.length; n++) {
    if (args[n] === "-c" || args[n] === "-C") n++;
    else if (!args[n].startsWith("-")) return `${args[n]} `;
  }
  return "";
}
