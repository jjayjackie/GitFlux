// An icon in the theme's colours: a codicon from ./codicons.ts (VS Code's own, as upstream draws its panel) or a Lucide
// icon by name, both drawn by the host's Icon.
//
// Usage:
//   import * as codicon from "../../ui/codicons.ts";
//   <Glyph icon={codicon.gitBranch} />                 // muted foreground, the theme's icon size
//   <Glyph icon="Search" size={14} color={th.c.accent} />
//
// Prefer a codicon where one exists. A Lucide name the host does not know draws nothing (the host's documented
// behaviour), so keep to long-standing names: Search, X, Check, ChevronLeft, ChevronRight, ChevronDown, Ellipsis, Info,
// TriangleAlert, CircleAlert, RefreshCw, Download, Upload, Plus, Minus, Trash2, Copy, Settings, GitBranch, GitGraph,
// FileDiff, Archive, Tag, Cloud, Folder, File, Lock, ArrowUp, ArrowDown, Keyboard.

import { Icon } from "@getpaseo/plugin/client/ui";
import type { Codicon } from "./codicons.ts";
import { useTheme } from "./theme.ts";

/** A codicon (inline SVG) or a Lucide icon's name. */
export type IconSource = Codicon | string;

export interface GlyphProps {
  icon: IconSource;
  /** Defaults to the theme's icon size (16, or 18 where touched). */
  size?: number;
  /** Defaults to the muted foreground, as VS Code draws its action icons. */
  color?: string;
}

export function Glyph({ icon, size, color }: GlyphProps) {
  const th = useTheme();
  const props = { size: size ?? th.icon, color: color ?? th.c.foregroundMuted };
  return typeof icon === "string" ? <Icon name={icon} {...props} /> : <Icon icon={icon} {...props} />;
}
