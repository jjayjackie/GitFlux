// How the `commit` command (Ctrl/Cmd+Enter, the Command Center's "Commit") reaches the commit composer. The command is
// handled by views/toolbar/SyncActions.tsx, which is always mounted; the composer is drawn only while the Changes pane
// is (not on the narrow layout's Graph tab, not while the pane is folded). So:
//   - a mounted composer of the repository takes the request: it commits when its message and the repository allow a
//     commit, and otherwise puts the cursor in the message box;
//   - with none mounted, SyncActions shows the Changes pane and the request waits (PENDING_MS) for the composer that
//     then mounts, which puts the cursor in its box (or commits, by the same rule).
// Keyed `hostId \0 cwd` (architecture §6). Pure (no React): unit-tested.

/** How long a request waits for a composer to mount. */
export const PENDING_MS = 5_000;

const composers = new Map<string, (() => void)[]>();
const pending = new Map<string, number>();

const scope = (hostId: string, cwd: string) => `${hostId}\u0000${cwd}`;

/** A composer of `cwd` takes commit requests while mounted; returns the remover. A request waiting for one is handed over. */
export function registerComposer(hostId: string, cwd: string, take: () => void, now = Date.now()): () => void {
  const key = scope(hostId, cwd);
  composers.set(key, [...(composers.get(key) ?? []), take]);
  const asked = pending.get(key);
  if (asked !== undefined) {
    pending.delete(key);
    if (now - asked < PENDING_MS) take();
  }
  return () => {
    const rest = (composers.get(key) ?? []).filter((other) => other !== take);
    if (rest.length === 0) composers.delete(key);
    else composers.set(key, rest);
  };
}

/** Asks the most recently mounted composer of `cwd` to commit. False when none is mounted: the request then waits. */
export function requestCommit(hostId: string, cwd: string, now = Date.now()): boolean {
  const key = scope(hostId, cwd);
  const list = composers.get(key);
  if (list && list.length > 0) {
    list[list.length - 1]();
    return true;
  }
  pending.set(key, now);
  return false;
}

/** Forgets one host's composers and waiting requests, or everything. */
export function clearCommitRequests(hostId?: string): void {
  if (hostId === undefined) {
    composers.clear();
    pending.clear();
    return;
  }
  const prefix = `${hostId}\u0000`;
  for (const key of [...composers.keys()]) if (key.startsWith(prefix)) composers.delete(key);
  for (const key of [...pending.keys()]) if (key.startsWith(prefix)) pending.delete(key);
}
