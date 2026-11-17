// Text in the theme's colours: every visible string goes through `T` (or a component built on it), so that no text
// falls back to React Native's default colour. Adapted from upstream's T (client/legacy/ui.tsx).
//
// Usage:
//   <T>{t("common.loading")}</T>
//   <T tone="muted" size={th.small} lines={1}>{branch.name}</T>
//   <T mono selectable tone="danger">{detail}</T>

import type { ReactNode } from "react";
import { Text } from "react-native";
import type { AccessibilityRole, StyleProp, TextStyle } from "react-native";
import { useTheme } from "./theme.ts";

/** A colour by meaning, from the host's theme. */
export type Tone = "default" | "muted" | "accent" | "success" | "warning" | "danger" | "onAccent";

export interface TProps {
  children: ReactNode;
  /** Font size; defaults to the theme's body size (`th.text`). */
  size?: number;
  tone?: Tone;
  /** An explicit colour wins over `tone`. */
  color?: string;
  weight?: "400" | "500" | "600" | "700";
  mono?: boolean;
  italic?: boolean;
  /** Cut to this many lines with an ellipsis. */
  lines?: number;
  selectable?: boolean;
  align?: "left" | "center" | "right";
  style?: StyleProp<TextStyle>;
  testID?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
}

export function useToneColor(tone: Tone): string {
  const { c } = useTheme();
  switch (tone) {
    case "muted":
      return c.foregroundMuted;
    case "accent":
      return c.accent;
    case "success":
      return c.statusSuccess;
    case "warning":
      return c.statusWarning;
    case "danger":
      return c.statusDanger;
    case "onAccent":
      return c.accentForeground;
    default:
      return c.foreground;
  }
}

export function T({ children, size, tone = "default", color, weight, mono, italic, lines, selectable, align, style, testID, accessibilityRole, accessibilityLabel }: TProps) {
  const th = useTheme();
  const toned = useToneColor(tone);
  return (
    <Text
      numberOfLines={lines}
      selectable={selectable}
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      style={[
        { color: color ?? toned, fontSize: size ?? th.text },
        weight !== undefined && { fontWeight: weight },
        mono && { fontFamily: th.mono },
        italic && { fontStyle: "italic" },
        align !== undefined && { textAlign: align },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
