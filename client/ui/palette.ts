// The colours the host's theme does not have (architecture §9): diff backgrounds, syntax, graph lanes, the row under
// the pointer. Each comes in a dark and a light set, picked by the luminance of the theme's `surface0`, as upstream
// does. Pure: unit-tested.
//
// Diff, hover and graph colours are upstream's (client/legacy/Diff.tsx, ui.tsx, Graph.tsx), which took them from
// VS Code 1.142.0's default themes, Dark 2026 and Light 2026 (extensions/theme-defaults/themes) and from
// src/vs/platform/theme/common/colors. Syntax colours follow VS Code's Dark+ and Light+ themes
// (extensions/theme-defaults/themes/dark_plus.json, dark_vs.json, light_plus.json, light_vs.json), mapped to
// highlight.js scopes.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt

import type { TokenScope } from "../../shared/schemas.ts";

/**
 * Whether a colour is dark: the theme names no appearance, only colours. Reads #rgb, #rrggbb, #rrggbbaa and
 * rgb()/rgba(); anything else counts as dark (Paseo's default appearance) rather than failing the panel.
 */
export function isDark(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return true;
  const [r, g, b] = rgb.map((channel) => channel / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

function parseColor(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex.slice(0, 6);
    return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
  }
  const fn = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i.exec(color.trim());
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null;
}

/** The diff editor's colours (upstream's useColours in Diff.tsx). */
export interface DiffPalette {
  insertedLine: string; // diffEditor.insertedLineBackground
  insertedText: string; // diffEditor.insertedTextBackground: the changed words, over the line's colour
  removedLine: string; // diffEditor.removedLineBackground
  removedText: string; // diffEditor.removedTextBackground
  filler: string; // diffEditor.diagonalFill: the side with less to show
  unchanged: string; // diffEditor.unchangedCodeBackground
  shadow: string; // diffEditor.unchangedRegionShadow
  ruler: { background: string; removed: string; added: string; slider: [string, string, string] };
}

export const DIFF_DARK: DiffPalette = {
  insertedLine: "#347d3926",
  insertedText: "#57ab5a4d",
  removedLine: "#c93c3726",
  removedText: "#f470674d",
  filler: "#cccccc33",
  unchanged: "#74747429",
  shadow: "#000000",
  ruler: {
    background: "rgba(255, 255, 255, 0.01)",
    removed: "rgba(244, 112, 103, 0.604)",
    added: "rgba(87, 171, 90, 0.604)",
    slider: ["#A8A9AA85", "#A8A9AA90", "#A8A9AA9C"],
  },
};

export const DIFF_LIGHT: DiffPalette = {
  insertedLine: "rgba(155, 185, 85, 0.2)",
  insertedText: "#587c0c26",
  removedLine: "rgba(255, 0, 0, 0.2)",
  removedText: "#ad070726",
  filler: "#22222233",
  unchanged: "#b8b8b829",
  shadow: "#737373BF",
  ruler: {
    background: "rgba(0, 0, 0, 0.03)",
    removed: "rgba(173, 7, 7, 0.298)",
    added: "rgba(88, 124, 12, 0.298)",
    slider: ["#646464C0", "#646464D0", "#646464E0"],
  },
};

/** A colour per highlight.js scope; null draws the scope in the theme's foreground. */
export type SyntaxPalette = Readonly<Record<TokenScope, string | null>>;

/** VS Code Dark+. */
export const SYNTAX_DARK: SyntaxPalette = {
  none: null,
  keyword: "#569CD6", // storage, keyword
  string: "#CE9178",
  comment: "#6A9955",
  number: "#B5CEA8",
  literal: "#569CD6", // constant.language
  built_in: "#DCDCAA", // support.function
  type: "#4EC9B0", // entity.name.type, support.type
  title: "#DCDCAA", // entity.name.function
  function: "#DCDCAA",
  class: "#4EC9B0", // entity.name.class
  params: "#9CDCFE", // variable.parameter
  variable: "#9CDCFE",
  property: "#9CDCFE",
  attr: "#9CDCFE", // entity.other.attribute-name
  attribute: "#9CDCFE",
  operator: null,
  punctuation: null,
  tag: "#569CD6", // entity.name.tag
  name: "#569CD6",
  meta: "#569CD6", // meta.preprocessor
  regexp: "#D16969",
  symbol: "#4FC1FF", // variable.other.constant
  section: "#569CD6", // markup.heading
  addition: "#B5CEA8", // markup.inserted
  deletion: "#CE9178", // markup.deleted
  emphasis: null,
  strong: null,
  link: null,
  doctag: "#569CD6", // storage.type.class.jsdoc
  subst: null,
  selector: "#D7BA7D", // entity.other.attribute-name.class.css
  bullet: "#6796E6", // markup.list
  code: "#CE9178", // markup.inline.raw
  quote: "#6A9955", // markup.quote
  template: null,
  char: "#D7BA7D", // constant.character.escape
};

/** VS Code Light+. */
export const SYNTAX_LIGHT: SyntaxPalette = {
  none: null,
  keyword: "#0000FF",
  string: "#A31515",
  comment: "#008000",
  number: "#098658",
  literal: "#0000FF",
  built_in: "#795E26",
  type: "#267F99",
  title: "#795E26",
  function: "#795E26",
  class: "#267F99",
  params: "#001080",
  variable: "#001080",
  property: "#001080",
  attr: "#E50000",
  attribute: "#E50000",
  operator: null,
  punctuation: null,
  tag: "#800000",
  name: "#800000",
  meta: "#0000FF",
  regexp: "#811F3F",
  symbol: "#0070C1",
  section: "#800000",
  addition: "#098658",
  deletion: "#A31515",
  emphasis: null,
  strong: null,
  link: null,
  doctag: "#0000FF",
  subst: null,
  selector: "#800000",
  bullet: "#0451A5",
  code: "#800000",
  quote: "#0451A5",
  template: null,
  char: "#EE0000",
};

/**
 * VS Code's colours for the graph's upstream and for the branch the checked-out one was made from
 * (scmGraph.historyItemRemoteRefColor, scmGraph.historyItemBaseRefColor), as upstream's Graph.tsx has them.
 */
export const GRAPH_UPSTREAM = { dark: "#B180D7", light: "#652D90" } as const;
export const GRAPH_BASE = "#EA5C00";

/** VS Code's list.hoverBackground in Dark 2026 and Light 2026 (upstream's useRowHover). */
export const HOVER = { dark: "#FFFFFF14", light: "#00000014" } as const;

/** The selected row: VS Code's list.inactiveSelectionBackground is a wash of the foreground; this is twice the hover. */
export const SELECTED = { dark: "#FFFFFF24", light: "#00000018" } as const;

/** The theme colours a lane cycles through, as upstream's usePaint: a lane keeps one colour all the way down. */
export function laneColors(colors: { accent: string; statusWarning: string; statusSuccess: string; statusDanger: string; foregroundMuted: string }): string[] {
  return [colors.accent, colors.statusWarning, colors.statusSuccess, colors.statusDanger, colors.foregroundMuted];
}
