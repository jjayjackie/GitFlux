// Menus: primary actions sit inline, everything else in a menu that opens three ways (architecture §9) — right-click on
// the web, a long press on touch, and a trailing "more" button always.
//
// Usage:
//   const items = (): MenuItem[] => [
//     { id: "checkout", label: t(…), icon: codicon.gitBranch, onPress: checkout },
//     separator("s1"),
//     { id: "delete", label: t("common.delete"), danger: true, disabled: !gate.allowed, reason: gate.reason, onPress: remove },
//   ];
//   const menu = useContextMenu(items);
//   <Row {...menu.rowProps} onPress={select}>…<MoreButton items={items} /></Row>
//
//   const { open } = useMenu();  open(buttonRef.current, items)   // against a view
//   open({ x, y }, items)                                          // at a point in the window

import { useEffect, useRef } from "react";
import type { View } from "react-native";
import { useT } from "../../i18n/messages.ts";
import { bindContextMenu } from "../../web.ts";
import { IconButton } from "../IconButton.tsx";
import { useFloating } from "./context.ts";
import type { Anchor, MenuItem } from "./context.ts";

export type { MenuAction, MenuItem, MenuSeparator } from "./context.ts";
export { isSeparator, separator } from "./context.ts";

/** Items, or a function that builds them when the menu opens (cheaper for long lists of rows). */
export type MenuItems = MenuItem[] | (() => MenuItem[]);

const build = (items: MenuItems) => (typeof items === "function" ? items() : items);

/** Opens and closes menus. Choosing an entry, pressing anywhere else, or Escape closes it. */
export function useMenu() {
  const floating = useFloating();
  return {
    open: (anchor: Anchor | null, items: MenuItems) => {
      const built = build(items);
      if (anchor && built.length > 0) floating.menu(anchor, built);
    },
    close: floating.closeMenu,
  };
}

/**
 * A context menu for a row. Spread `rowProps` into the row's Pressable (or ui/Row.tsx): it brings the ref the menu is
 * measured against, right-click on the web (through client/web.ts) and a long press on touch. `open()` opens it from
 * code. Without items (or `disabled`) nothing opens.
 */
export function useContextMenu(items: MenuItems, options: { disabled?: boolean } = {}) {
  const floating = useFloating();
  const ref = useRef<View>(null);
  const latest = useRef({ items, disabled: options.disabled });
  latest.current = { items, disabled: options.disabled };
  const openAt = (anchor: Anchor | null) => {
    if (latest.current.disabled || !anchor) return;
    const built = build(latest.current.items);
    if (built.length > 0) floating.menu(anchor, built);
  };
  // Right-click, on the web: React Native has no onContextMenu, so web.ts listens on the element itself.
  useEffect(() => bindContextMenu(ref.current, (point) => openAt(point)), []);
  return {
    rowProps: { ref, onLongPress: () => openAt(ref.current), delayLongPress: 450 },
    open: () => openAt(ref.current),
  };
}

export interface MoreButtonProps {
  items: MenuItems;
  /** Defaults to "More actions". */
  label?: string;
  disabled?: boolean;
  testID?: string;
}

/** The trailing "⋯" button that opens a menu. Every row with a context menu has one, for those with no right button. */
export function MoreButton({ items, label, disabled, testID }: MoreButtonProps) {
  const { t } = useT();
  const { open } = useMenu();
  const ref = useRef<View>(null);
  return <IconButton ref={ref} icon="Ellipsis" label={label ?? t("common.moreActions")} disabled={disabled} testID={testID} onPress={() => open(ref.current, items)} />;
}
