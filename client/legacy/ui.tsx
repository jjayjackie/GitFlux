// What every part of the panel is built from. Colours come from the host's theme, save those VS Code gives
// where the theme has no match: the graph's upstream and base branches, and the shadow under kept rows.

import type { PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { LayoutChangeEvent, PressableStateCallbackType, StyleProp, TextStyle, ViewStyle } from "react-native";
import * as codicon from "../ui/codicons";
import type { Codicon } from "../ui/codicons";

type Host = Pick<PluginHostProps, "theme" | "layout">;
const HostContext = createContext<Host | null>(null);
export const HostProvider = HostContext.Provider;

/**
 * Paseo's code font before "Code font" is set in its settings, which plugins are not told: on the web its default font
 * stack. Native apps take one font name, not a list. Code is 16px, chosen for this panel while Paseo's "Code size" is
 * not told to plugins either; its lines are 1.5 times that, as Paseo's diffs and VS Code's editor on macOS have them.
 */
const MONO = { ios: "Menlo", android: "monospace", web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" };
const CODE_SIZE = 16;

/** The theme and the sizes that follow from the layout: rows are taller where they are touched. */
export function useHost() {
  const host = useContext(HostContext);
  if (!host) throw new Error("useHost needs a HostProvider above it");
  const { compact, platform } = host.layout;
  const code = useMemo(() => codeFont(platform), [platform]);
  return { c: host.theme.colors, compact, platform, mono: MONO[platform], code, text: compact ? 15 : 13, small: compact ? 12 : 11, row: compact ? 34 : 24 };
}

/**
 * Code as the diff draws it. Paseo smooths all its text thinner (`-webkit-font-smoothing: antialiased` on its page);
 * code is drawn as VS Code draws it by default, its `workbench.fontAliasing` left at `default`.
 */
function codeFont(platform: Host["layout"]["platform"]) {
  const smoothing = platform === "web" ? ({ WebkitFontSmoothing: "auto" } as unknown as TextStyle) : {};
  return { fontFamily: MONO[platform], fontSize: CODE_SIZE, lineHeight: Math.round(CODE_SIZE * 1.5), ...smoothing };
}

interface TProps {
  children: ReactNode;
  size?: number;
  color?: string;
  weight?: "600";
  mono?: boolean;
  lines?: number;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
}

/**
 * Whether a theme colour is dark: the theme names no appearance, only colours, and VS Code's own colours, which the
 * panel borrows where the theme has none, differ for dark and light. Paseo's colours come as #rrggbb.
 */
export function isDark(color: string) {
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color)?.[1];
  if (!hex) throw new Error(`A theme colour is not #rrggbb or #rgb: ${color}`);
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

/** The list with `item` taken out if it is in it, and put in if it is not. */
export const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((other) => other !== item) : [...list, item]);

/** Text in the theme's colours. */
export function T({ children, size, color, weight, mono, lines, selectable, style }: TProps) {
  const host = useHost();
  return (
    <Text
      numberOfLines={lines}
      selectable={selectable}
      style={[{ color: color ?? host.c.foreground, fontSize: size ?? host.text, fontWeight: weight }, mono && { fontFamily: host.mono }, style]}
    >
      {children}
    </Text>
  );
}

/**
 * Colours a list row while the pointer is on it, as VS Code does with `list.hoverBackground` in Dark 2026 and Light 2026:
 * the host gives plugins no colour for it, and VS Code's see through to whatever the row is on. Use as a Pressable's style.
 */
export function useRowHover() {
  const { c } = useHost();
  const colour = isDark(c.surface0) ? "#FFFFFF14" : "#00000014";
  return ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (hovered ? { backgroundColor: colour } : null);
}

/** A wash of colour behind a row: the theme has no translucent tokens. */
export function Tint({ color, opacity }: { color: string; opacity: number }) {
  return <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: color, opacity, pointerEvents: "none" }} />;
}

// --- what floats over the panel: hints, menus and cards ---------------------------

export interface MenuItem {
  label: string;
  enabled: boolean;
  onPress: () => void;
}
/** A button's box inside the panel, and the panel's size. */
interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
  panel: { width: number; height: number };
}
interface Floating {
  hint(button: View, text: string): void;
  unhint(): void;
  menu(button: View, items: MenuItem[]): void;
  card(row: View, area: View | null, content: ReactNode, pinned: boolean): void; // pinned: until something else is pressed
  uncard(): void; // the pointer has left the row: in a moment, unless it is on the card or comes back first
  keep(): void; // the pointer is back on the row
  carded(): boolean; // whether a card shows
}
type Box = Omit<Place, "panel">;
type Card = { card: ReactNode; pinned: boolean; at: { top: number } | { bottom: number }; room: number };

const ROOM = 160; // the least height a card is put in
// The corners and shadow of Paseo's own hover cards (workspace-hover-card.tsx), so that a card stands off what it covers.
const CARD = { borderRadius: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 8 } as const;

/**
 * Where a card goes. VS Code's hover sits beside the list, clear of its rows; a panel can draw nothing outside itself, so a
 * card goes above the section its row is in when there is room for it there, and else into the section, on the side away
 * from the row, so that the pointer can go on down or up the rows.
 */
function placeCard(row: Box, area: Box | null, panel: Place["panel"]): Omit<Card, "card" | "pinned"> {
  if (area && area.y - 8 >= ROOM) return { at: { bottom: panel.height - area.y + 4 }, room: area.y - 8 };
  const { y, height } = area ?? { y: 0, height: panel.height };
  return row.y + row.height / 2 < y + height / 2 ? { at: { bottom: panel.height - y - height + 4 }, room: y + height - row.y - row.height - 8 } : { at: { top: y + 4 }, room: row.y - y - 8 };
}
const FloatingContext = createContext<Floating | null>(null);

function useFloating() {
  const floating = useContext(FloatingContext);
  if (!floating) throw new Error("Hints, menus and cards need a PanelRoot above them");
  return floating;
}

/**
 * The panel's root. Hints, menus and cards are drawn here, over everything else, so that no list can cut them off. A menu
 * or a card shows one at a time; a hint shows over either, for the buttons on a card.
 */
export function PanelRoot({ children }: { children: ReactNode }) {
  const { c, small, row } = useHost();
  const root = useRef<View>(null);
  const [hint, setHint] = useState<(Place & { text: string }) | null>(null);
  const [shown, show] = useState<(Place & { menu: MenuItem[] }) | Card | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined);
  // React tells of the pointer coming onto the card before the row hears it leave, so the card remembers it.
  const onCard = useRef(false);
  const carded = useRef(false);
  carded.current = shown !== null && "card" in shown;
  useEffect(() => () => clearTimeout(leaving.current), []);
  const floating = useMemo<Floating>(() => {
    const locate = (button: View, then: (place: Place) => void) =>
      root.current?.measureInWindow((left, top, width, height) => button.measureInWindow((x, y, w, h) => then({ x: x - left, y: y - top, width: w, height: h, panel: { width, height } })));
    const keep = () => clearTimeout(leaving.current);
    return {
      hint: (button, text) => locate(button, (place) => setHint({ ...place, text })),
      unhint: () => setHint(null),
      menu: (button, items) => locate(button, (place) => show({ ...place, menu: items })),
      // A card does not take the place of an open menu, and only a pinned card stays when the pointer leaves it.
      card: (row, area, content, pinned) =>
        locate(row, (place) => {
          const put = (around: Box | null) => {
            keep();
            onCard.current = false;
            show((shown) => (shown && "menu" in shown ? shown : { card: content, pinned, ...placeCard(place, around, place.panel) }));
          };
          if (area) locate(area, put);
          else put(null);
        }),
      uncard: () => {
        keep();
        if (onCard.current) return;
        leaving.current = setTimeout(() => show((shown) => (shown && "card" in shown && !shown.pinned ? null : shown)), 300);
      },
      keep,
      carded: () => carded.current,
    };
  }, []);
  // Under the button, or over it when there is no room below.
  const upright = (at: Place, needs: number) => (at.y + at.height + needs < at.panel.height ? { top: at.y + at.height + 4 } : { bottom: at.panel.height - at.y + 4 });
  const fromRight = (at: Place) => ({ right: Math.max(4, at.panel.width - at.x - at.width) });
  const box = { position: "absolute", borderWidth: 1, borderColor: c.border } as const;
  const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
  return (
    <FloatingContext.Provider value={floating}>
      <View ref={root} style={{ flex: 1, backgroundColor: c.surface0 }}>
        {children}
        {shown && "card" in shown && (
          <>
            {shown.pinned && <Pressable accessibilityLabel="Close the card" onPress={() => show(null)} style={fill} />}
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
              style={[box, CARD, { left: 8, right: 8, backgroundColor: c.surface1 }, shown.at]}
            >
              <ScrollView style={{ maxHeight: shown.room }} contentContainerStyle={{ padding: 10 }}>
                {shown.card}
              </ScrollView>
            </View>
          </>
        )}
        {shown && "menu" in shown && (
          <>
            {/* Anything outside the menu closes it. */}
            <Pressable accessibilityLabel="Close the menu" onPress={() => show(null)} style={fill} />
            <View style={[box, { minWidth: 170, paddingVertical: 4, borderRadius: 6, backgroundColor: c.surface1 }, fromRight(shown), upright(shown, shown.menu.length * (row + 4) + 12)]}>
              {shown.menu.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="menuitem"
                  accessibilityLabel={item.label}
                  aria-disabled={!item.enabled}
                  disabled={!item.enabled}
                  onPress={() => {
                    show(null);
                    item.onPress();
                  }}
                  style={({ pressed }) => ({ height: row + 4, justifyContent: "center", paddingHorizontal: 12, opacity: item.enabled ? 1 : 0.4, backgroundColor: pressed ? c.surface2 : undefined })}
                >
                  <T>{item.label}</T>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {hint && (
          // A hint reaches towards the middle of the panel, and lets the pointer through.
          <View
            style={[
              box,
              { maxWidth: 260, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 4, backgroundColor: c.surface2, pointerEvents: "none" },
              hint.x + hint.width / 2 < hint.panel.width / 2 ? { left: Math.max(4, hint.x) } : fromRight(hint),
              upright(hint, 28),
            ]}
          >
            <T size={small}>{hint.text}</T>
          </View>
        )}
      </View>
    </FloatingContext.Provider>
  );
}

/** Makes a Pressable say what it does once the pointer has rested on it. Spread the result into it. */
export function useHint(text: string) {
  const floating = useFloating();
  const ref = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hide = () => {
    clearTimeout(timer.current);
    floating.unhint();
  };
  useEffect(() => () => clearTimeout(timer.current), []); // a button that goes away does not speak afterwards
  return {
    ref,
    onHoverIn: () => {
      timer.current = setTimeout(() => ref.current && floating.hint(ref.current, text), 500);
    },
    onHoverOut: hide,
    onPressIn: hide,
  };
}

/** Opens a menu under a button: `open(button, items)`. Choosing an item, or pressing anywhere else, closes it. */
export function useMenu() {
  return useFloating().menu;
}

const AreaContext = createContext<RefObject<View | null> | null>(null);

/** A part of the panel that the cards of the rows in it keep clear of where they can. */
export function CardArea({ style, onLayout, children }: { style: ViewStyle; onLayout?: (event: LayoutChangeEvent) => void; children: ReactNode }) {
  const ref = useRef<View>(null);
  return (
    <AreaContext.Provider value={ref}>
      <View ref={ref} style={style} onLayout={onLayout}>
        {children}
      </View>
    </AreaContext.Provider>
  );
}

// VS Code's `workbench.hover.delay`: 1500 milliseconds on a Mac, 500 elsewhere, told as VS Code tells it in a browser.
const HOVER_DELAY = (Platform.OS === "web" ? navigator.userAgent.includes("Macintosh") : Platform.OS === "ios") ? 1500 : 500;
// While a card shows, VS Code shows the next row's at once; here the card is not beside its row, and the pointer crosses
// other rows on its way to it, so a row must hold the pointer this long to take the card over.
const HOVER_SWITCH = 150;

/**
 * Shows `card()` once the pointer has rested on a row, and keeps it while the pointer moves onto it, as VS Code's hovers
 * do. Where there is no pointer, a long press shows it until something else is pressed. Spread the result into the row.
 */
export function useHoverCard(card: () => ReactNode) {
  const floating = useFloating();
  const area = useContext(AreaContext);
  const ref = useRef<View>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const open = (pinned: boolean) => ref.current && floating.card(ref.current, area?.current ?? null, card(), pinned);
  const leave = () => {
    clearTimeout(timer.current);
    floating.uncard();
  };
  return {
    ref,
    onHoverIn: () => {
      floating.keep();
      timer.current = setTimeout(() => open(false), floating.carded() ? HOVER_SWITCH : HOVER_DELAY);
    },
    onHoverOut: leave,
    onPressIn: leave,
    onLongPress: () => open(true),
  };
}

/** `hint` is what hovering shows; it is the label unless the label names a file. */
/** A button with an icon. `toggled`, it is a switch, on while its background shows, as VS Code shows a toggled action. */
export function IconButton({ icon, label, hint, onPress, disabled, toggled }: { icon: Codicon; label: string; hint?: string; onPress: () => void; disabled?: boolean; toggled?: boolean }) {
  const { c, compact } = useHost();
  return (
    <Pressable
      {...useHint(hint ?? label)}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      // A toggle says whether it is on as VS Code's toggled actions do (actionViewItems.ts: aria-pressed); React Native
      // has no aria-pressed, and reads it from accessibilityState.
      {...({ "aria-pressed": toggled } as object)}
      accessibilityState={{ checked: toggled }}
      hitSlop={4}
      onPress={disabled ? undefined : onPress} // not the disabled prop: that would switch off hovering, and the hint with it
      style={({ pressed }) => ({ padding: compact ? 6 : 3, borderRadius: 4, opacity: disabled ? 0.4 : pressed ? 0.6 : 1, backgroundColor: toggled ? c.surface2 : undefined })}
    >
      <Icon icon={icon} size={compact ? 18 : 16} color={c.foregroundMuted} />
    </Pressable>
  );
}

interface HeadingProps {
  title: string;
  folded: boolean;
  onFold: () => void;
  count?: number; // how many things it holds
  group?: boolean; // the title of a group of changes inside a section: as VS Code draws it, a step in and in plain text
  onChevron?: () => void; // given, the chevron is pressed apart from the rest of the title
  children?: ReactNode; // its actions
}

/**
 * The title bar of something that folds: a section of the panel, or a group of changes. A group is a row of a tree, as
 * VS Code's are (abstractTree.ts: "treeitem"), its actions inside it. A section's title bar is a button, as VS Code's
 * pane header is (paneview.ts); its actions lie over that button rather than in it, since a button holds no other.
 */
export function Heading({ title, folded, onFold, count, group, onChevron, children }: HeadingProps) {
  const { c, row, small } = useHost();
  const style = { flexDirection: "row", alignItems: "center", gap: 4, height: row, paddingLeft: group ? 12 : 8, paddingRight: 8 } as const;
  const number = count !== undefined && (
    <T size={small} color={c.foregroundMuted} style={{ minWidth: 12, textAlign: "center" }}>
      {String(count)}
    </T>
  );
  if (group)
    return (
      <Pressable role="treeitem" accessibilityLabel={title} aria-expanded={!folded} onPress={onFold} style={style}>
        <Chevron folded={folded} label={title} onPress={onChevron} />
        <T lines={1} style={{ flex: 1, minWidth: 0 }}>
          {title}
        </T>
        {children}
        {number}
      </Pressable>
    );
  return (
    <View style={style}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} aria-expanded={!folded} onPress={onFold} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
      <View pointerEvents="none" aria-hidden style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Chevron folded={folded} label={title} />
        <T size={small} weight="600" color={c.foregroundMuted} lines={1} style={{ flex: 1, minWidth: 0, textTransform: "uppercase" }}>
          {title}
        </T>
      </View>
      {children}
      {number && (
        <View pointerEvents="none" aria-hidden>
          {number}
        </View>
      )}
    </View>
  );
}

/** The arrow that says whether a row is folded. With `onPress`, pressing it is apart from pressing the row. */
export function Chevron({ folded, label, onPress }: { folded: boolean; label: string; onPress?: () => void }) {
  const { c, small } = useHost();
  const icon = <Icon icon={folded ? codicon.chevronRight : codicon.chevronDown} size={small + 5} color={c.foregroundMuted} />;
  if (!onPress) return icon;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${folded ? "Expand" : "Collapse"} ${label}`} hitSlop={4} onPress={onPress}>
      {icon}
    </Pressable>
  );
}

/** A line that stands in for content: nothing here yet, or what went wrong. */
export function Notice({ children, failed }: { children: string; failed?: boolean }) {
  const { c, small } = useHost();
  return (
    <T size={small + 1} color={failed ? c.statusDanger : c.foregroundMuted} selectable={failed} style={{ padding: 12 }}>
      {children}
    </T>
  );
}
