// The host's theme, layout and identity, and the sizes and colours that follow from them. Every kit component and
// every view reads them through `useTheme()`; nothing names a colour of its own.
//
// Usage:
//   <HostProvider value={{ theme, layout, host }}>…</HostProvider>   // once, in layout/Panel.tsx
//   const th = useTheme();
//   <View style={{ height: th.row, backgroundColor: th.c.surface1, padding: th.space.md, borderRadius: th.radius.sm }} />
//   <Text style={{ color: th.syntax.keyword ?? th.c.foreground, ...th.code }} />
//
// Adapted from upstream's useHost (paseo-source-control: client/ui.tsx).

import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import type { TextStyle } from "react-native";
import { useHostValue } from "../state/host.ts";
import { DIFF_DARK, DIFF_LIGHT, GRAPH_BASE, GRAPH_UPSTREAM, HOVER, isDark, laneColors, SELECTED, SYNTAX_DARK, SYNTAX_LIGHT } from "./palette.ts";
import type { DiffPalette, SyntaxPalette } from "./palette.ts";

export { isDark } from "./palette.ts";
// The host value lives in state/host.ts (it also carries the host's identity); re-exported here for the kit.
export { HostProvider, useHostValue } from "../state/host.ts";
export type { HostValue } from "../state/host.ts";

export type HostPlatform = PluginHostProps["layout"]["platform"];

/**
 * Paseo's code font before "Code font" is set in its settings, which plugins are not told: on the web its default font
 * stack. Native apps take one font name, not a list (upstream's MONO).
 */
const MONO: Record<HostPlatform, string> = {
  ios: "Menlo",
  android: "monospace",
  web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};

export interface Theme {
  /** The host's colours: surface0/1/2, border, foreground, foregroundMuted, accent, accentForeground, status*. */
  c: PluginTheme["colors"];
  /** Whether surface0 is dark: picks every palette below. */
  dark: boolean;
  compact: boolean;
  platform: HostPlatform;
  /** Row height: 24 where a pointer is used, 34 where rows are touched (architecture §9). */
  row: number;
  /** Text sizes: body, small (labels, counts), title (dialog and section titles). */
  text: number;
  small: number;
  title: number;
  /** Icon size inside buttons and rows. */
  icon: number;
  /** The monospace font family for this platform. */
  mono: string;
  /** Code as diffs draw it, at `size` (prefs.codeFontSize): font, size and a line height 1.5 times it. */
  code(size: number): TextStyle;
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  radius: { sm: number; md: number; lg: number };
  /** A row under the pointer, and a selected row: the theme has no translucent tokens. */
  hover: string;
  selected: string;
  diff: DiffPalette;
  syntax: SyntaxPalette;
  /** Lane colours in order, then the upstream's and the base branch's own colours. */
  lanes: string[];
  upstream: string;
  base: string;
}

/** The theme with its derived tokens. Recomputed only when the host's theme or layout changes. */
export function useTheme(): Theme {
  const { theme, layout } = useHostValue();
  return useMemo(() => makeTheme(theme, layout), [theme, layout]);
}

function makeTheme(theme: PluginTheme, layout: PluginHostProps["layout"]): Theme {
  const c = theme.colors;
  const dark = isDark(c.surface0);
  const { compact, platform } = layout;
  const mono = MONO[platform] ?? MONO.web;
  // Code is drawn as VS Code draws it by default: smoothed by the system on the web, not as Paseo smooths its own text.
  const smoothing = platform === "web" ? ({ WebkitFontSmoothing: "auto" } as unknown as TextStyle) : {};
  return {
    c,
    dark,
    compact,
    platform,
    row: compact ? 34 : 24,
    text: compact ? 15 : 13,
    small: compact ? 12 : 11,
    title: compact ? 17 : 15,
    icon: compact ? 18 : 16,
    mono,
    code: (size) => ({ fontFamily: mono, fontSize: size, lineHeight: Math.round(size * 1.5), ...smoothing }),
    space: compact ? { xs: 3, sm: 6, md: 10, lg: 14, xl: 20 } : { xs: 2, sm: 4, md: 8, lg: 12, xl: 16 },
    radius: { sm: 4, md: 6, lg: 8 },
    hover: dark ? HOVER.dark : HOVER.light,
    selected: dark ? SELECTED.dark : SELECTED.light,
    diff: dark ? DIFF_DARK : DIFF_LIGHT,
    syntax: dark ? SYNTAX_DARK : SYNTAX_LIGHT,
    lanes: laneColors(c),
    upstream: dark ? GRAPH_UPSTREAM.dark : GRAPH_UPSTREAM.light,
    base: GRAPH_BASE,
  };
}
