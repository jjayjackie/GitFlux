// Every browser API the panel uses, and nothing else touches one (architecture §3, §9). On iOS and Android each function
// is a harmless no-op: native apps give plugins no hardware-keyboard or right-click API, which is a documented limit.
//
// The project type-checks without the DOM library, so the few DOM shapes used here are declared structurally below and
// reached through `globalThis`, never as globals. A React Native Web view's ref is its DOM element; elsewhere it is a
// native handle that these functions recognise as "not an element" and ignore.
//
// Usage:
//   useEffect(() => registerShortcuts(rootRef.current, (chord, event) => handled), []);
//   useEffect(() => bindContextMenu(rowRef.current, ({ x, y }) => openMenuAt(x, y)), []);
//   useEffect(() => onWindowKeyDown((event) => handled), []);   // while a menu is open
//   isMac() ? "⌘" : "Ctrl"

import { Platform } from "react-native";
import type { ViewStyle } from "react-native";

/** The parts of a DOM KeyboardEvent / MouseEvent read here. */
export interface WebKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}
interface WebMouseEvent {
  clientX: number;
  clientY: number;
  shiftKey?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
interface WebElement {
  addEventListener(type: string, listener: (event: never) => void, options?: boolean): void;
  removeEventListener(type: string, listener: (event: never) => void, options?: boolean): void;
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
  querySelector?(selector: string): { click(): void } | null;
  focus?(): void;
}
interface WebGlobals {
  navigator?: { userAgent?: string; platform?: string };
  addEventListener?: WebElement["addEventListener"];
  removeEventListener?: WebElement["removeEventListener"];
}

export const isWeb = Platform.OS === "web";

const web = (): WebGlobals => globalThis as unknown as WebGlobals;

function asElement(node: unknown): WebElement | null {
  if (!isWeb || node === null || typeof node !== "object") return null;
  const element = node as Partial<WebElement>;
  return typeof element.addEventListener === "function" && typeof element.removeEventListener === "function" ? (element as WebElement) : null;
}

/** Whether the keyboard has ⌘ rather than Ctrl: a Mac in a browser, or an Apple device. */
export function isMac(): boolean {
  if (!isWeb) return Platform.OS === "ios";
  const navigator = web().navigator;
  const agent = `${navigator?.platform ?? ""} ${navigator?.userAgent ?? ""}`;
  return /Mac|iPhone|iPad|iPod/.test(agent);
}

/**
 * A key press as a chord: modifiers in the order Mod, Alt, Shift, then the key. Mod is ⌘ on a Mac and Ctrl elsewhere.
 * Letters and digits are read from the physical key (`KeyF` → "F"), so Alt+F is "Alt+F" even where Alt types "ƒ";
 * other keys by what they type ("?", "/", "Enter", "Escape", "ArrowUp"), and Shift is then implied, not named, for a
 * single printable character ("?" rather than "Shift+/").
 */
export function chordOf(event: Pick<WebKeyEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, mac = isMac()): string {
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? "");
  const key = physical ? (physical[1] ?? physical[2]) : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const printable = !physical && event.key.length === 1;
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey && !printable) parts.push("Shift");
  parts.push(key === " " ? "Space" : key);
  return parts.join("+");
}

/** Whether a key event comes from somewhere text is typed. */
function typing(target: unknown): boolean {
  const element = target as Partial<WebElement> | null;
  if (!element || typeof element !== "object") return false;
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true;
}

/**
 * Listens for key presses inside `element` (the panel's root): they reach it only while focus is inside the panel, so
 * shortcuts never fire in another part of the app. `handler` gets the chord and returns true when it acted; the event
 * is then stopped. Presses in a text field are ignored unless `allowInInput(chord)` says otherwise (Mod+Enter to
 * commit, Escape). Returns the remover; a no-op on native.
 */
export function registerShortcuts(element: unknown, handler: (chord: string, event: WebKeyEvent) => boolean, allowInInput: (chord: string) => boolean = () => false): () => void {
  const target = asElement(element);
  if (!target) return () => {};
  const listener = (event: WebKeyEvent) => {
    if (event.isComposing) return;
    const chord = chordOf(event);
    if (typing(event.target) && !allowInInput(chord)) return;
    if (handler(chord, event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  target.addEventListener("keydown", listener as (event: never) => void);
  return () => target.removeEventListener("keydown", listener as (event: never) => void);
}

/**
 * Listens for key presses anywhere in the window, before anything else hears them: for an open menu, which takes the
 * arrows, Enter and Escape. `handler` returns true when it used the key. Returns the remover; a no-op on native.
 */
export function onWindowKeyDown(handler: (event: WebKeyEvent) => boolean): () => void {
  const globals = web();
  if (!isWeb || typeof globals.addEventListener !== "function" || typeof globals.removeEventListener !== "function") return () => {};
  const listener = (event: WebKeyEvent) => {
    if (handler(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  globals.addEventListener("keydown", listener as (event: never) => void, true);
  return () => globals.removeEventListener?.("keydown", listener as (event: never) => void, true);
}

/**
 * Opens a context menu on right-click (or the keyboard's menu key) over `element`, instead of the browser's: `open`
 * gets the pointer's position in the window. Shift+right-click keeps the browser's menu. Returns the remover; a no-op
 * on native, where useContextMenu falls back to a long press.
 */
export function bindContextMenu(element: unknown, open: (point: { x: number; y: number }) => void): () => void {
  const target = asElement(element);
  if (!target) return () => {};
  const listener = (event: WebMouseEvent) => {
    if (event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    open({ x: event.clientX, y: event.clientY });
  };
  target.addEventListener("contextmenu", listener as (event: never) => void);
  return () => target.removeEventListener("contextmenu", listener as (event: never) => void);
}

/** Presses the first link inside `element`: how ui/FileOpener.tsx opens a file in Paseo's own tab. False if none. */
export function clickFirstLink(element: unknown): boolean {
  const target = asElement(element);
  const link = target?.querySelector?.("a") ?? null;
  if (!link) return false;
  link.click();
  return true;
}

/** Moves keyboard focus to `element` (the panel's root after a menu closes). A no-op on native. */
export function focusElement(element: unknown): void {
  asElement(element)?.focus?.();
}

/** Styles React Native's types do not know, which only mean something in a browser: the pointer and text selection. */
export function webStyle(style: { cursor?: string; userSelect?: "none" | "text" | "auto" }): ViewStyle | null {
  return isWeb ? (style as unknown as ViewStyle) : null;
}
