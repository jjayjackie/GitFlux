// The panel's root and its floating layer: hints, menus and hover cards are drawn here, over everything else, so that
// no list can cut them off and nothing is drawn outside the panel. A menu or a card shows one at a time; a hint shows
// over either. Adapted from upstream's PanelRoot (client/legacy/ui.tsx), with menus that take icons, shortcuts,
// disabled reasons, separators and submenus, stay inside the panel, and answer the keyboard on the web.
//
// Usage (layout/Panel.tsx does this once; ui/Dialog.tsx puts a layer inside each dialog):
//   <PanelRoot>{…the panel…}</PanelRoot>
// Then anywhere below: useHint(text), useMenu(), useContextMenu(items), useHoverCard(render), usePanelRoot().

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { useT } from "../../i18n/messages.ts";
import { formatChord } from "../../shortcuts.ts";
import { focusElement, isMac, onWindowKeyDown } from "../../web.ts";
import * as codicon from "../codicons.ts";
import { Glyph } from "../Glyph.tsx";
import { T } from "../Text.tsx";
import { useTheme } from "../theme.ts";
import type { Theme } from "../theme.ts";
import { FloatingContext, isPoint, isSeparator } from "./context.ts";
import type { Anchor, Floating, MenuAction, MenuItem } from "./context.ts";

/** A box inside the panel, and the panel's size. */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Place extends Box {
  panel: { width: number; height: number };
}
interface Card {
  card: ReactNode;
  pinned: boolean;
  at: { top: number } | { bottom: number };
  room: number;
}
interface Menu {
  place: Place;
  items: MenuItem[];
}

const ROOM = 160; // the least height a card is put in
const EDGE = 4; // what floating things keep clear of the panel's edges
const MENU_WIDTH = 280; // the widest a menu is; narrower panels get a narrower one
// The corners and shadow of Paseo's own hover cards (workspace-hover-card.tsx), so that a card stands off what it covers.
const LIFTED = { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 8 } as const;
const FILL = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * Where a card goes (upstream's placeCard). VS Code's hover sits beside the list; a panel can draw nothing outside
 * itself, so a card goes above the section its row is in when there is room there, and else into the section, on the
 * side away from the row, so that the pointer can go on down or up the rows.
 */
function placeCard(row: Box, area: Box | null, panel: Place["panel"]): Omit<Card, "card" | "pinned"> {
  if (area && area.y - 8 >= ROOM) return { at: { bottom: panel.height - area.y + 4 }, room: area.y - 8 };
  const { y, height } = area ?? { y: 0, height: panel.height };
  return row.y + row.height / 2 < y + height / 2
    ? { at: { bottom: panel.height - y - height + 4 }, room: y + height - row.y - row.height - 8 }
    : { at: { top: y + 4 }, room: row.y - y - 8 };
}

/** Under the anchor, or over it when there is no room below, or pressed against the panel's bottom when neither fits. */
function vertical(at: Place, needs: number): ViewStyle {
  const below = at.y + at.height + 2;
  if (below + needs <= at.panel.height - EDGE) return { top: below };
  if (at.y - 2 - needs >= EDGE) return { bottom: at.panel.height - at.y + 2 };
  return { top: Math.max(EDGE, at.panel.height - needs - EDGE) };
}

export interface PanelRootProps {
  children: ReactNode;
  /** Fill the space given (the panel); false inside a dialog, which sizes to its content. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PanelRoot({ children, fill = true, style, testID }: PanelRootProps) {
  const th = useTheme();
  const root = useRef<View>(null);
  const [hint, setHint] = useState<(Place & { text: string }) | null>(null);
  const [shown, show] = useState<Menu | Card | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  // React tells of the pointer coming onto the card before the row hears it leave, so the card remembers it.
  const onCard = useRef(false);
  const carded = useRef(false);
  carded.current = shown !== null && "card" in shown;
  useEffect(() => () => clearTimeout(leaving.current), []);

  const floating = useMemo<Floating>(() => {
    const measureRoot = (then: (panel: Place["panel"], left: number, top: number) => void) =>
      root.current?.measureInWindow((left, top, width, height) => then({ width, height }, left, top));
    const locate = (anchor: Anchor, then: (place: Place) => void) =>
      measureRoot((panel, left, top) => {
        if (isPoint(anchor)) then({ x: anchor.x - left, y: anchor.y - top, width: 0, height: 0, panel });
        else anchor.measureInWindow((x, y, width, height) => then({ x: x - left, y: y - top, width, height, panel }));
      });
    const keep = () => clearTimeout(leaving.current);
    return {
      root,
      hint: (anchor, text) => locate(anchor, (place) => setHint({ ...place, text })),
      unhint: () => setHint(null),
      menu: (anchor, items) => {
        setHint(null);
        locate(anchor, (place) => show({ place, items }));
      },
      closeMenu: () => show((current) => (current && "items" in current ? null : current)),
      // A card does not take the place of an open menu, and only a pinned card stays when the pointer leaves it.
      card: (row, area, content, pinned) =>
        locate(row, (place) => {
          const put = (around: Box | null) => {
            keep();
            onCard.current = false;
            show((current) => (current && "items" in current ? current : { card: content, pinned, ...placeCard(place, around, place.panel) }));
          };
          if (area) locate(area, put);
          else put(null);
        }),
      uncard: () => {
        keep();
        if (onCard.current) return;
        leaving.current = setTimeout(() => show((current) => (current && "card" in current && !current.pinned ? null : current)), 300);
      },
      keep,
      carded: () => carded.current,
    };
  }, []);

  const closeMenu = () => {
    show(null);
    focusElement(root.current); // the keyboard goes back to the panel, where its shortcuts are
  };
  const box = { position: "absolute", borderWidth: 1, borderColor: th.c.border } as const;
  const fromRight = (at: Place) => ({ right: Math.max(EDGE, at.panel.width - at.x - at.width) });

  return (
    <FloatingContext.Provider value={floating}>
      <View ref={root} focusable={fill} testID={testID} style={[fill ? { flex: 1, minHeight: 0, minWidth: 0 } : null, { backgroundColor: th.c.surface0 }, style]}>
        {children}
        {shown && "card" in shown && (
          <>
            {shown.pinned && <Pressable accessible={false} onPress={() => show(null)} style={FILL} />}
            {/* Not a Pressable: its hover ends when the pointer comes onto a button inside it. */}
            <View
              onPointerEnter={() => {
                onCard.current = true;
                floating.keep();
              }}
              onPointerLeave={() => {
                onCard.current = false;
                floating.uncard();
              }}
              style={[box, LIFTED, { left: 8, right: 8, borderRadius: th.radius.lg, backgroundColor: th.c.surface1 }, shown.at]}
            >
              <ScrollView style={{ maxHeight: Math.max(ROOM / 2, shown.room) }} contentContainerStyle={{ padding: 10 }}>
                {shown.card}
              </ScrollView>
            </View>
          </>
        )}
        {shown && "items" in shown && (
          <>
            {/* Anything outside the menu closes it. */}
            <Pressable accessible={false} onPress={closeMenu} style={FILL} />
            <MenuSurface place={shown.place} items={shown.items} onClose={closeMenu} />
          </>
        )}
        {hint && (
          // A hint reaches towards the middle of the panel, and lets the pointer through.
          <View
            testID="ag-hint"
            style={[
              box,
              { maxWidth: Math.min(260, hint.panel.width - 2 * EDGE), paddingVertical: 3, paddingHorizontal: 7, borderRadius: th.radius.sm, backgroundColor: th.c.surface2, pointerEvents: "none" },
              hint.x + hint.width / 2 < hint.panel.width / 2 ? { left: Math.max(EDGE, hint.x) } : fromRight(hint),
              vertical(hint, 28),
            ]}
          >
            <T size={th.small}>{hint.text}</T>
          </View>
        )}
      </View>
    </FloatingContext.Provider>
  );
}

/** A menu's height before it is drawn: rows, separators, the lines that say why an entry is disabled. */
function estimate(items: MenuItem[], th: Theme, back: boolean) {
  let height = 8 + (back ? th.row + 4 : 0);
  for (const item of items) height += isSeparator(item) ? 9 : th.row + 4 + (item.disabled && item.reason ? th.small + 4 : 0);
  return height;
}

const enabled = (item: MenuItem): item is MenuAction => !isSeparator(item) && !item.disabled;

function MenuSurface({ place, items, onClose }: { place: Place; items: MenuItem[]; onClose: () => void }) {
  const th = useTheme();
  const { t } = useT();
  // Submenus open in place of their parent; Back (or ArrowLeft, or Escape) returns to it.
  const [stack, setStack] = useState<MenuItem[][]>([items]);
  const [active, setActive] = useState<number | null>(null);
  const current = stack[stack.length - 1];
  const nested = stack.length > 1;
  const mac = isMac();
  const width = Math.max(120, Math.min(MENU_WIDTH, place.panel.width - 2 * EDGE));
  const needs = estimate(current, th, nested);
  const height = Math.min(needs, place.panel.height - 2 * EDGE);
  // A menu opened from a button lines up with its right edge; one opened at a point starts there. Either way it stays inside.
  const wanted = place.width === 0 ? place.x : place.x + place.width - width;
  const left = Math.min(Math.max(EDGE, wanted), place.panel.width - width - EDGE);

  const choose = (item: MenuAction) => {
    if (item.disabled) return;
    if (item.submenu) {
      setStack([...stack, item.submenu]);
      setActive(null);
      return;
    }
    onClose();
    item.onPress?.();
  };
  const back = () => {
    if (!nested) return onClose();
    setStack(stack.slice(0, -1));
    setActive(null);
  };

  // The keyboard, on the web: arrows move, Enter or Space chooses, ArrowRight opens a submenu, ArrowLeft and Escape go back.
  const latest = useRef({ current, active, choose, back, onClose });
  latest.current = { current, active, choose, back, onClose };
  useEffect(
    () =>
      onWindowKeyDown((event) => {
        const { current, active, choose, back, onClose } = latest.current;
        const step = (delta: number) => {
          const indexes = current.map((item, index) => (enabled(item) ? index : -1)).filter((index) => index !== -1);
          if (indexes.length === 0) return;
          const at = active === null ? -1 : indexes.indexOf(active);
          const next = at === -1 ? (delta > 0 ? 0 : indexes.length - 1) : (at + delta + indexes.length) % indexes.length;
          setActive(indexes[next]);
        };
        const item = active === null ? undefined : current[active];
        switch (event.key) {
          case "ArrowDown":
            step(1);
            return true;
          case "ArrowUp":
            step(-1);
            return true;
          case "Enter":
          case " ":
            if (item && enabled(item)) choose(item);
            return true;
          case "ArrowRight":
            if (item && enabled(item) && item.submenu) choose(item);
            return true;
          case "ArrowLeft":
            back();
            return true;
          case "Escape":
            if (stack.length > 1) back();
            else onClose();
            return true;
          case "Tab":
            onClose();
            return false;
          default:
            return false;
        }
      }),
    [stack.length],
  );

  const marks = current.some((item) => !isSeparator(item) && (item.icon !== undefined || item.checked !== undefined));
  return (
    <View
      accessibilityRole="menu"
      testID="ag-menu"
      style={[
        { position: "absolute", width, left, maxHeight: place.panel.height - 2 * EDGE, borderWidth: 1, borderColor: th.c.border, borderRadius: th.radius.md, backgroundColor: th.c.surface1, paddingVertical: 4 },
        LIFTED,
        vertical(place, height),
      ]}
    >
      <ScrollView style={{ maxHeight: height - 8 }} keyboardShouldPersistTaps="handled">
        {nested && (
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel={t("common.submenuBack")}
            onPress={back}
            style={({ pressed }) => ({ height: th.row + 4, flexDirection: "row", alignItems: "center", gap: th.space.sm, paddingHorizontal: 10, backgroundColor: pressed ? th.c.surface2 : undefined })}
          >
            <Glyph icon="ChevronLeft" size={th.icon - 2} />
            <T tone="muted">{t("common.back")}</T>
          </Pressable>
        )}
        {current.map((item, index) =>
          isSeparator(item) ? (
            <View key={item.id} style={{ height: 1, marginVertical: 4, backgroundColor: th.c.border }} />
          ) : (
            <MenuRow key={item.id} item={item} active={index === active} marks={marks} mac={mac} onHover={() => setActive(index)} onPress={() => choose(item)} />
          ),
        )}
      </ScrollView>
    </View>
  );
}

function MenuRow({ item, active, marks, mac, onHover, onPress }: { item: MenuAction; active: boolean; marks: boolean; mac: boolean; onHover: () => void; onPress: () => void }) {
  const th = useTheme();
  const color = item.danger ? th.c.statusDanger : th.c.foreground;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={item.label}
      accessibilityHint={item.disabled && item.reason ? item.reason : undefined}
      accessibilityState={{ disabled: item.disabled === true, checked: item.checked }}
      aria-disabled={item.disabled === true}
      testID={item.testID}
      onHoverIn={onHover}
      // Not the disabled prop: that would also stop the hover that shows which entry the keyboard is on.
      onPress={item.disabled ? undefined : onPress}
      style={({ pressed }) => ({
        minHeight: th.row + 4,
        justifyContent: "center",
        paddingHorizontal: 10,
        paddingVertical: 2,
        opacity: item.disabled ? 0.5 : 1,
        backgroundColor: pressed && !item.disabled ? th.c.surface2 : active ? th.hover : undefined,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm }}>
        {marks && (
          <View style={{ width: th.icon, alignItems: "center" }}>
            {item.checked ? <Glyph icon={codicon.check} color={color} /> : item.icon !== undefined ? <Glyph icon={item.icon} color={item.danger ? color : undefined} /> : null}
          </View>
        )}
        <T color={color} lines={1} style={{ flex: 1, minWidth: 0 }}>
          {item.label}
        </T>
        {item.shortcut !== undefined && (
          <T size={th.small} tone="muted">
            {formatChord(item.shortcut, mac)}
          </T>
        )}
        {item.submenu && <Glyph icon={codicon.chevronRight} size={th.icon - 2} />}
      </View>
      {item.disabled && item.reason ? (
        <T size={th.small} tone="muted" lines={2} style={{ paddingLeft: marks ? th.icon + th.space.sm : 0 }}>
          {item.reason}
        </T>
      ) : null}
    </Pressable>
  );
}
