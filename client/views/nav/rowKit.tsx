// What every navigator row shares: its props, its indent, and its inline actions shown on hover.

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { TREE_INDENT } from "../../ui/Tree.tsx";
import type { NavEnv } from "./env.ts";
import type { NavRow } from "./model.ts";

export interface RowViewProps<Kind extends NavRow["kind"]> {
  row: Extract<NavRow, { kind: Kind }>;
  env: NavEnv;
}

/** Pixels before a row's content for its depth in a tree. */
export const indentOf = (depth: number) => depth * TREE_INDENT;

/**
 * Whether the pointer is over a row, for its inline actions (shown on hover, on the selected row, and always where rows
 * are touched). Spread `props` into the View around the row.
 */
export function useHovered(): [boolean, { onPointerEnter: () => void; onPointerLeave: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onPointerEnter: () => setHovered(true), onPointerLeave: () => setHovered(false) }];
}

/** The inline actions of a row: drawn only while `shown`, so that the row's text keeps its room otherwise. */
export function Inline({ shown, children }: { shown: boolean; children: ReactNode }) {
  if (!shown) return null;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>{children}</View>;
}


/** Two presses on the same row within this many milliseconds are a double press. */
export const DOUBLE_PRESS_MS = 400;

/**
 * A row's press: the first selects the row (`env.focused`), a second one soon after on the selected row does `onDouble`
 * (a branch's checkout, as double-clicking does in Fork and GitLens).
 */
export function useDoublePress(key: string, env: NavEnv, onDouble: () => void): () => void {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    if (env.focused === key && now - last.current < DOUBLE_PRESS_MS) {
      last.current = 0;
      onDouble();
      return;
    }
    last.current = now;
    env.setFocused(key);
  };
}
