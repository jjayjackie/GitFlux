// What floats over the panel — hints, menus and hover cards — is drawn by PanelRoot, inside the panel: a plugin can draw
// nothing outside it (docs/design.md, "What the host allows"). This file holds the shared types and the context.
// Adapted from upstream's floating layer (client/legacy/ui.tsx).

import { createContext, useContext } from "react";
import type { ReactNode, RefObject } from "react";
import type { View } from "react-native";
import type { IconSource } from "../Glyph.tsx";

/** A menu entry that does something. */
export interface MenuAction {
  id: string;
  label: string;
  icon?: IconSource;
  /** A chord from client/shortcuts.ts ("Mod+Enter", "Alt+F"), drawn as the platform spells it. */
  shortcut?: string;
  /** Destructive: drawn in the danger colour. The action itself still asks for confirmation (ui/Dialog.tsx). */
  danger?: boolean;
  disabled?: boolean;
  /** Why it is disabled, shown under its label (policy, offline, busy…). */
  reason?: string | null;
  /** A check mark before the label: for options that are on. */
  checked?: boolean;
  onPress?: () => void;
  /** Pressing the entry shows these instead, with a way back. */
  submenu?: MenuItem[];
  testID?: string;
}

/** A line between groups of entries. */
export interface MenuSeparator {
  separator: true;
  id: string;
}

export type MenuItem = MenuAction | MenuSeparator;

export const isSeparator = (item: MenuItem): item is MenuSeparator => "separator" in item && item.separator === true;

/** A separator, for building menus: `[a, b, separator("s1"), c]`. */
export const separator = (id: string): MenuSeparator => ({ separator: true, id });

/** A point in window coordinates (where a right-click happened). */
export interface Point {
  x: number;
  y: number;
}

/** What a menu opens against: a view (a button, a row) or a point. */
export type Anchor = View | Point;

export const isPoint = (anchor: Anchor): anchor is Point => !("measureInWindow" in anchor);

export interface Floating {
  /** The panel's root view: what positions are measured against, and where keyboard shortcuts are listened for. */
  root: RefObject<View | null>;
  hint(anchor: View, text: string): void;
  unhint(): void;
  menu(anchor: Anchor, items: MenuItem[]): void;
  closeMenu(): void;
  /** A hover card for a row; `area` is the part of the panel it keeps clear of; `pinned` stays until something else is pressed. */
  card(row: View, area: View | null, content: ReactNode, pinned: boolean): void;
  /** The pointer left the row: the card goes in a moment, unless the pointer is on it or comes back first. */
  uncard(): void;
  /** The pointer is back on the row. */
  keep(): void;
  /** Whether a card shows. */
  carded(): boolean;
}

export const FloatingContext = createContext<Floating | null>(null);

const NOTHING: Floating = {
  root: { current: null },
  hint() {},
  unhint() {},
  menu() {},
  closeMenu() {},
  card() {},
  uncard() {},
  keep() {},
  carded: () => false,
};

/**
 * The nearest floating layer. Outside one (a settings screen, a host-rendered sheet) hints and menus quietly do nothing
 * rather than failing: dialogs put a layer of their own around their content.
 */
export function useFloating(): Floating {
  return useContext(FloatingContext) ?? NOTHING;
}

/** The panel's root view, for registering keyboard shortcuts on it (client/web.ts). */
export function usePanelRoot(): RefObject<View | null> {
  return useFloating().root;
}
