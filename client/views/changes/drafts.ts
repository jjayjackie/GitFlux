// The commit message being written, per repository (upstream's `drafts` in paseo-source-control: client/CommitBox.tsx). Kept here,
// in memory, keyed `hostId \0 cwd`, so it outlives the composer: switching repositories, folding the Changes pane or the
// narrow layout's tabs unmount it. The composer also keeps a copy with the tab (state/view.ts's useViewExtra, under
// `draftKey(cwd)`) so that a reload finds it; the tab's copy is bounded (KEPT_MAX), a longer message is kept here only.
// Pure (no React): unit-tested.

/** Characters of a draft the tab keeps (state/view.ts bounds each kept string at 1 024). */
export const KEPT_MAX = 1_000;

const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
const scope = (hostId: string, cwd: string) => `${hostId}\u0000${cwd}`;

function emit() {
  for (const listener of [...listeners]) listener();
}

/** Subscribes to every change of a draft; returns the remover. For useSyncExternalStore. */
export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The draft of a repository, or undefined when none was written in this session. */
export function getDraft(hostId: string, cwd: string): string | undefined {
  return drafts.get(scope(hostId, cwd));
}

export function setDraft(hostId: string, cwd: string, message: string): void {
  const key = scope(hostId, cwd);
  if (drafts.get(key) === message) return;
  drafts.set(key, message);
  emit();
}

/** Forgets one host's drafts, or every draft. */
export function clearDrafts(hostId?: string): void {
  if (hostId === undefined) drafts.clear();
  else for (const key of [...drafts.keys()]) if (key.startsWith(`${hostId}\u0000`)) drafts.delete(key);
  emit();
}

/**
 * The tab's key for a repository's draft: a short hash of its root, so that a long path cannot push the key past what
 * the tab keeps (FNV-1a, 32 bits; a collision could only bring one repository's draft into another's empty box after a
 * reload, where it is seen before anything is committed).
 */
export function draftKey(cwd: string): string {
  let hash = 0x811c9dc5;
  for (let n = 0; n < cwd.length; n++) {
    hash ^= cwd.charCodeAt(n);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `changes.draft.${hash.toString(16).padStart(8, "0")}`;
}

/** What the tab keeps of a draft: the draft, or nothing when it is too long to keep whole. */
export const keptDraft = (message: string): string => (message.length <= KEPT_MAX ? message : "");
