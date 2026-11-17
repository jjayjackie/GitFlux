// Query keys (architecture §6): every key starts `["advanced-git", hostId, …]`, so two hosts never share a cached
// answer, and a repository's queries share a prefix, so one invalidation reads all of them again. Pure: unit-tested.
//
// The shape:
//   ["advanced-git", hostId, "repo", cwd, rpcName, rest-of-input]   a query of one repository (its input has `cwd`)
//   ["advanced-git", hostId, "rpc", rpcName, input]                  a query of the host (git.safety.policy)
//   ["advanced-git", hostId, "auto-fetch", cwd]                      the background fetch (not read again by invalidation)
// state/rpc.ts's useGitQuery builds the first two from the contract and the input, so the factories below name the same
// keys: pass one to `queryClient.invalidateQueries({ queryKey })` (a factory called without `params` is the prefix of
// every query of that family), or to `getQueryData` with the exact params.
//
// Usage:
//   invalidateRepo(queryClient, hostId, cwd);                       // after anything that changes the repository
//   queryClient.invalidateQueries({ queryKey: keys.log(hostId, cwd) });   // only the graph's pages
//   queryClient.getQueryData(keys.status(hostId, cwd));

/** The first part of every query key of the plugin. */
export const QUERY_PREFIX = "advanced-git";

export type GitQueryKey = readonly unknown[];

/** Any key of one host: `["advanced-git", hostId, …parts]`. */
export function gitKey(hostId: string, ...parts: readonly unknown[]): GitQueryKey {
  return [QUERY_PREFIX, hostId, ...parts];
}

/** What a query's input looks like to the key builder. */
type Input = Readonly<Record<string, unknown>> | null | undefined;

/**
 * The key useGitQuery gives `rpcName` called with `input`: under the repository when the input names a `cwd`, under the
 * host otherwise. `cwd` itself is taken out of the rest, which TanStack Query hashes with its keys sorted.
 */
export function rpcKey(hostId: string, rpcName: string, input: Input): GitQueryKey {
  const value = input ?? {};
  const cwd = value.cwd;
  if (typeof cwd === "string") {
    const rest: Record<string, unknown> = {};
    for (const [name, part] of Object.entries(value)) if (name !== "cwd" && part !== undefined) rest[name] = part;
    return gitKey(hostId, "repo", cwd, rpcName, rest);
  }
  return gitKey(hostId, "rpc", rpcName, value);
}

/** A repository-scoped family: without `params`, the prefix of all of them; with, the exact key of one. */
const family =
  (rpcName: string) =>
  (hostId: string, cwd: string, params?: Readonly<Record<string, unknown>>): GitQueryKey =>
    params === undefined ? gitKey(hostId, "repo", cwd, rpcName) : rpcKey(hostId, rpcName, { ...params, cwd });

/** Key factories, one per query family. Each names the RPC whose answers it caches. */
export const keys = {
  /** Every query of the host. */
  host: (hostId: string): GitQueryKey => gitKey(hostId),
  /** Every query of one repository. */
  repo: (hostId: string, cwd: string): GitQueryKey => gitKey(hostId, "repo", cwd),
  /** git.repo.discover, for a workspace directory (its `cwd` is that directory). */
  repositories: family("git.repo.discover"),
  status: family("git.repo.status"),
  log: family("git.history.log"),
  commit: family("git.history.show"),
  compare: family("git.history.compare"),
  fileHistory: family("git.history.file"),
  blame: family("git.history.blame"),
  branches: family("git.branch.list"),
  remotes: family("git.remote.list"),
  tags: family("git.tag.list"),
  stashes: family("git.stash.list"),
  stash: family("git.stash.show"),
  worktrees: family("git.worktree.list"),
  submodules: family("git.submodule.list"),
  diff: family("git.diff.file"),
  hunks: family("git.changes.hunks"),
  markers: family("git.changes.markers"),
  conflict: family("git.conflict.sides"),
  rebasePlan: family("git.rebase.plan"),
  snapshots: family("git.safety.snapshots"),
  /** git.safety.policy: the host's, not a repository's. */
  policy: (hostId: string): GitQueryKey => rpcKey(hostId, "git.safety.policy", {}),
  /** The background fetch of a repository. Outside the repository's prefix: reading a repository again does not fetch. */
  autoFetch: (hostId: string, cwd: string): GitQueryKey => gitKey(hostId, "auto-fetch", cwd),
} as const;

/** Whether a key belongs to the plugin and to `hostId`. */
export function isHostKey(key: readonly unknown[], hostId: string): boolean {
  return key[0] === QUERY_PREFIX && key[1] === hostId;
}

/** Whether a key is a background fetch (invalidateHost leaves those alone: they talk to remotes). */
export function isAutoFetchKey(key: readonly unknown[]): boolean {
  return key[0] === QUERY_PREFIX && key[2] === "auto-fetch";
}

/** Whether a key is a repository discovery (what the navigation lists, with each repository's branch and sync state). */
export function isDiscoveryKey(key: readonly unknown[]): boolean {
  return key[0] === QUERY_PREFIX && key[2] === "repo" && key[4] === "git.repo.discover";
}

/** The part of TanStack's QueryClient used here, so that this file needs no import and stays testable. */
export interface Invalidator {
  invalidateQueries(filters: { queryKey?: readonly unknown[]; predicate?: (query: { queryKey: readonly unknown[] }) => boolean }): Promise<void>;
}

/**
 * Reads one repository again: every query under it, and the host's repository discoveries (they show its branch and
 * ahead/behind). Call after any operation on it.
 */
export function invalidateRepo(queryClient: Invalidator, hostId: string, cwd: string): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.repo(hostId, cwd) }),
    queryClient.invalidateQueries({ predicate: (query) => isHostKey(query.queryKey, hostId) && isDiscoveryKey(query.queryKey) }),
  ]).then(() => undefined);
}

/** Reads everything of one host again (after it reconnects), except the background fetches. */
export function invalidateHost(queryClient: Invalidator, hostId: string): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (query) => isHostKey(query.queryKey, hostId) && !isAutoFetchKey(query.queryKey) });
}
