// The schemas every RPC contract is built from. Field names follow upstream's (shared/git.ts) wherever upstream has the
// field, so that the client logic reused from it (graph lanes, file trees, diff rows) keeps working: this file extends,
// it does not rename.
//
// Inputs are checked on the daemon (the SDK parses every input with its contract before the handler runs); outputs are
// checked by the client. So input schemas are strict and bounded (`.max` from limits.ts), and output schemas are as
// loose as the data allows: an output that fails its schema is lost to the user, while an input that fails is refused.
// An input check that fails carries the wire form of INVALID_ARGUMENT (or CONFIRMATION_REQUIRED) in its message, so the
// client decodes it like any other failure (shared/errors.ts).

import { z } from "zod";
import { encodeGitError } from "./errors.ts";
import { NAME_MAX, PATH_MAX } from "./limits.ts";

/** The message of an input check, in the wire form of INVALID_ARGUMENT. */
export const invalid = (detail: string) => encodeGitError("INVALID_ARGUMENT", detail);

/** A non-negative whole number: a count, a line number, an index. */
export const countSchema = z.number().int().nonnegative();

/** Seconds since the epoch, as git prints `%at` / `%ct`. */
export const timeSchema = z.number();

/**
 * `confirm: true`, which every input that can lose work or rewrite published history requires (architecture §5). The
 * client sets it only from a dialog that named what will be lost; anything else is refused with CONFIRMATION_REQUIRED.
 */
export const confirmed = z.literal(true, {
  error: encodeGitError("CONFIRMATION_REQUIRED", "This operation needs confirm: true"),
});

// --- names and paths ----------------------------------------------------------------

/** A full commit (or other object) name: SHA-1's 40 or SHA-256's 64 lowercase hex digits. */
export const hashSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/, invalid("Not a full commit hash"));
export type Hash = z.infer<typeof hashSchema>;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A branch, tag or other ref name, short (`feat/x`, `origin/feat/x`) or full (`refs/heads/x`). It rules out what
 * `git check-ref-format` rules out that can be seen without git; the daemon runs `check-ref-format` as well.
 */
export const refNameSchema = z
  .string()
  .min(1, invalid("A name cannot be empty"))
  .max(NAME_MAX, invalid("The name is too long"))
  .refine((name) => !name.startsWith("-"), invalid("A name cannot start with '-'"))
  .refine((name) => !CONTROL.test(name) && !/[\s~^:?*[\\]/.test(name), invalid("A name cannot hold spaces, control characters or ~^:?*[\\"))
  .refine(
    (name) =>
      !name.includes("..") &&
      !name.includes("@{") &&
      !name.includes("//") &&
      !name.startsWith("/") &&
      !name.endsWith("/") &&
      !name.endsWith(".") &&
      !name.endsWith(".lock") &&
      name !== "@" &&
      !name.split("/").some((part) => part.startsWith(".")),
    invalid("Not a valid ref name"),
  );

/** A remote's name (`origin`). The same rules as a ref name. */
export const remoteNameSchema = refNameSchema;

/**
 * A revision git resolves: a ref name, a hash (full or abbreviated), `HEAD~2`, `main^2`, `@{u}`, `stash@{1}`. It never
 * starts with `-`, and the daemon passes it after `--end-of-options`.
 */
export const revisionSchema = z
  .string()
  .min(1, invalid("A revision cannot be empty"))
  .max(NAME_MAX, invalid("The revision is too long"))
  .refine((revision) => !revision.startsWith("-"), invalid("A revision cannot start with '-'"))
  .refine((revision) => !CONTROL.test(revision) && !/\s/.test(revision), invalid("A revision cannot hold spaces or control characters"));

const ABSOLUTE = /^(?:[\\/]|[A-Za-z]:[\\/])/;

/**
 * A path relative to the repository's root, as git names files (`/`-separated). Never absolute, never with a `..`
 * part; the daemon also checks that it stays inside the root after normalisation, and always puts it after `--`.
 */
export const repoPathSchema = z
  .string()
  .min(1, invalid("A path cannot be empty"))
  .max(PATH_MAX, invalid("The path is too long"))
  .refine((path) => !path.includes("\0"), invalid("A path cannot hold NUL"))
  .refine((path) => !ABSOLUTE.test(path) && !path.split(/[\\/]/).includes(".."), invalid("The path must stay inside the repository"));

/**
 * An absolute directory on the daemon host: a repository's root (`git rev-parse --show-toplevel`), or, for
 * `git.repo.discover`, a workspace folder. The daemon checks that it exists and is what it should be.
 */
export const cwdSchema = z
  .string()
  .min(1, invalid("cwd cannot be empty"))
  .max(PATH_MAX, invalid("cwd is too long"))
  .refine((path) => !path.includes("\0"), invalid("cwd cannot hold NUL"))
  .refine((path) => ABSOLUTE.test(path), invalid("cwd must be an absolute path"));

/** An absolute path on the daemon host other than `cwd` (a new worktree's folder). */
export const absolutePathSchema = cwdSchema;

// --- files ---------------------------------------------------------------------------

/**
 * A conflict's two letters from git: what each side did, us then them. DD both deleted, AU added by us, UD deleted by
 * them, UA added by them, DU deleted by us, AA both added, UU both modified.
 */
export const conflictKindSchema = z.enum(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
export type ConflictKind = z.infer<typeof conflictKindSchema>;

/** A changed file, as upstream lists it, with its line counts where they are known. */
export const fileSchema = z.object({
  path: repoPathSchema,
  from: repoPathSchema.optional(), // a rename's or copy's old path
  status: z.string().min(1).max(2), // one letter: M A D R C T, U for a conflict, ? for untracked
  conflict: conflictKindSchema.optional(),
  additions: countSchema.optional(), // lines added, from numstat; absent when unknown or binary
  deletions: countSchema.optional(), // lines deleted, likewise
  binary: z.boolean().optional(), // true when numstat says the file is binary
});
export type FileChange = z.infer<typeof fileSchema>;

// --- commits -------------------------------------------------------------------------

/** A ref pointing at a commit, as the graph draws it. */
export const refSchema = z.object({
  kind: z.enum(["head", "branch", "remote", "tag"]), // head: the checked-out branch, or a detached HEAD
  name: z.string(),
});
export type Ref = z.infer<typeof refSchema>;

/** A row of the graph. Lean on purpose: a page holds hundreds. */
export const commitSchema = z.object({
  hash: hashSchema,
  parents: z.array(hashSchema),
  author: z.string(), // the author's name
  email: z.string(), // the author's email
  time: timeSchema, // author time
  subject: z.string(),
  refs: z.array(refSchema),
});
export type Commit = z.infer<typeof commitSchema>;

/** Who wrote or committed a commit, and when. */
export const personSchema = z.object({ name: z.string(), email: z.string(), time: timeSchema });
export type Person = z.infer<typeof personSchema>;

/**
 * A commit's signature as `git log --format=%G?` judges it: good (G), untrusted (U: good, of unknown validity), bad (B),
 * expired (X: an expired signature), expired-key (Y), revoked (R), unverifiable (E: the key is missing).
 */
export const signatureSchema = z.object({
  status: z.enum(["good", "untrusted", "bad", "expired", "expired-key", "revoked", "unverifiable"]),
  signer: z.string().nullable(), // %GS
  key: z.string().nullable(), // %GK
});
export type Signature = z.infer<typeof signatureSchema>;

/** Shortstat-like totals for a set of files. */
export const statsSchema = z.object({ files: countSchema, insertions: countSchema, deletions: countSchema });
export type Stats = z.infer<typeof statsSchema>;

/** Everything the detail pane shows for one commit. */
export const commitDetailSchema = z.object({
  hash: hashSchema,
  parents: z.array(hashSchema),
  author: personSchema,
  committer: personSchema,
  subject: z.string(),
  body: z.string(), // the full message, subject included, as `%B` prints it
  refs: z.array(refSchema),
  files: z.array(fileSchema), // against the first parent, with numstat counts; at most COMMIT_FILES_MAX
  filesTruncated: z.boolean(), // more files changed than are listed
  stats: statsSchema, // over every file, listed or not
  signature: signatureSchema.nullable().optional(), // null: unsigned; absent: not checked
});
export type CommitDetail = z.infer<typeof commitDetailSchema>;

// --- operations under way -------------------------------------------------------------

/** A multi-step operation git can have under way in a work tree. */
export const operationSchema = z.enum(["merge", "rebase", "cherry-pick", "revert", "bisect", "am"]);
export type Operation = z.infer<typeof operationSchema>;

/**
 * An operation under way, as the status reads it. Every kind has `current` (the commit being applied: MERGE_HEAD,
 * REBASE_HEAD, CHERRY_PICK_HEAD, REVERT_HEAD, or for bisect the commit to test) and `message` (the message git
 * prepared for it), each null where git has none.
 */
export const operationStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("merge"), current: hashSchema.nullable(), message: z.string().nullable() }),
  z.object({
    kind: z.literal("rebase"),
    current: hashSchema.nullable(),
    message: z.string().nullable(),
    step: countSchema.nullable(), // the step being applied, from 1
    total: countSchema.nullable(), // steps in all
    onto: hashSchema.nullable(), // the commit the branch is replayed onto
    branch: z.string().nullable(), // the branch being rebased, short name; null when it was a detached HEAD
    interactive: z.boolean(), // rebase-merge with a todo list the user wrote (`git rebase -i`, git.rebase.start)
    stoppedForEdit: z.boolean(), // stopped by an `edit` (or `break`), not by a conflict: amend, then continue
  }),
  z.object({ kind: z.literal("cherry-pick"), current: hashSchema.nullable(), message: z.string().nullable() }),
  z.object({ kind: z.literal("revert"), current: hashSchema.nullable(), message: z.string().nullable() }),
  z.object({ kind: z.literal("bisect"), current: hashSchema.nullable(), message: z.string().nullable() }),
  z.object({
    kind: z.literal("am"),
    current: hashSchema.nullable(),
    message: z.string().nullable(),
    step: countSchema.nullable(),
    total: countSchema.nullable(),
  }),
]);
export type OperationState = z.infer<typeof operationStateSchema>;

// --- repositories ----------------------------------------------------------------------

/** A repository discovery lists. */
export const repositorySchema = z.object({
  root: z.string(), // its work tree's top level: the `cwd` of every other call
  name: z.string(),
  branch: z.string().nullable(), // null when HEAD is detached
  head: z.string().nullable(), // the checked-out commit; null before the first one
  upstream: z.string().nullable(), // the branch it follows on a remote, if any
  ahead: countSchema, // commits the upstream lacks, and
  behind: countSchema, // commits only the upstream has, as of the last fetch
  // What VS Code marks beside the branch: changed or untracked files, staged ones, a merge or rebase under way.
  changed: z.boolean(),
  staged: z.boolean(),
  merging: z.boolean(),
  failed: z.string().nullable(), // why git could not read it; the others are listed all the same
  // repository: a repository of its own (at the folder, or nested anywhere below it); submodule: registered in its
  // parent's .gitmodules; worktree: a linked work tree of a repository listed elsewhere (or outside the folder).
  kind: z.enum(["repository", "submodule", "worktree"]),
  parent: z.string().nullable(), // root of the repository that contains it (submodules, nested repositories); null at the top
  mainRoot: z.string().nullable(), // for a linked worktree, its main work tree's root; else null
  depth: countSchema, // folder levels below the workspace folder; 0 for the folder itself (and for one above it)
  conflicted: z.boolean(), // files in conflict
  operation: operationSchema.nullable(), // what is under way, if anything
  initialized: z.boolean(), // false for a submodule not yet initialised (it has no work tree to read; `failed` is null)
});
export type Repository = z.infer<typeof repositorySchema>;

/** One repository's working state, as the Changes view and toolbar show it. */
export const statusSchema = z.object({
  branch: z.string().nullable(), // null when HEAD is detached
  head: hashSchema.nullable(), // null before the first commit
  detached: z.boolean(), // HEAD is not on a branch
  upstream: z.string().nullable(),
  upstreamGone: z.boolean(), // the branch has an upstream configured that no longer exists on the remote
  // The branch on a remote the checked-out branch was made from, found as VS Code finds it; null when that is its upstream.
  base: z.string().nullable(),
  ahead: countSchema,
  behind: countSchema,
  conflicts: z.array(fileSchema),
  staged: z.array(fileSchema),
  changes: z.array(fileSchema), // unstaged and untracked
  refs: z.string(), // changes whenever any ref moves: the history is stale
  // As in VS Code, git status is read for so many files at most: set when there were more, and only that many are listed.
  cutAt: countSchema.nullable(),
  hugeFolders: z.array(z.string()), // then, the folders VS Code offers to add to .gitignore: node_modules, when git does not ignore it
  operation: operationStateSchema.nullable(), // under way, to be continued, skipped or aborted
  rebaseMessage: z.string().nullable(), // while rebasing, the message of the commit being applied (upstream's; also in `operation`)
  // What VS Code starts the commit message from: the merge's or squash's message, else git's commit.template.
  template: z.string(),
  stashCount: countSchema,
});
export type Status = z.infer<typeof statusSchema>;

// --- lists of refs and other things ----------------------------------------------------

/** A local branch. */
export const branchEntrySchema = z.object({
  name: z.string(), // short name: `feat/x`
  hash: hashSchema,
  upstream: z.string().nullable(), // short name of what it follows: `origin/feat/x`
  upstreamGone: z.boolean(), // an upstream is configured but no longer exists
  ahead: countSchema, // against its upstream; 0 without one
  behind: countSchema,
  current: z.boolean(), // checked out in this work tree
  worktree: z.string().nullable(), // path of another work tree that has it checked out; it cannot be checked out here
  time: timeSchema, // committer time of its tip
  subject: z.string(), // its tip's subject
  protected: z.boolean(), // matches the host's `protectedBranches`
});
export type BranchEntry = z.infer<typeof branchEntrySchema>;

/** A remote-tracking branch. `<remote>/HEAD` itself is not listed. */
export const remoteBranchEntrySchema = z.object({
  name: z.string(), // `origin/feat/x`
  remote: z.string(), // `origin`
  branch: z.string(), // `feat/x`
  hash: hashSchema,
  time: timeSchema,
  subject: z.string(),
  isHead: z.boolean(), // the remote's default branch: what `<remote>/HEAD` points at
});
export type RemoteBranchEntry = z.infer<typeof remoteBranchEntrySchema>;

/** A configured remote. URLs come redacted: no user-info, no token. */
export const remoteEntrySchema = z.object({ name: z.string(), fetchUrl: z.string(), pushUrl: z.string() });
export type RemoteEntry = z.infer<typeof remoteEntrySchema>;

/** A tag. */
export const tagEntrySchema = z.object({
  name: z.string(),
  hash: hashSchema, // the object it points at, peeled through tag objects: a commit, or rarely a tree or blob
  annotated: z.boolean(),
  message: z.string().optional(), // an annotated tag's message
  tagger: z.string().optional(), // an annotated tag's tagger name
  time: timeSchema, // the tagger's time when annotated, else the commit's
});
export type TagEntry = z.infer<typeof tagEntrySchema>;

/** A stash. Act on it by `hash`: indexes move when the list changes. */
export const stashEntrySchema = z.object({
  index: countSchema, // n in stash@{n}, as listed
  ref: z.string(), // `stash@{n}`
  hash: hashSchema, // the stash commit
  message: z.string(),
  branch: z.string().nullable(), // the branch it was made on; null when HEAD was detached
  time: timeSchema,
});
export type StashEntry = z.infer<typeof stashEntrySchema>;

/** A work tree of the repository, from `git worktree list --porcelain`. */
export const worktreeEntrySchema = z.object({
  path: z.string(), // absolute
  head: hashSchema.nullable(), // null for a bare repository, or one before its first commit
  branch: z.string().nullable(), // short name; null when detached or bare
  detached: z.boolean(),
  bare: z.boolean(),
  locked: z.boolean(),
  prunable: z.boolean(), // its folder is gone; `git.worktree.prune` removes the record
  main: z.boolean(), // the main work tree (listed first)
  current: z.boolean(), // the one `cwd` names
});
export type WorktreeEntry = z.infer<typeof worktreeEntrySchema>;

/** A submodule, from .gitmodules and `git submodule status`. */
export const submoduleEntrySchema = z.object({
  path: z.string(), // relative to the parent's root
  root: z.string(), // absolute root of its work tree (where it would be when uninitialised)
  url: z.string(), // redacted
  hash: hashSchema.nullable(), // checked out in it; null when uninitialised
  expected: hashSchema.nullable(), // recorded in the parent's index; null when not recorded
  // uninitialized: no work tree yet; clean: at the recorded commit; modified: it has local changes; conflict: in
  // conflict in the parent; ahead: checked out at a commit other than the recorded one.
  state: z.enum(["uninitialized", "clean", "modified", "conflict", "ahead"]),
  branch: z.string().optional(), // `submodule.<name>.branch`
  describe: z.string().optional(), // `git describe` of `hash`, as `git submodule status` prints it
});
export type SubmoduleEntry = z.infer<typeof submoduleEntrySchema>;

/** A safety snapshot: tracked changes recorded before an operation that could discard them (architecture §5). */
export const snapshotEntrySchema = z.object({
  ref: z.string(), // `refs/advanced-git/snapshots/<time>`
  hash: hashSchema, // the `git stash create` commit
  time: timeSchema,
  reason: z.string(), // the wire name of the RPC that took it, e.g. `git.branch.reset`
  branch: z.string().nullable(), // checked out when it was taken; null when detached
});
export type SnapshotEntry = z.infer<typeof snapshotEntrySchema>;

// --- diffs ------------------------------------------------------------------------------

/** What a diff compares. */
export const diffSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commit"), hash: hashSchema }), // against its first parent
  z.object({ kind: z.literal("staged") }), // HEAD against the index
  z.object({ kind: z.literal("changes") }), // the index against the work tree
  // What a pull would bring, from the commit HEAD and its upstream share to the upstream; and what a push would send, to HEAD.
  z.object({ kind: z.literal("incoming"), from: hashSchema, to: hashSchema }),
  z.object({ kind: z.literal("outgoing"), from: hashSchema, to: hashSchema }),
  // A stash's tracked changes against the commit it was made on; its untracked files show as added.
  z.object({ kind: z.literal("stash"), hash: hashSchema }),
  // Any two revisions, as `git.history.compare` lists them.
  z.object({ kind: z.literal("compare"), from: revisionSchema, to: revisionSchema }),
]);
export type DiffSource = z.infer<typeof diffSourceSchema>;

/** How a diff treats whitespace: ignore-trim, VS Code's default, ignores changes at the ends of lines only. */
export const whitespaceModeSchema = z.enum(["ignore-trim", "show"]);
export type WhitespaceMode = z.infer<typeof whitespaceModeSchema>;

const lineRange = z.tuple([z.number(), z.number()]); // the first line, and the one after the last, counted from 1
const range = z.tuple([z.number(), z.number(), z.number(), z.number()]); // start line and column, end line and the column after, from 1

/** Lines that changed, as VS Code's diff computes them, with the stretches of text that changed within them. */
export const lineChangeSchema = z.object({ original: lineRange, modified: lineRange, inner: z.array(z.object({ original: range, modified: range })) });
export type LineChange = z.infer<typeof lineChangeSchema>;

/**
 * Syntax scope names (highlight.js's vocabulary, which the daemon maps its tokeniser's kinds onto), indexed by the
 * `scope` numbers of a token line. Index 0 is plain text. Server and client
 * share this table, so appending is safe and reordering is not.
 */
export const TOKEN_SCOPES = [
  "none",
  "keyword",
  "string",
  "comment",
  "number",
  "literal",
  "built_in",
  "type",
  "title",
  "function",
  "class",
  "params",
  "variable",
  "property",
  "attr",
  "attribute",
  "operator",
  "punctuation",
  "tag",
  "name",
  "meta",
  "regexp",
  "symbol",
  "section",
  "addition",
  "deletion",
  "emphasis",
  "strong",
  "link",
  "doctag",
  "subst",
  "selector",
  "bullet",
  "code",
  "quote",
  "template",
  "char",
] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/**
 * One line's syntax tokens, flat: `[length, scope, length, scope, …]`, lengths in UTF-16 code units from the start of
 * the line, `scope` an index into TOKEN_SCOPES. Text past the last token is plain.
 */
export const tokenLineSchema = z.array(countSchema);
export type TokenLine = z.infer<typeof tokenLineSchema>;

/** Tokens for every line of a side, one entry per line. */
export const tokensSchema = z.array(tokenLineSchema);
export type Tokens = z.infer<typeof tokensSchema>;

// --- hunks --------------------------------------------------------------------------------

/** A line of a hunk. `oldLine` is set for context and delete lines, `newLine` for context and add lines. */
export const hunkLineSchema = z.object({
  kind: z.enum(["context", "add", "delete"]),
  text: z.string(), // without the leading ' ', '+' or '-', and without the line break
  oldLine: countSchema.optional(),
  newLine: countSchema.optional(),
  noNewline: z.boolean().optional(), // followed by "\ No newline at end of file"
});
export type HunkLine = z.infer<typeof hunkLineSchema>;

/** A hunk of a file's unified diff, for staging, unstaging or discarding it whole or line by line. */
export const hunkSchema = z.object({
  // A fingerprint of the hunk's position and lines. git.changes.apply-hunks names hunks by it, and fails with
  // STALE_STATE when the current diff has no hunk with that id.
  id: z.string(),
  header: z.string(), // "@@ -a,b +c,d @@ …", as git prints it
  oldStart: countSchema,
  oldLines: countSchema,
  newStart: countSchema,
  newLines: countSchema,
  lines: z.array(hunkLineSchema),
});
export type Hunk = z.infer<typeof hunkSchema>;
