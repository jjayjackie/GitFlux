// The error codes a handler fails with, and their wire form.
//
// A handler throws `GitError(code, detail)` (server/core/errors.ts); server/core/handler.ts turns it into an `Error`
// whose message is `encodeGitError(code, detail)`. A transport may wrap that message in text of its own (a prefix, or
// the JSON of a schema's issues when an input is refused), so the client finds it with `decodeGitError`, which searches
// the message rather than reading it from the start. Pure functions only: this file is unit-tested and shared by both
// halves.

/** Every code a failure can carry. The client translates each one (`error.<CODE>.title`). */
export const GIT_ERROR_CODES = [
  "GIT_NOT_FOUND", // no git on the daemon host's PATH
  "NOT_A_REPOSITORY", // `cwd` is not the top level of a work tree
  "INVALID_ARGUMENT", // an input the schema or core/validate.ts refuses
  "PATH_OUTSIDE_REPOSITORY", // a file path that escapes the repository's root
  "REPOSITORY_BUSY", // another write to the same repository held the queue too long
  "INDEX_LOCKED", // an `index.lock` is in the way; it is reported, never deleted
  "TIMEOUT", // git ran past its deadline and was stopped
  "OUTPUT_TOO_LARGE", // git said more than the plugin reads
  "AUTH_FAILED", // the remote refused the host's credentials, or there were none
  "HOST_KEY_VERIFICATION_FAILED", // the remote's SSH host key is unknown or changed
  "NETWORK", // the remote could not be reached
  "REMOTE_REJECTED", // the remote refused the push (hook, protection rule…)
  "NON_FAST_FORWARD", // the push or pull would need a merge or a force
  "NO_UPSTREAM", // the branch follows nothing
  "NO_REMOTE", // the repository has no remote, or not the one named
  "MERGE_CONFLICT", // the operation stopped on conflicts
  "WOULD_OVERWRITE_CHANGES", // local changes are in the way
  "UNMERGED_BRANCH", // deleting a branch that is not merged needs `force`
  "REF_EXISTS", // a branch, tag, remote or worktree of that name exists
  "REF_NOT_FOUND", // a branch, tag, remote, stash or revision is not there
  "NOTHING_TO_COMMIT",
  "IDENTITY_MISSING", // user.name / user.email are not set
  "OPERATION_IN_PROGRESS", // a merge, rebase, cherry-pick, revert, bisect or am is under way
  "NO_OPERATION", // continue / abort / skip with nothing under way
  "FORBIDDEN_BY_POLICY", // a host setting (named in `setting`) does not allow it
  "PROTECTED_BRANCH", // the branch matches `protectedBranches`
  "CONFIRMATION_REQUIRED", // a destructive call without `confirm: true`
  "STALE_STATE", // the repository changed since the client read it (a hunk, a stash, a plan)
  "HOOK_FAILED", // a git hook refused the operation
  "UNKNOWN",
] as const;

export type GitErrorCode = (typeof GIT_ERROR_CODES)[number];

/** A failure as the client sees it: the code, git's own (redacted) words, and for FORBIDDEN_BY_POLICY the setting. */
export interface GitErrorInfo {
  code: GitErrorCode;
  detail: string;
  /** The `safety` setting that gates the call, e.g. `allowForcePush`; set for FORBIDDEN_BY_POLICY. */
  setting?: string;
}

const CODES: ReadonlySet<string> = new Set(GIT_ERROR_CODES);

export function isGitErrorCode(value: string): value is GitErrorCode {
  return CODES.has(value);
}

// The wire form: `[[advanced-git:CODE]]detail[[/advanced-git]]`, or `[[advanced-git:CODE:setting]]…`. The closing
// sentinel lets the detail be cut out of a longer message; a message that lost it ends the detail at its own end.
const OPEN = /\[\[advanced-git:([A-Z_]+)(?::([A-Za-z][A-Za-z0-9_]*))?\]\]/;
const CLOSE = "[[/advanced-git]]";
const SETTING = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Text that looks like a sentinel, inside a detail, is broken up so that it cannot be read as one. */
const defuse = (text: string) => text.replace(/\[\[(\/?)advanced-git/g, "[ [$1advanced-git");

/** The message of an Error that carries `code`. `extra.setting` must be a plain identifier, or it is left out. */
export function encodeGitError(code: GitErrorCode, detail: string, extra?: { setting?: string }): string {
  const setting = extra?.setting !== undefined && SETTING.test(extra.setting) ? `:${extra.setting}` : "";
  return `[[advanced-git:${code}${setting}]]${defuse(detail)}${CLOSE}`;
}

/** Finds the wire form anywhere in `message`; null when there is none or its code is not one of GIT_ERROR_CODES. */
export function decodeGitError(message: string): GitErrorInfo | null {
  const match = OPEN.exec(message);
  if (!match) return null;
  const code = match[1];
  if (!isGitErrorCode(code)) return null;
  const rest = message.slice(match.index + match[0].length);
  const end = rest.indexOf(CLOSE);
  const detail = (end === -1 ? rest : rest.slice(0, end)).trim();
  return match[2] === undefined ? { code, detail } : { code, detail, setting: match[2] };
}

/** The message of whatever was thrown, without assuming it is an Error. */
function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return String(error);
}

/** Reads a failure: its wire form if it carries one (looking one level into `cause`), else UNKNOWN with its message. */
export function gitErrorFrom(error: unknown): GitErrorInfo {
  const message = messageOf(error);
  const decoded = decodeGitError(message);
  if (decoded) return decoded;
  if (error instanceof Error && error.cause !== undefined) {
    const cause = decodeGitError(messageOf(error.cause));
    if (cause) return cause;
  }
  return { code: "UNKNOWN", detail: message };
}
