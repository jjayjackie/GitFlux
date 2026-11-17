// The graph's row model, pure (unit-tested in test/unit/client/graphModel.test.ts): which ref badges a row shows and
// which fold into "+N", how a press with modifier keys changes the multi-selection, the order picked commits are
// applied in, whether a commit is in HEAD's history as far as the loaded commits tell, and the refs the graph is
// limited to ("show only this branch").

import { LOG_REFS_MAX } from "../../../shared/limits.ts";
import type { Commit, Ref } from "../../../shared/schemas.ts";
import { width } from "./lanes.ts";
import type { Rail } from "./lanes.ts";

// --- hashes ------------------------------------------------------------------------------------------------------

/** A full commit hash (SHA-1 or SHA-256), as the schemas take one. */
export function isFullHash(value: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

/** The short form the panel shows, as `git log --oneline` does by default. */
export function shortHash(hash: string): string {
  return isFullHash(hash) ? hash.slice(0, 7) : hash;
}

/** The all-zero hash git gives lines and files not committed yet. */
export function isZeroHash(hash: string): boolean {
  return /^0+$/.test(hash);
}

// --- ref badges --------------------------------------------------------------------------------------------------

/** The order badges are drawn in: the checked-out branch first, then local branches, remote branches, tags. */
export const REF_RANK: Readonly<Record<Ref["kind"], number>> = { head: 0, branch: 1, remote: 2, tag: 3 };

/** Refs in badge order; refs of one kind keep the order git listed them in. */
export function sortRefs<R extends Ref>(refs: readonly R[]): R[] {
  return [...refs].sort((a, b) => REF_RANK[a.kind] - REF_RANK[b.kind]);
}

export interface BadgeLayout<R extends Ref> {
  /** Drawn as badges, in order. */
  shown: R[];
  /** Folded into a "+N" badge whose hint names them. */
  hidden: R[];
}

/** Which of a row's refs get a badge when there is room for `room` of them; the rest fold into "+N". */
export function badgeLayout<R extends Ref>(refs: readonly R[], room: number): BadgeLayout<R> {
  const sorted = sortRefs(refs);
  const fits = Math.max(0, Math.floor(room));
  return { shown: sorted.slice(0, fits), hidden: sorted.slice(fits) };
}

/**
 * The remote branches that sit on the commit of a local branch of the same name (`origin/main` beside `main`): on a row
 * their name says nothing new, so VS Code (and upstream) draws them as a bare cloud.
 */
export function mirroredRemotes(refs: readonly Ref[]): Set<string> {
  const local = new Set(refs.filter((ref) => ref.kind === "branch" || ref.kind === "head").map((ref) => ref.name));
  const mirrors = new Set<string>();
  for (const ref of refs) {
    if (ref.kind !== "remote") continue;
    const slash = ref.name.indexOf("/");
    if (slash > 0 && local.has(ref.name.slice(slash + 1))) mirrors.add(ref.name);
  }
  return mirrors;
}

/** How a ref's badge is coloured: as upstream's graph colours the refs it follows. */
export type BadgeColour = "head" | "upstream" | "base" | "lane" | "plain";

export interface Followed {
  /** The checked-out branch's upstream (`origin/main`), if any. */
  upstream: string | null;
  /** The remote branch the checked-out one was made from, if any. */
  base: string | null;
  /** Every branch is shown: other refs take their commit's lane colour. */
  all: boolean;
}

export function badgeColour(ref: Ref, followed: Followed): BadgeColour {
  if (ref.kind === "head") return "head";
  if (ref.kind !== "tag" && followed.upstream !== null && ref.name === followed.upstream) return "upstream";
  if (ref.kind === "remote" && followed.base !== null && ref.name === followed.base) return "base";
  return followed.all ? "lane" : "plain";
}

// --- lanes -------------------------------------------------------------------------------------------------------

/** The most lanes any of `rails` needs room for. */
export function widestRail(rails: readonly Rail[]): number {
  let most = 0;
  for (const rail of rails) most = Math.max(most, width([rail.col, ...rail.through, ...rail.into, ...rail.out]));
  return most;
}

// --- selection ---------------------------------------------------------------------------------------------------

/** The commits selected for comparing or picking several: their hashes, and where a Shift-press ranges from. */
export interface GraphSelection {
  keys: readonly string[];
  anchor: string | null;
}

export const EMPTY_SELECTION: GraphSelection = { keys: [], anchor: null };

/** single: select only it; toggle: add or remove it (Ctrl or ⌘); range: from the anchor to it (Shift). */
export type PressMode = "single" | "toggle" | "range";

/**
 * What a press means, from the modifier keys of its event. React Native Web hands the DOM event over as `nativeEvent`;
 * native apps have no modifier keys, and anything unreadable counts as a plain press.
 */
export function pressMode(event: unknown): PressMode {
  const holder = event !== null && typeof event === "object" ? (event as { nativeEvent?: unknown }) : null;
  const native = holder && holder.nativeEvent !== null && typeof holder.nativeEvent === "object" ? holder.nativeEvent : holder;
  const flag = (name: string) => native !== null && typeof native === "object" && (native as Record<string, unknown>)[name] === true;
  if (flag("shiftKey")) return "range";
  if (flag("metaKey") || flag("ctrlKey")) return "toggle";
  return "single";
}

/** The selection after a press on `key`. `order` is the rows' order (newest first); keys come back in that order. */
export function select(selection: GraphSelection, order: readonly string[], key: string, mode: PressMode): GraphSelection {
  if (mode === "toggle") {
    const set = new Set(selection.keys);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    return { keys: inOrder(set, order), anchor: key };
  }
  if (mode === "range") {
    const anchor = selection.anchor ?? key;
    const from = order.indexOf(anchor);
    const to = order.indexOf(key);
    if (from === -1 || to === -1) return { keys: [key], anchor: key };
    return { keys: order.slice(Math.min(from, to), Math.max(from, to) + 1), anchor };
  }
  return { keys: [key], anchor: key };
}

/** Drops keys no longer among the rows (after a reload). Returns the same object when nothing changed. */
export function pruneSelection(selection: GraphSelection, order: readonly string[]): GraphSelection {
  const present = new Set(order);
  const keys = selection.keys.filter((key) => present.has(key));
  const anchor = selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null;
  return keys.length === selection.keys.length && anchor === selection.anchor ? selection : { keys, anchor };
}

function inOrder(keys: ReadonlySet<string>, order: readonly string[]): string[] {
  const listed = order.filter((key) => keys.has(key));
  const rest = [...keys].filter((key) => !order.includes(key));
  return [...listed, ...rest];
}

/** `keys` oldest first, by their place in `order` (newest first): the order a cherry-pick applies them in. */
export function oldestFirst(keys: readonly string[], order: readonly string[]): string[] {
  const rank = (key: string) => {
    const at = order.indexOf(key);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  return [...keys].sort((a, b) => rank(b) - rank(a));
}

/** `keys` newest first: the order a revert undoes them in, so that each applies on top of the one after it. */
export function newestFirst(keys: readonly string[], order: readonly string[]): string[] {
  return oldestFirst(keys, order).reverse();
}

/** What the commits to act on are when `hash` is pressed: the selection, if it holds `hash` and more; else just it. */
export function targetsOf(selection: GraphSelection, hash: string): readonly string[] {
  return selection.keys.length > 1 && selection.keys.includes(hash) ? selection.keys : [hash];
}

// --- ancestry ----------------------------------------------------------------------------------------------------

/** yes / no as far as the loaded commits tell; unknown when they cannot tell (HEAD not loaded, a filtered list). */
export type Ancestry = "yes" | "no" | "unknown";

/**
 * Whether `hash` is a strict ancestor of `head` (in its history, not HEAD itself), from the loaded commits alone. The
 * loaded commits are a prefix of a topological order, so a loaded commit that the walk from HEAD does not reach is not
 * an ancestor; an unloaded one cannot be told. The daemon checks again (git.rebase.plan, git.branch.reset).
 */
export function ancestry(commits: readonly Pick<Commit, "hash" | "parents">[], head: string | null, hash: string): Ancestry {
  if (head === null || hash === head) return "no";
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  if (!byHash.has(head)) return "unknown";
  const seen = new Set<string>();
  const stack = [head];
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (seen.has(next)) continue;
    seen.add(next);
    if (next === hash) return "yes";
    const commit = byHash.get(next);
    if (commit) stack.push(...commit.parents);
  }
  return byHash.has(hash) ? "no" : "unknown";
}

// --- the refs the graph is limited to -------------------------------------------------------------------------------

const REF_PREFIX = { head: "refs/heads/", branch: "refs/heads/", remote: "refs/remotes/", tag: "refs/tags/" } as const;

/** The full name of a ref the graph or the navigation shows by its short name: a branch and a tag never mix. */
export function fullRef(kind: Ref["kind"], name: string): string {
  return `${REF_PREFIX[kind]}${name}`;
}

/** The short name of a full ref name, as the badges show it. */
export function shortRef(full: string): string {
  for (const prefix of ["refs/heads/", "refs/remotes/", "refs/tags/"]) if (full.startsWith(prefix)) return full.slice(prefix.length);
  return full;
}

/** What "show only", "also show" and "hide" make of the refs shown (null: every branch), at most LOG_REFS_MAX. */
export function limitRefs(refs: readonly string[] | null, change: "only" | "add" | "remove", ref: string): string[] | null {
  let next: string[] | null;
  if (change === "only") next = [ref];
  else if (change === "add") next = refs === null ? [ref] : refs.includes(ref) ? [...refs] : [...refs, ref];
  else next = refs === null ? null : refs.filter((other) => other !== ref);
  return next === null || next.length === 0 ? null : next.slice(0, LOG_REFS_MAX);
}
