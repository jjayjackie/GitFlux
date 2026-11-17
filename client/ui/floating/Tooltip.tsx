// Hover hints: every button says what it does once the pointer rests on it (docs/design.md, "Words"). Adapted from
// upstream's useHint (client/legacy/ui.tsx).
//
// Usage:
//   const hint = useHint(t("toolbar.fetchHint"));
//   <Pressable {...hint} onPress={fetch}>…</Pressable>        // spread it: it brings the ref and the hover handlers
//   <Tooltip text={t("toolbar.ahead", { count })}><Badge … /></Tooltip>   // a hint on something that is not a button

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Pressable } from "react-native";
import type { StyleProp, View, ViewStyle } from "react-native";
import { useFloating } from "./context.ts";

const HINT_DELAY = 500; // VS Code's workbench.hover.delay off a Mac

/** Props to spread into a Pressable so that it shows `text` once the pointer has rested on it. No text, no hint. */
export function useHint(text: string | null | undefined) {
  const floating = useFloating();
  const ref = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(text);
  latest.current = text;
  useEffect(() => () => clearTimeout(timer.current), []); // a button that goes away does not speak afterwards
  const hide = () => {
    clearTimeout(timer.current);
    floating.unhint();
  };
  return {
    ref,
    onHoverIn: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const words = latest.current;
        if (ref.current && words) floating.hint(ref.current, words);
      }, HINT_DELAY);
    },
    onHoverOut: hide,
    onPressIn: hide,
  };
}

export interface TooltipProps {
  text: string | null | undefined;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Shows `text` over whatever it wraps once the pointer rests on it. It is not a button: it has no press of its own. */
export function Tooltip({ text, children, style, testID }: TooltipProps) {
  const hint = useHint(text);
  return (
    <Pressable {...hint} accessible={false} testID={testID} style={style}>
      {children}
    </Pressable>
  );
}
