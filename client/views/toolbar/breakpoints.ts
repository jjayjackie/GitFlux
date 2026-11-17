// How much of the toolbar fits its width: the sync actions with their labels, as icons, only Pull and Push as icons, or
// none (everything in the ⋯ menu). The toolbar measures itself (onLayout) and asks this. Pure: unit-tested
// (test/unit/client/toolbarBreakpoints.test.ts).

/** The toolbar's sync actions, in the order they are drawn. */
export const TOOLBAR_ACTIONS = ["fetch", "pull", "push", "sync"] as const;
export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

/** The widths (pixels) from which each arrangement fits, the repository and branch keeping room of their own. */
export const TOOLBAR_BREAKPOINTS = {
  /** Every action with its label. */
  labels: 640,
  /** Every action as an icon. */
  icons: 400,
  /** Pull and Push as icons; Fetch and Sync in the menu. */
  some: 300,
} as const;

export interface ToolbarLayout {
  /** Draw the actions' labels beside their icons. */
  labels: boolean;
  /** The actions drawn in the toolbar; the others are in the ⋯ menu. */
  inline: readonly ToolbarAction[];
}

const SOME: readonly ToolbarAction[] = ["pull", "push"];
const NONE: readonly ToolbarAction[] = [];

/** The arrangement for a toolbar `width` pixels wide. Before it is measured (0), icons: they fit almost anywhere. */
export function toolbarLayout(width: number): ToolbarLayout {
  if (!(width > 0)) return { labels: false, inline: TOOLBAR_ACTIONS };
  if (width >= TOOLBAR_BREAKPOINTS.labels) return { labels: true, inline: TOOLBAR_ACTIONS };
  if (width >= TOOLBAR_BREAKPOINTS.icons) return { labels: false, inline: TOOLBAR_ACTIONS };
  if (width >= TOOLBAR_BREAKPOINTS.some) return { labels: false, inline: SOME };
  return { labels: false, inline: NONE };
}

/** The actions the ⋯ menu carries: those not drawn in the toolbar, in order. */
export function overflowActions(layout: ToolbarLayout): ToolbarAction[] {
  return TOOLBAR_ACTIONS.filter((action) => !layout.inline.includes(action));
}
