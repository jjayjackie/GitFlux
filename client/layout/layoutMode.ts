// Which layout the panel takes, by its own measured width rather than by platform (architecture §9), and the sizes of
// its columns. Pure: unit-tested.
//
//   wide    ≥ WIDE_MIN    navigation │ toolbar + changes over graph │ detail      (two draggable dividers)
//   medium  ≥ MEDIUM_MIN  toolbar + changes over graph │ detail; navigation in a drawer toggled from the toolbar
//   narrow  otherwise, or whenever the host says `layout.compact`: one column, a Changes / Graph / Branches switch, and
//           the detail pushed over it with a back control
// The Explorer location is simply narrow.

export const WIDE_MIN = 1100;
export const MEDIUM_MIN = 700;

export type LayoutMode = "wide" | "medium" | "narrow";

/** The layout for a width; null before the panel has been measured. */
export function layoutMode(width: number, compact: boolean): LayoutMode | null {
  if (!(width > 0)) return null;
  if (compact || width < MEDIUM_MIN) return "narrow";
  return width >= WIDE_MIN ? "wide" : "medium";
}

/** The navigation column (wide) or drawer (medium): its default, and the least and most it may take. */
export const NAV = { default: 260, min: 180, maxShare: 0.35 } as const;
/** The detail column: its default share of the width, and the least it keeps. */
export const DETAIL = { defaultShare: 0.4, min: 280 } as const;
/** The least the centre column (toolbar, changes, graph) keeps. */
export const CENTRE_MIN = 320;
/** The least each of the changes and graph panes keeps in the centre column. */
export const PANE_MIN = 72;

const clamp = (value: number, least: number, most: number) => Math.round(Math.min(Math.max(value, least), Math.max(least, most)));

/** The navigation's width for a panel width and a saved size (null: the default). */
export function navWidth(width: number, saved: number | null): number {
  return clamp(saved ?? NAV.default, NAV.min, width * NAV.maxShare);
}

/** The detail column's width for the width it shares with the centre column, and a saved size. */
export function detailWidth(room: number, saved: number | null): number {
  return clamp(saved ?? room * DETAIL.defaultShare, DETAIL.min, room - CENTRE_MIN);
}
