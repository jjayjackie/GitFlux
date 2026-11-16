// Every numeric bound the plugin keeps (docs/architecture.md §6 and §7), named, so that the schemas, the daemon and
// the panel agree. Past a bound a result says it was cut (`truncated`, `more`, `cutAt`); nothing is dropped silently.

// --- working tree -----------------------------------------------------------------

/** Files `git status` is read for, as VS Code's git.statusLimit; past it, `cutAt` is set. */
export const STATUS_LIMIT = 10_000;

/** Paths one call may name (stage, unstage, discard, ignore, resolve, stash…); git is run on them in chunks. */
export const PATHS_MAX = 10_000;

/** Hunks returned for one file by `git.changes.hunks`; past it, `truncated`. */
export const HUNKS_MAX = 1_000;

/** Hunks one `git.changes.apply-hunks` call may name. */
export const APPLY_HUNKS_MAX = HUNKS_MAX;

/** Line indexes one hunk selection may name. */
export const HUNK_LINES_MAX = 20_000;

/** Bytes read from each side of a conflict (base, ours, theirs, the work-tree file); past it, `truncated`. */
export const CONFLICT_SIDE_MAX_BYTES = 2 * 1024 * 1024;

// --- history ----------------------------------------------------------------------

/** Commits the graph reads at first, and adds with each "Load more". */
export const LOG_PAGE = 200;

/** The most commits one `git.history.log` or `git.history.file` call may ask for. */
export const LOG_PAGE_MAX = 5_000;

/** The furthest a log may be paged into (`skip`). */
export const LOG_SKIP_MAX = 1_000_000;

/** Commits a search (message, author, hash, path, content) returns per call; `more` tells there were others. */
export const SEARCH_LIMIT = 500;

/** Refs one log may be scoped to. */
export const LOG_REFS_MAX = 100;

/** Lines of a file `git blame` is read for; past it, `truncated`. */
export const BLAME_MAX_LINES = 20_000;

/** Files listed for one commit, stash or comparison. */
export const COMMIT_FILES_MAX = 5_000;

/** Commits an interactive rebase may rewrite at once (`git.rebase.plan` lists so many at most). */
export const REBASE_TODO_MAX = 500;

/** Commits one revert or cherry-pick may name. */
export const PICK_MAX = 500;

// --- diffs ------------------------------------------------------------------------

/** Bytes of each side of a file the diff reads; past it the answer is `too-large`. */
export const DIFF_MAX_BYTES = 10 * 1024 * 1024;

/** Lines of each side of a file the diff compares; past it the answer is cut (`truncated`). */
export const DIFF_MAX_LINES = 100_000;

/** Bytes of a side that is still syntax-highlighted; a larger one comes without tokens. */
export const HIGHLIGHT_MAX_BYTES = 1024 * 1024;

/** Bytes read from the start of a file to decide it is binary, as git does. */
export const BINARY_SNIFF_BYTES = 8_000;

// --- lists ------------------------------------------------------------------------

/** Branches (local and remote, each), tags, stashes, worktrees, submodules and remotes listed at most; past it, `truncated`. */
export const LIST_MAX = 5_000;

/** Safety snapshots kept per repository; the oldest beyond it are removed. */
export const SNAPSHOT_KEEP = 50;

// --- repository discovery ---------------------------------------------------------

/** Folder levels below a workspace folder searched for nested repositories. */
export const SCAN_MAX_DEPTH = 6;

/** Repositories (nested, submodules, worktrees) discovery lists at most; past it, `truncated`. */
export const SCAN_MAX_REPOSITORIES = 200;

/** Folders discovery opens at most, whatever the depth, so a huge tree cannot stall it. */
export const SCAN_MAX_FOLDERS = 20_000;

// --- inputs -----------------------------------------------------------------------

/** Characters of a commit, tag, stash or merge message. */
export const MESSAGE_MAX = 100_000;

/** Characters of a ref, branch, tag, remote or revision name. */
export const NAME_MAX = 1_024;

/** Characters of a path, absolute or relative. */
export const PATH_MAX = 4_096;

/** Characters of a remote URL. */
export const URL_MAX = 4_096;

/** Characters of a search text or author filter. */
export const SEARCH_TEXT_MAX = 1_000;

/** Glob patterns in `protectedBranches`. */
export const PROTECTED_BRANCHES_MAX = 100;

// --- processes --------------------------------------------------------------------

/** Characters of paths put on one git command line, as VS Code's (microsoft/vscode#65693); more go in further runs. */
export const MAX_CLI_LENGTH = 30_000;

/** Bytes of stdout read from one git command; past it, OUTPUT_TOO_LARGE. */
export const MAX_BUFFER = 64 * 1024 * 1024;

/** Deadline of a command that only reads. */
export const TIMEOUT_READ_MS = 30_000;

/** Deadline of a command that writes locally (commit, merge, rebase, checkout…). */
export const TIMEOUT_WRITE_MS = 120_000;

/** Deadline of a command that talks to a remote (fetch, pull, push, submodule update…). */
export const TIMEOUT_NETWORK_MS = 180_000;

/** What the client's watchdog adds to the server's deadline before it gives up on an answer. */
export const CLIENT_TIMEOUT_SLACK_MS = 15_000;

/** How long a write waits for the repository's queue before it fails with REPOSITORY_BUSY. */
export const LOCK_WAIT_MS = 60_000;
