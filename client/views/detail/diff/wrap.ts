// Moved from upstream's paseo-source-control: client/wrap.ts; codeMetrics, numberWidth and lineColumns added so that the diff follows
// the code font size the host's preferences set instead of upstream's fixed 16 pixels.
//
// Where a line of code wraps, as VS Code's editor wraps it with word wrap on: into rows no wider than the text column,
// broken after a space or a closing mark, before an opening one, or between Chinese and Japanese characters, the rows
// after the first set in as far as the line is (editor.wrappingIndent "same"). Each row is drawn without wrapping, so
// a line is as tall as its rows, known before it is drawn.
//
// `wrap` is adapted from createLineBreaks in VS Code 1.142.0's src/vs/editor/common/viewModel/monospaceLineBreaksComputer.ts,
// leaving out the text VS Code injects into lines; `fullWidth` from isFullWidthCharacter in its src/vs/base/common/strings.ts.
// Copyright (c) Microsoft Corporation. Licensed under the MIT License: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt

/** How wide the code font draws a typical character and a full-width one, as VS Code reads them: 'n' and 'ｍ' (fontMeasurements.ts). */
export interface CharWidths {
  half: number;
  full: number;
}

/** A line cut into rows: where each row after the first starts, and how many columns those rows are set in. */
export interface Wrapped {
  breaks: number[];
  indent: number;
}

export const unwrapped: Wrapped = { breaks: [], indent: 0 };

export const TAB_SIZE = 4; // editor.tabSize (textModelDefaults.ts)

// editor.wordWrapBreakBeforeCharacters and editor.wordWrapBreakAfterCharacters (editorOptions.ts).
const BREAK_BEFORE = "([{‘“〈《「『【〔（［｛｢£¥＄￡￥+＋";
const BREAK_AFTER = " \t})]?|/&.,;¢°′″‰℃、。｡､￠，．：；？！％・･ゝゞヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻ｧｨｩｪｫｬｭｮｯｰ”〉》」』】〕）］｝｣";

const [NONE, BEFORE, AFTER, IDEOGRAPHIC] = [0, 1, 2, 3];
const CLASSES = new Map<number, number>();
for (const char of BREAK_BEFORE) CLASSES.set(char.charCodeAt(0), BEFORE);
for (const char of BREAK_AFTER) CLASSES.set(char.charCodeAt(0), AFTER);
const [TAB, SPACE] = [9, 32];

/** Han and Kana break between any two of them (WrappingCharacterClassifier). */
function classOf(code: number) {
  if (code >= 256 && ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff))) return IDEOGRAPHIC;
  return CLASSES.get(code) ?? NONE;
}

/** Chinese, Japanese and Korean characters, and the full-width forms. */
export function fullWidth(code: number) {
  return (code >= 0x2e80 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff01 && code <= 0xff5e) || (code >= 0xffe0 && code <= 0xffe6);
}

/** Kinsoku Shori: no break after an opening mark, nor before a closing one; never before a space. */
function canBreak(before: number, code: number, after: number) {
  return (
    code !== SPACE && ((before === AFTER && after !== AFTER) || (before !== BEFORE && after === BEFORE) || (before === IDEOGRAPHIC && after !== AFTER) || (after === IDEOGRAPHIC && before !== BEFORE))
  );
}

/**
 * The sizes the diff draws its code with, from the code font's size (prefs.codeFontSize). Upstream drew code at 16
 * pixels and fixed these for it: a line 1.5 times the font (as ui/theme.ts `code(size)` sets it), the + / − indicator
 * a font size wide, a folded region's bar at least 24 pixels tall, and about 0.6 of the size per digit of a line number.
 * The widths the text wraps at are measured (CharWidths), not derived from these.
 */
export function codeMetrics(fontSize: number) {
  const lineHeight = Math.round(fontSize * 1.5);
  return { fontSize, lineHeight, indicator: Math.round(fontSize), bar: Math.max(24, lineHeight), digit: fontSize * 0.6 };
}

/** How wide a column of line numbers is for a file of `lines` lines: room for the last one's digits, and 12 pixels. */
export function numberWidth(fontSize: number, lines: number) {
  return codeMetrics(fontSize).digit * String(Math.max(1, Math.floor(lines))).length + 12;
}

/** How many columns `text` takes unwrapped: tabs to their stops, full-width characters by `widths`, a surrogate pair as two. */
export function lineColumns(text: string, widths: CharWidths) {
  const fullColumns = widths.full / widths.half;
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isHighSurrogate(code)) {
      [at, i] = [at + 2, i + 1];
      continue;
    }
    at += columnsOf(code, at, fullColumns);
  }
  return at;
}

/** How many columns text `width` pixels wide holds: VS Code leaves two pixels for the cursor (EditorLayoutInfoComputer). */
export function wrapColumn(width: number, widths: CharWidths) {
  return Math.max(1, Math.floor((width - 2) / widths.half));
}

/** How many columns a character takes at column `at`: a tab reaches to the next tab stop from the line's start (computeCharWidth). */
function columnsOf(code: number, at: number, fullColumns: number) {
  return code === TAB ? TAB_SIZE - (at % TAB_SIZE) : fullWidth(code) || code < 32 ? fullColumns : 1;
}

/** How many columns each tab of `text` takes, by where it is; VS Code draws a wrapped row's tabs so too (startVisibleColumn). */
export function tabColumns(text: string, widths: CharWidths) {
  const fullColumns = widths.full / widths.half;
  const tabs = new Map<number, number>();
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isHighSurrogate(code)) {
      [at, i] = [at + 2, i + 1];
      continue;
    }
    if (code === TAB) tabs.set(i, columnsOf(code, at, fullColumns));
    at += columnsOf(code, at, fullColumns);
  }
  return tabs;
}

/** Where `text` wraps at `column` columns. */
export function wrap(text: string, column: number, widths: CharWidths): Wrapped {
  const length = text.length;
  if (length <= 1) return unwrapped;
  const fullColumns = widths.full / widths.half;
  const columns = (code: number, at: number) => columnsOf(code, at, fullColumns);
  const pixels = (code: number, at: number) => (code === TAB ? (TAB_SIZE - (at % TAB_SIZE)) * widths.half : fullWidth(code) || code < 32 ? widths.full : widths.half);

  // The rows after the first are set in as far as the line is, unless no character would fit after (computeWrappedTextIndentLength).
  let [indent, first] = [0, 0];
  for (; first < length && (text.charCodeAt(first) === SPACE || text.charCodeAt(first) === TAB); first++) indent += text.charCodeAt(first) === TAB ? TAB_SIZE - (indent % TAB_SIZE) : 1;
  if (first === length || indent + fullColumns > column) indent = 0;
  const wrappedWidth = (column - indent) * widths.half;

  const breaks: number[] = [];
  let [breakAt, breakWidth] = [0, 0]; // the last place a row may end, and how wide the row is up to it
  let rowWidth = column * widths.half;
  let previous = text.charCodeAt(0);
  let at = columns(previous, 0); // the column reached
  let width = pixels(previous, 0); // and the pixels
  let start = 1;
  if (isHighSurrogate(previous)) {
    // A surrogate pair is one character, never broken.
    at += 1;
    width += widths.half;
    previous = text.charCodeAt(1);
    start++;
  }
  let previousClass = classOf(previous);
  for (let i = start; i < length; i++) {
    const offset = i;
    const code = text.charCodeAt(i);
    let [codeClass, codeColumns, codePixels] = [NONE, 2, 2 * widths.half];
    if (isHighSurrogate(code)) i++;
    else [codeClass, codeColumns, codePixels] = [classOf(code), columns(code, at), pixels(code, at)];

    if (canBreak(previousClass, code, codeClass)) [breakAt, breakWidth] = [offset, width];
    at += codeColumns;
    width += codePixels;

    // Past the row's width: it ends where it last could, or, if that leaves too much for the next row, here.
    if (width > rowWidth) {
      if (breakAt === 0 || width - breakWidth > wrappedWidth) [breakAt, breakWidth] = [offset, width - codePixels];
      if (breakAt > (breaks.length ? breaks[breaks.length - 1] : 0)) {
        breaks.push(breakAt);
        rowWidth = breakWidth + wrappedWidth;
        breakAt = 0;
      }
    }
    previousClass = codeClass;
  }
  return breaks.length ? { breaks, indent } : unwrapped;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
