// What a view needs to know about where the shell put it: the layout the panel is in, and for the centre column's two
// panes (Changes over Graph) whether the pane is folded. layout/Shell.tsx provides the layout.
//
// Usage (views/changes, views/graph):
//   const pane = usePane("changes");
//   <Heading title={t("shell.changes")} collapsed={pane.collapsed} onToggle={pane.toggle} … />
//   {!pane.collapsed && <List … />}
//   const mode = useLayoutMode();   // "wide" | "medium" | "narrow"

import { createContext, useContext } from "react";
import { useCollapsed } from "../state/view.ts";
import type { LayoutMode } from "./layoutMode.ts";

export const LayoutModeContext = createContext<LayoutMode>("wide");

/** The panel's layout: views tighten themselves in "narrow". */
export function useLayoutMode(): LayoutMode {
  return useContext(LayoutModeContext);
}

/** The centre column's panes; their folded state is kept with the tab as "pane.<id>". */
export type PaneId = "changes" | "graph";

export interface Pane {
  /** Folded: draw only the heading. Never folded in the narrow layout, where the pane fills the panel. */
  collapsed: boolean;
  /** Whether folding means anything here (false in the narrow layout: hide the chevron). */
  collapsible: boolean;
  toggle: () => void;
}

export function usePane(id: PaneId): Pane {
  const mode = useLayoutMode();
  const [collapsed, toggle] = useCollapsed(`pane.${id}`);
  const collapsible = mode !== "narrow";
  return { collapsed: collapsible && collapsed, collapsible, toggle };
}
