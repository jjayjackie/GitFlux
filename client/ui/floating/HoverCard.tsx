// Hover cards: more about a row (a commit, a branch) once the pointer has rested on it, kept while the pointer moves
// onto the card, as VS Code's hovers are; a long press shows it where there is no pointer. Adapted from upstream's
// useHoverCard and CardArea (client/legacy/ui.tsx).
//
// Usage:
//   <CardArea style={{ flex: 1 }}>          // the part of the panel cards keep clear of (a column, a section)
//     <Pressable {...useHoverCard(() => <CommitCard commit={c} />)}>…</Pressable>
//   </CardArea>
// A row that also has a context menu uses the card's long press for the card, or leaves the card out on touch.

import { createContext, useContext, useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Platform, View } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import { isMac } from "../../web.ts";
import { useFloating } from "./context.ts";

const AreaContext = createContext<RefObject<View | null> | null>(null);

export interface CardAreaProps {
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}

/** A part of the panel that the cards of the rows in it keep clear of where they can. */
export function CardArea({ style, onLayout, children }: CardAreaProps) {
  const ref = useRef<View>(null);
  return (
    <AreaContext.Provider value={ref}>
      <View ref={ref} style={style} onLayout={onLayout}>
        {children}
      </View>
    </AreaContext.Provider>
  );
}

// VS Code's `workbench.hover.delay`: 1500 milliseconds on a Mac, 500 elsewhere.
const hoverDelay = () => (Platform.OS === "web" ? isMac() : Platform.OS === "ios") ? 1500 : 500;
// While a card shows, the next row's takes its place once the pointer has rested on it this long (docs/design.md).
const HOVER_SWITCH = 150;

/** Props to spread into a row: shows `card()` once the pointer rests on it; a long press pins it until something else is pressed. */
export function useHoverCard(card: () => ReactNode) {
  const floating = useFloating();
  const area = useContext(AreaContext);
  const ref = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(card);
  latest.current = card;
  useEffect(() => () => clearTimeout(timer.current), []);
  const open = (pinned: boolean) => {
    if (ref.current) floating.card(ref.current, area?.current ?? null, latest.current(), pinned);
  };
  const leave = () => {
    clearTimeout(timer.current);
    floating.uncard();
  };
  return {
    ref,
    onHoverIn: () => {
      floating.keep();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => open(false), floating.carded() ? HOVER_SWITCH : hoverDelay());
    },
    onHoverOut: leave,
    onPressIn: leave,
    onLongPress: () => open(true),
  };
}
