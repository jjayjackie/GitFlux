// What the panel has selected, shared by every instance of the panel on one host and workspace (the Explorer one and a
// workspace tab show the same repository and the same detail), and the command bus that brings Command Center items and
// keyboard shortcuts to the mounted panel. Replaces upstream's client/legacy/diffTab.ts.
//
// Pure (no React): unit-tested. The hooks are in ./selection.ts. Every entry is keyed `hostId \0 workspaceId`
// (architecture §6): what is set under one host is invisible under another.

import type { DiffSource, FileChange } from "../../shared/schemas.ts";

// --- selection ----------------------------------------------------------------------------------------------------

/** What the detail column shows. */
export type DetailTarget =
  | { kind: "none" }
  | { kind: "file"; source: DiffSource; file: FileChange }
  | { kind: "commit"; hash: string }
  | { kind: "fileHistory"; path: string }
  | { kind: "blame"; path: string; rev?: string }
  | { kind: "compare"; from: string; to: string }
  | { kind: "stash"; hash: string }
  | { kind: "conflict"; path: string };

export type DetailKind = DetailTarget["kind"];

export interface Selection {
  /** The selected repository's root; null until one is chosen (the panel then takes the first). */
  repository: string | null;
  detail: DetailTarget;
}

export const NO_DETAIL: DetailTarget = { kind: "none" };
const EMPTY: Selection = { repository: null, detail: NO_DETAIL };

export const scopeKey = (hostId: string, workspaceId: string) => `${hostId}\u0000${workspaceId}`;

const selections = new Map<string, Selection>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

/** Subscribes to every change of the selection store; returns the remover. For useSyncExternalStore. */
export function subscribeSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The selection of one host and workspace. The same object until it changes. */
export function getSelection(hostId: string, workspaceId: string): Selection {
  return selections.get(scopeKey(hostId, workspaceId)) ?? EMPTY;
}

function update(hostId: string, workspaceId: string, change: (current: Selection) => Selection) {
  const key = scopeKey(hostId, workspaceId);
  const current = selections.get(key) ?? EMPTY;
  const next = change(current);
  if (next === current) return;
  selections.set(key, next);
  emit();
}

/** Selects a repository. Choosing another one clears the detail column: what it showed belongs to the old one. */
export function setRepository(hostId: string, workspaceId: string, root: string | null): void {
  update(hostId, workspaceId, (current) => (current.repository === root ? current : { repository: root, detail: NO_DETAIL }));
}

/** Shows something in the detail column; `{ kind: "none" }` closes it. */
export function setDetail(hostId: string, workspaceId: string, detail: DetailTarget): void {
  update(hostId, workspaceId, (current) => (sameDetail(current.detail, detail) ? current : { ...current, detail }));
}

/** Whether two detail targets show the same thing. */
export function sameDetail(a: DetailTarget, b: DetailTarget): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// --- command bus --------------------------------------------------------------------------------------------------

/** Where the "focus-search" command puts the cursor. */
export type SearchArea = "nav" | "changes" | "graph";
/** The narrow layout's tabs (layout/Shell.tsx). */
export type NarrowTab = "changes" | "graph" | "branches";

/**
 * A command for the mounted panel, from the Command Center (client/commands.ts), a keyboard shortcut
 * (client/shortcuts.ts) or another view. A view handles the ones it owns with `useCommand([types], handler)`.
 */
export type GitCommand =
  | { type: "fetch" }
  | { type: "pull" }
  | { type: "push" }
  | { type: "sync" }
  | { type: "commit" }
  | { type: "create-branch" }
  | { type: "switch-branch" }
  | { type: "stash" }
  | { type: "refresh" }
  | { type: "focus-search"; area: SearchArea }
  | { type: "show-shortcuts" }
  | { type: "close-detail" }
  | { type: "toggle-navigation" }
  | { type: "show-tab"; tab: NarrowTab };

export type GitCommandType = GitCommand["type"];

export const GIT_COMMAND_TYPES: readonly GitCommandType[] = [
  "fetch",
  "pull",
  "push",
  "sync",
  "commit",
  "create-branch",
  "switch-branch",
  "stash",
  "refresh",
  "focus-search",
  "show-shortcuts",
  "close-detail",
  "toggle-navigation",
  "show-tab",
];

interface Handler {
  id: number;
  hostId: string;
  workspaceId: string;
  /** The panel instance it belongs to (an Explorer panel and a workspace tab are two). */
  instance: string | null;
  types: ReadonlySet<GitCommandType>;
  run: (command: GitCommand) => void;
}

/** A command no handler took yet: kept briefly, for a panel the Command Center has just opened. */
interface Pending {
  hostId: string | null;
  workspaceId: string;
  command: GitCommand;
  at: number;
}

/** How long a command waits for a panel to mount and take it. */
export const PENDING_MS = 10_000;

let nextHandler = 1;
const handlers: Handler[] = [];
let pending: Pending[] = [];

const matches = (handler: Handler, hostId: string | null, workspaceId: string, type: GitCommandType) =>
  (hostId === null || handler.hostId === hostId) && handler.workspaceId === workspaceId && handler.types.has(type);

/**
 * Hands a command to a handler now, without queueing it: one of `instance`'s handlers when it has one for the command
 * (a keyboard shortcut goes to the panel that has focus), else the most recently registered one. Returns whether a
 * handler took it.
 */
export function deliver(hostId: string | null, workspaceId: string, command: GitCommand, instance: string | null = null): boolean {
  let fallback: Handler | null = null;
  for (let n = handlers.length - 1; n >= 0; n--) {
    const handler = handlers[n];
    if (!matches(handler, hostId, workspaceId, command.type)) continue;
    if (instance === null || handler.instance === instance) {
      handler.run(command);
      return true;
    }
    fallback ??= handler;
  }
  if (fallback) {
    fallback.run(command);
    return true;
  }
  return false;
}

/**
 * Sends a command to the panel of `workspaceId` on `hostId`. `hostId` null means "this installation's host": the
 * Command Center does not say which host a workspace is on, and an installation belongs to one host. The most recently
 * registered handler for the command's type takes it; with none, the command waits up to PENDING_MS for one (the panel
 * the Command Center just opened). Returns whether a handler took it now.
 */
export function dispatch(hostId: string | null, workspaceId: string, command: GitCommand, now = Date.now()): boolean {
  if (deliver(hostId, workspaceId, command)) return true;
  pending = [...pending.filter((entry) => now - entry.at < PENDING_MS), { hostId, workspaceId, command, at: now }];
  return false;
}

/**
 * Registers a handler for some command types on one host and workspace (and panel instance); returns the remover.
 * Commands that were waiting for such a handler are delivered at once, oldest first.
 */
export function registerHandler(
  hostId: string,
  workspaceId: string,
  types: readonly GitCommandType[],
  run: (command: GitCommand) => void,
  instance: string | null = null,
  now = Date.now(),
): () => void {
  const handler: Handler = { id: nextHandler++, hostId, workspaceId, instance, types: new Set(types), run };
  handlers.push(handler);
  const fresh = pending.filter((entry) => now - entry.at < PENDING_MS);
  const due = fresh.filter((entry) => matches(handler, entry.hostId, entry.workspaceId, entry.command.type));
  pending = fresh.filter((entry) => !due.includes(entry));
  for (const entry of due) run(entry.command);
  return () => {
    const at = handlers.findIndex((other) => other.id === handler.id);
    if (at !== -1) handlers.splice(at, 1);
  };
}

/** How many commands are waiting for a handler (for tests). */
export function pendingCount(): number {
  return pending.length;
}

// --- lifetime -----------------------------------------------------------------------------------------------------

/** Forgets everything kept for one host: its selections, its waiting commands and its handlers. */
export function clearHost(hostId: string): void {
  const prefix = `${hostId}\u0000`;
  let changed = false;
  for (const key of [...selections.keys()]) {
    if (key.startsWith(prefix)) {
      selections.delete(key);
      changed = true;
    }
  }
  pending = pending.filter((entry) => entry.hostId !== hostId);
  for (let n = handlers.length - 1; n >= 0; n--) if (handlers[n].hostId === hostId) handlers.splice(n, 1);
  if (changed) emit();
}

/** Forgets everything: when the plugin unloads (index.client.tsx's cleanup). */
export function clearAll(): void {
  selections.clear();
  pending = [];
  handlers.length = 0;
  emit();
}
