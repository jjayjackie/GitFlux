// The panel's keyboard shortcuts (architecture §9): what each chord does, and the words that describe it in the help
// dialog (layout/ShortcutsDialog.tsx) and beside menu entries. Listened for by layout/Panel.tsx through
// client/web.ts, only while the panel has focus, and only on the web: native apps give plugins no hardware-keyboard
// API (a documented limit). Pure: unit-tested (no duplicate chords; every description is in en.json).
//
// Chords are written as client/web.ts's chordOf spells them: modifiers Mod (⌘ on a Mac, Ctrl elsewhere), Alt, Shift,
// then the key; a printable character other than a letter or digit stands alone ("?", "/").

import type { GitCommand } from "./state/selectionStore.ts";

export interface Shortcut {
  chord: string;
  command: GitCommand;
  /** A key in en.json's `shortcuts` section. */
  description: `shortcuts.${string}`;
  /** Also while typing in a text field (Mod+Enter commits from the message box). */
  allowInInput?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { chord: "Mod+Enter", command: { type: "commit" }, description: "shortcuts.commit", allowInInput: true },
  { chord: "Alt+F", command: { type: "fetch" }, description: "shortcuts.fetch" },
  { chord: "Alt+P", command: { type: "pull" }, description: "shortcuts.pull" },
  { chord: "Alt+Shift+P", command: { type: "push" }, description: "shortcuts.push" },
  { chord: "Alt+S", command: { type: "sync" }, description: "shortcuts.sync" },
  { chord: "Alt+R", command: { type: "refresh" }, description: "shortcuts.refresh" },
  { chord: "Alt+N", command: { type: "create-branch" }, description: "shortcuts.createBranch" },
  { chord: "Alt+B", command: { type: "switch-branch" }, description: "shortcuts.switchBranch" },
  { chord: "Alt+Z", command: { type: "stash" }, description: "shortcuts.stash" },
  { chord: "/", command: { type: "focus-search", area: "graph" }, description: "shortcuts.focusSearch" },
  { chord: "Alt+K", command: { type: "focus-search", area: "nav" }, description: "shortcuts.focusFilter" },
  { chord: "Alt+E", command: { type: "toggle-navigation" }, description: "shortcuts.toggleNavigation" },
  { chord: "Alt+1", command: { type: "show-tab", tab: "changes" }, description: "shortcuts.showChanges" },
  { chord: "Alt+2", command: { type: "show-tab", tab: "graph" }, description: "shortcuts.showGraph" },
  { chord: "Alt+3", command: { type: "show-tab", tab: "branches" }, description: "shortcuts.showBranches" },
  { chord: "Escape", command: { type: "close-detail" }, description: "shortcuts.closeDetail" },
  { chord: "?", command: { type: "show-shortcuts" }, description: "shortcuts.showShortcuts" },
  { chord: "F7", command: { type: "diff-step", delta: 1 }, description: "shortcuts.nextChange" }, // as VS Code's diff editor
  { chord: "Shift+F7", command: { type: "diff-step", delta: -1 }, description: "shortcuts.previousChange" },
];

const byChord = new Map(SHORTCUTS.map((shortcut) => [shortcut.chord, shortcut]));

/** The shortcut a chord stands for, if any. */
export function findShortcut(chord: string): Shortcut | undefined {
  return byChord.get(chord);
}

/** Whether a chord works while typing in a text field. */
export function allowedInInput(chord: string): boolean {
  return byChord.get(chord)?.allowInInput === true;
}

/** The chord of the first shortcut for a command type, to show beside a menu entry or in a hint. */
export function chordFor(type: GitCommand["type"]): string | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.command.type === type)?.chord;
}

const MAC: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧", Enter: "↩", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
const OTHER: Record<string, string> = { Mod: "Ctrl", Alt: "Alt", Shift: "Shift", Enter: "Enter", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

/** A chord's keys as the platform names them: ["⌘", "↩"] on a Mac, ["Ctrl", "Enter"] elsewhere. */
export function chordKeys(chord: string, mac: boolean): string[] {
  const names = mac ? MAC : OTHER;
  // "Alt++" would name the plus key; no shortcut uses it, so a plain split is enough.
  return chord.split("+").map((part) => names[part] ?? part);
}

/** A chord as one string: "⌘↩" on a Mac, "Ctrl+Enter" elsewhere. */
export function formatChord(chord: string, mac: boolean): string {
  return chordKeys(chord, mac).join(mac ? "" : "+");
}
