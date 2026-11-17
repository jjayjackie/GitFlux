// What one tab of the panel remembers (architecture §9: "sizes and collapsed sections persist per tab"): column sizes,
// folded sections, the narrow layout's tab, the graph's scope and search, expanded tree nodes. Kept by the host with the
// tab (`useTabState`), so a reload restores it. Every field falls back to its default on its own when what is stored is
// old or invalid, so one bad field never resets the rest.
//
// Usage (in any view; layout/Panel.tsx provides it):
//   const [collapsed, toggle] = useCollapsed("nav.tags");            // ids are "<area>.<section>"
//   const [expanded, toggleNode] = useExpanded("changes.tree");      // a tree's expanded node keys, per area
//   const { view, setView } = useView();  setView({ graph: { ...view.graph, search: text } });
//   const [value, setValue] = useViewExtra("detail.tab", "diff");    // a small string a view wants to keep

import type { PluginTab } from "@getpaseo/plugin/client";
import { useTabState } from "@getpaseo/plugin/client";
import { createContext, createElement, useCallback, useContext, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

const KEY_MAX = 1_024; // characters of an id or a node key
const LIST_MAX = 2_000; // ids kept in a list
const EXTRA_MAX = 200; // entries in `extra`

const ids = z.array(z.string().max(KEY_MAX)).max(LIST_MAX);
const size = z.number().nonnegative().nullable();

/** The per-tab state. Sizes are pixels; null means "the default for the width". */
export const viewStateSchema = z.object({
  sizes: z
    .object({
      nav: size.catch(null), // the navigation column's width (wide), or the drawer's (medium)
      detail: size.catch(null), // the detail column's width
      changes: size.catch(null), // the Changes pane's height in the centre column
    })
    .catch({ nav: null, detail: null, changes: null }),
  /** Folded sections and panes: "pane.changes", "pane.graph", "nav.branches", … */
  collapsed: ids.catch([]),
  /** Expanded tree nodes, each key prefixed with its tree's id ("changes.tree:src/app"). */
  expanded: ids.catch([]),
  /** The narrow layout's tab. */
  narrowTab: z.enum(["changes", "graph", "branches"]).catch("changes"),
  /** Whether the navigation shows (the wide layout's column, the medium layout's drawer). */
  navOpen: z.boolean().catch(true),
  /** The repository this tab showed last (the selection store is in memory only). */
  repository: z.string().max(KEY_MAX).nullable().catch(null),
  /** The repository above the workspace folder was asked for (git.repo.discover's `parent`). */
  includeParent: z.boolean().catch(false),
  graph: z
    .object({
      scope: z.enum(["current", "all"]).nullable().catch(null), // null: the host's preference (view settings)
      search: z.string().max(KEY_MAX).catch(""),
      field: z.enum(["message", "author", "hash", "path", "content"]).catch("message"),
      noMerges: z.boolean().catch(false),
    })
    .catch({ scope: null, search: "", field: "message", noMerges: false }),
  /** Small strings a view keeps (its selected tab, a mode): use `useViewExtra`. Keys "<area>.<name>". */
  extra: z.record(z.string().max(KEY_MAX), z.string().max(KEY_MAX)).catch({}),
});
export type ViewState = z.infer<typeof viewStateSchema>;

export const DEFAULT_VIEW: ViewState = {
  sizes: { nav: null, detail: null, changes: null },
  collapsed: [],
  expanded: [],
  narrowTab: "changes",
  navOpen: true,
  repository: null,
  includeParent: false,
  graph: { scope: null, search: "", field: "message", noMerges: false },
  extra: {},
};

/** The schema the tab is read with: an unreadable document as a whole becomes the default. */
const tabSchema = viewStateSchema.catch(DEFAULT_VIEW);

export interface ViewApi {
  view: ViewState;
  /** Merges `patch` into the state (top-level fields; give a whole `sizes` or `graph`). */
  setView(patch: Partial<ViewState>): void;
}

const ViewContext = createContext<ViewApi | null>(null);

/** Put once per panel instance (layout/Panel.tsx), with the tab the host gave the panel. */
export function ViewProvider({ tab, children }: { tab: PluginTab; children: ReactNode }) {
  const [view, write] = useTabState(tab, tabSchema, DEFAULT_VIEW);
  const latest = useRef(view);
  latest.current = view;
  const setView = useCallback(
    (patch: Partial<ViewState>) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      write(next);
    },
    [write],
  );
  const value = useMemo(() => ({ view, setView }), [view, setView]);
  return createElement(ViewContext.Provider, { value }, children);
}

/** The tab's state and its setter. */
export function useView(): ViewApi {
  const api = useContext(ViewContext);
  if (!api) throw new Error("Advanced Git: this component needs a ViewProvider above it");
  return api;
}

/** Bounded add/remove of one id in a list. */
export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((other) => other !== id) : [...list, id].slice(-LIST_MAX);
}

/** Whether a section or pane is folded, and the way to fold or unfold it. */
export function useCollapsed(id: string): [boolean, () => void] {
  const { view, setView } = useView();
  const collapsed = view.collapsed.includes(id);
  const toggle = useCallback(() => setView({ collapsed: toggleId(view.collapsed, id) }), [setView, view.collapsed, id]);
  return [collapsed, toggle];
}

/** The expanded nodes of tree `treeId` (keys without the prefix), and the way to expand or collapse one. */
export function useExpanded(treeId: string): [ReadonlySet<string>, (key: string) => void] {
  const { view, setView } = useView();
  const prefix = `${treeId}:`;
  const expanded = useMemo(() => new Set(view.expanded.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))), [view.expanded, prefix]);
  const toggle = useCallback((key: string) => setView({ expanded: toggleId(view.expanded, prefix + key) }), [setView, view.expanded, prefix]);
  return [expanded, toggle];
}

/** A small string a view keeps with the tab, under `key` ("<area>.<name>"). */
export function useViewExtra<Value extends string>(key: string, fallback: Value, allowed?: readonly Value[]): [Value, (value: Value) => void] {
  const { view, setView } = useView();
  const stored = view.extra[key];
  const value = stored !== undefined && (allowed === undefined || (allowed as readonly string[]).includes(stored)) ? (stored as Value) : fallback;
  const set = useCallback(
    (next: Value) => {
      const extra = { ...view.extra, [key]: next };
      const names = Object.keys(extra);
      if (names.length > EXTRA_MAX) delete extra[names[0]];
      setView({ extra });
    },
    [setView, view.extra, key],
  );
  return [value, set];
}
