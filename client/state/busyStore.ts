// The operations running on each repository (architecture §6, "Concurrency"): what the toolbar says ("Pushing…") and
// what disables controls that would conflict. Keyed `hostId \0 cwd`: nothing is shared between hosts. Pure (no React):
// unit-tested. The hook is in ./busy.ts; state/rpc.ts's useGitMutation marks a repository busy while a mutation with a
// `label` runs.

/** What a running operation is called in the toolbar: a key under `toolbar.busy` in en.json. */
export const BUSY_LABELS = [
  "working",
  "fetching",
  "pulling",
  "pushing",
  "syncing",
  "committing",
  "switching",
  "merging",
  "rebasing",
  "resetting",
  "stashing",
  "staging",
  "unstaging",
  "discarding",
  "reverting",
  "cherryPicking",
  "deleting",
  "tagging",
  "resolving",
  "updatingSubmodules",
  "restoring",
] as const;
export type BusyLabel = (typeof BUSY_LABELS)[number];

export interface BusyOperation {
  id: number;
  label: BusyLabel;
  /** The RPC running, e.g. `git.remote.push`. */
  rpc: string;
  /** When it started, in milliseconds. */
  started: number;
}

const NONE: readonly BusyOperation[] = [];
const running = new Map<string, readonly BusyOperation[]>();
const listeners = new Set<() => void>();
let nextId = 1;

const scope = (hostId: string, cwd: string) => `${hostId}\u0000${cwd}`;

function emit() {
  for (const listener of [...listeners]) listener();
}

export function subscribeBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The operations running on a repository, oldest first. The same array until it changes. */
export function getBusy(hostId: string, cwd: string): readonly BusyOperation[] {
  return running.get(scope(hostId, cwd)) ?? NONE;
}

/** Marks a repository busy; returns the function that ends it (safe to call twice). */
export function startBusy(hostId: string, cwd: string, label: BusyLabel, rpc: string, now = Date.now()): () => void {
  const key = scope(hostId, cwd);
  const operation: BusyOperation = { id: nextId++, label, rpc, started: now };
  running.set(key, [...(running.get(key) ?? NONE), operation]);
  emit();
  return () => {
    const list = running.get(key);
    if (!list || !list.includes(operation)) return;
    const rest = list.filter((other) => other !== operation);
    if (rest.length === 0) running.delete(key);
    else running.set(key, rest);
    emit();
  };
}

/** Forgets one host's operations, or every host's when the plugin unloads. */
export function clearBusy(hostId?: string): void {
  if (hostId === undefined) running.clear();
  else for (const key of [...running.keys()]) if (key.startsWith(`${hostId}\u0000`)) running.delete(key);
  emit();
}
