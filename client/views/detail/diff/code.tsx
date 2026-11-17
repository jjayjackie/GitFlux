// How the diff, the hunk view and the conflict view draw code: the code font measured as it is drawn, a line cut into
// the rows it wraps onto, its text in syntax colours over the changed stretches, and line numbers.
//
// Adapted from upstream's paseo-source-control: client/Diff.tsx (MeasureFont, Marked, LineNumber, WEB_ROW, WEB_TAB): the font size
// now follows prefs.codeFontSize (ui/theme.ts `code(size)`) instead of a fixed 16 pixels, and each stretch is drawn in
// its syntax colour (./tokens.ts) as well as its change colour.

import { useRef } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import type { TextStyle } from "react-native";
import type { TokenLine } from "../../../../shared/schemas.ts";
import { T } from "../../../ui/Text.tsx";
import { useTheme } from "../../../ui/theme.ts";
import type { Marks } from "./diffRows.ts";
import { styledRuns } from "./tokens.ts";
import { tabColumns, unwrapped, wrap, wrapColumn } from "./wrap.ts";
import type { CharWidths } from "./wrap.ts";

/**
 * The code font as it is drawn: how wide its characters are, how tall a row of it is, and the size it was measured at.
 * Both are measured: off the web the system's text size scales them (allowFontScaling).
 */
export interface Font {
  widths: CharWidths;
  row: number;
  size: number;
}

/** Whether a measurement can be drawn with: said, not drawn as nothing, when it cannot. */
export const fontUsable = (font: Font) => font.row > 0 && font.widths.half > 0 && font.widths.full > 0;

/**
 * A line as it is drawn: where each row after the first starts, how many columns those rows are set in, how many
 * columns each tab takes by where it is, and how wide a column is.
 */
export interface Cut {
  breaks: number[];
  indent: number;
  tabs: Map<number, number>;
  column: number;
}

const noTabs = new Map<number, number>();

/** `text` cut to fit `room` pixels when `wrapped`, else on one row. */
export function cutLine(text: string, room: number, widths: CharWidths, wrapped: boolean): Cut {
  return {
    ...(wrapped ? wrap(text, wrapColumn(room, widths), widths) : unwrapped),
    tabs: text.includes("\t") ? tabColumns(text, widths) : noTabs,
    column: widths.half,
  };
}

/** The cut of a side with no line. */
export const emptyCut = (widths: CharWidths): Cut => ({ breaks: [], indent: 0, tabs: noTabs, column: widths.half });

/**
 * Measures the code font, out of sight. How wide it draws its characters, as VS Code measures them (fontMeasurements.ts):
 * 'n', a typical character, and 'ｍ', a full-width one, from a thousand of each in a row; and how tall the row is.
 * Mount it keyed by the size, so that a new size is measured afresh.
 */
export function MeasureFont({ code, size, onMeasured }: { code: TextStyle; size: number; onMeasured: (font: Font) => void }) {
  const read = useRef<Partial<CharWidths> & { row?: number }>({}).current;
  const sample = (character: string, kind: keyof CharWidths) => (
    <Text
      style={[code, { alignSelf: "flex-start" }]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        read[kind] = width / 1000;
        read.row = Math.max(read.row ?? 0, height);
        if (read.half && read.full) onMeasured({ widths: { half: read.half, full: read.full }, row: read.row, size });
      }}
    >
      {character.repeat(1000)}
    </Text>
  );
  return (
    <View pointerEvents="none" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      {/* Sized itself: off the web, a box sized by the empty one around it gives its texts no height. */}
      <View style={{ width: 100000, height: 1000 }}>
        {sample(HALF_SAMPLE, "half")}
        {sample(FULL_SAMPLE, "full")}
      </View>
    </View>
  );
}

const HALF_SAMPLE = "n";
const FULL_SAMPLE = "ｍ";
const TAB = "\t";
const SPACE = " ";

/**
 * A row of a wrapped line on the web. It names the code font, as a changed stretch does, and sits at the top of its
 * line, so that the line is as tall as one row.
 */
const WEB_ROW = { display: "inline-block", width: "100%", whiteSpace: "pre", verticalAlign: "top" } as object as TextStyle;
/** A tab on the web, in a box as wide as it is drawn. */
const WEB_TAB = { display: "inline-block", overflow: "hidden", verticalAlign: "top" } as object as TextStyle;

export interface MarkedProps {
  text: string;
  /** The line's syntax tokens; none: drawn in the foreground. */
  tokens?: TokenLine;
  /** The changed stretches, drawn over `colour`. */
  marks: Marks;
  colour: string;
  cut: Cut;
  code: TextStyle;
  selectable?: boolean;
}

/**
 * A line's text in the rows it wraps onto, each stretch in its syntax colour and its changed stretches over `colour`.
 * VS Code colours a changed stretch the full height of its line (decorations.css: `.cdr` is `height: 100%`); a stretch
 * of text is coloured only as tall as its font, about 1.17 times its size for Menlo, so it is padded out to the line. A
 * stretch names the code font again: once an interface font is set, Paseo gives every element outside its own code
 * views that font (apply-root-font.web.ts), and the stretch would take it instead of the line's.
 */
export function Marked({ text, tokens, marks, colour, cut, code, selectable = true }: MarkedProps) {
  const th = useTheme();
  const web = th.platform === "web";
  const size = code.fontSize ?? 13;
  const fill = ((typeof code.lineHeight === "number" ? code.lineHeight : size * 1.5) - size * 1.17) / 2;
  // A tab is drawn as wide as the line was wrapped with it: to the next tab stop from the start of the line, not of its
  // row. On the web it stays a tab, in a box that wide, so that it is copied as one; off the web it is spaces.
  const tabbed = (from: number, to: number) => {
    const parts: ReactNode[] = [];
    let at = from;
    for (let tab = text.indexOf(TAB, from); tab !== -1 && tab < to; tab = text.indexOf(TAB, tab + 1)) {
      if (tab > at) parts.push(text.slice(at, tab));
      const columns = cut.tabs.get(tab) ?? 1;
      parts.push(
        web ? (
          <Text key={`tab${tab}`} style={[WEB_TAB, { width: columns * cut.column }]}>
            {TAB}
          </Text>
        ) : (
          SPACE.repeat(Math.round(columns))
        ),
      );
      at = tab + 1;
    }
    if (at < to) parts.push(text.slice(at, to));
    return parts;
  };
  const styled = (from: number, to: number): ReactNode => {
    const runs = styledRuns(text, tokens, marks, from, to);
    if (runs.length === 0) return SPACE;
    return runs.map((run) => {
      const color = th.syntax[run.scope] ?? undefined;
      return (
        <Text
          key={run.start}
          style={[{ fontFamily: code.fontFamily }, color !== undefined && { color }, run.marked && colour !== "" && { backgroundColor: colour, paddingVertical: fill }]}
        >
          {tabbed(run.start, run.end)}
        </Text>
      );
    });
  };
  const rows = [0, ...cut.breaks].map((from, n) => [from, cut.breaks[n] ?? text.length]);
  const pad = cut.indent * cut.column;
  // On the web the rows are boxes in one text, each as wide as it: the line breaks between them only, and is selected
  // and copied whole, as a wrapped line is in VS Code. Off the web each row is a text of its own.
  if (web)
    return (
      <T selectable={selectable} style={[code, { flex: 1, minWidth: 0, overflow: "hidden" }]}>
        {rows.map(([from, to], n) => (
          <Text key={from} style={[WEB_ROW, { fontFamily: code.fontFamily }, n > 0 && { paddingLeft: pad }]}>
            {styled(from, to)}
          </Text>
        ))}
      </T>
    );
  return (
    <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
      {rows.map(([from, to], n) => (
        <T key={from} selectable={selectable} lines={1} style={[code, n > 0 && { paddingLeft: pad }]}>
          {styled(from, to)}
        </T>
      ))}
    </View>
  );
}

/** A line's number. Like the rest of the gutter, it is not selected or copied with the text, as VS Code's margin is not. */
export function LineNumber({ value, width, code }: { value: number | null | undefined; width: number; code: TextStyle }) {
  const th = useTheme();
  const label = value === null || value === undefined ? "" : String(value);
  return (
    <T selectable={false} color={th.c.foregroundMuted} style={[code, { width, paddingRight: 8, textAlign: "right" }]}>
      {label}
    </T>
  );
}
