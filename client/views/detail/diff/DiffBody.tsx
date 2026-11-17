// The body of a diff: one file before and after, as VS Code's diff editor shows it. Lines removed and added are
// coloured, and within them the words that changed, over the syntax colours the daemon sent; the two versions face each
// other side by side, or the removed lines stand above the added ones inline. Unchanged regions fold, an overview ruler
// beside the lines is their scrollbar, and long lines wrap before they are drawn, so that every row's height is known
// and only the rows in view are drawn, however long the file.
//
// Adapted from upstream's paseo-source-control: client/Diff.tsx (Lines, HiddenLines, Edge, InlineLine, PairLine, Filler and their
// helpers), onto the kit, the translations and the host's preferences: the code size follows prefs.codeFontSize,
// wrapping can be turned off (the rows then scroll sideways together), syntax colours are layered in (./tokens.ts),
// and the parent can step from change to change (`navigator`, `onPosition`). VS Code's behaviour it copies is named
// where it is used. Copyright (c) Microsoft Corporation for what is VS Code's: https://github.com/microsoft/vscode/blob/1.142.0/LICENSE.txt

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { FlatList, PanResponder, Pressable, ScrollView, View } from "react-native";
import type { CellRendererProps, PressableStateCallbackType, TextStyle, ViewStyle } from "react-native";
import type { FileDiff } from "../../../../shared/rpc/diff.ts";
import type { TokenLine, Tokens } from "../../../../shared/schemas.ts";
import { useT } from "../../../i18n/messages.ts";
import * as codicon from "../../../ui/codicons.ts";
import { useHint } from "../../../ui/floating/Tooltip.tsx";
import { Glyph } from "../../../ui/Glyph.tsx";
import { T } from "../../../ui/Text.tsx";
import { useTheme } from "../../../ui/theme.ts";
import { clearTextSelection, webStyle } from "../../../web.ts";
import { cutLine, emptyCut, fontUsable, LineNumber, Marked, MeasureFont } from "./code.tsx";
import type { Cut, Font } from "./code.tsx";
import { inlineRows, pairRows } from "./diffRows.ts";
import type { Cell, InlineRow, PairRow } from "./diffRows.ts";
import { changeSpans, WIDTH } from "./overview.ts";
import { OverviewRuler } from "./OverviewRuler.tsx";
import type { Measures } from "./OverviewRuler.tsx";
import { tokensOf } from "./tokens.ts";
import { dragged, fold, folded, regions, reveal } from "./unchanged.ts";
import type { Hidden, Region, Revealed, Shown } from "./unchanged.ts";
import { codeMetrics, lineColumns, numberWidth } from "./wrap.ts";

/** What the body draws: a diff, or one side of a file (added, deleted, untracked) as itself. */
export type Found = Exclude<FileDiff, { kind: "binary" } | { kind: "too-large" }>;

/** How the parent steps through the changes. */
export interface DiffNavigator {
  /** Scrolls to the next (1) or previous (-1) change. */
  go(delta: 1 | -1): void;
}

export interface DiffBodyProps {
  found: Found;
  sideBySide: boolean;
  /** Fold unchanged regions (diffEditor.hideUnchangedRegions). */
  collapse: boolean;
  /** Wrap long lines; off, the rows scroll sideways together. */
  wrap: boolean;
  /** The code font's size (prefs.codeFontSize). */
  fontSize: number;
  /** Filled with the way to step through the changes. */
  navigator?: MutableRefObject<DiffNavigator | null>;
  /** Told which change is at the top of the view (from 1; 0 before the first) and how many there are. */
  onPosition?: (current: number, total: number) => void;
  testID?: string;
}

/** The most pixels unwrapped rows are drawn across: a minified file's one line would be wider than any view needs. */
const MAX_UNWRAPPED_WIDTH = 200_000;

type Row = InlineRow | PairRow;
type FileRow = { file: string; number: number };
type Item = FileRow | Row | Revealed<Row> | Hidden;

/** The modified version's line of a row the same in both versions; null for a changed one. */
const sameLine = (row: Row) => ("kind" in row ? (row.kind === "same" ? row.modified : null) : row.changed ? null : row.right!.number);
const removedRow = (item: Item) => ("kind" in item ? item.kind === "remove" : "changed" in item && item.changed && item.left !== null);
const addedRow = (item: Item) => ("kind" in item ? item.kind === "add" : "changed" in item && item.changed && item.right !== null);
const changedRow = (item: Item) => ("kind" in item ? item.kind !== "same" : "changed" in item && item.changed);
const keyOf = (item: Item) =>
  "file" in item ? `f${item.number}` : "hidden" in item ? `h${item.hidden}` : "kind" in item ? `${item.kind}${item.original}:${item.modified}` : `${item.left?.number}:${item.right?.number}`;
const regionKey = ({ original, modified, length }: Region) => `${original}:${modified}:${length}`;

/** The lines, opened at the first change; unchanged ones folded while `collapse` is on; the overview ruler beside them. */
export function DiffBody({ found, sideBySide, collapse, wrap, fontSize, navigator, onPosition, testID }: DiffBodyProps) {
  const th = useTheme();
  const { t } = useT();
  const { compact, platform } = th;
  const code = useMemo(() => th.code(fontSize), [th, fontSize]);
  const metrics = codeMetrics(fontSize);
  const colours = th.diff;
  const list = useRef<FlatList<Item>>(null);
  const rows: (FileRow | Row)[] = useMemo(
    () => (found.kind === "file" ? found.lines.map((line, n) => ({ file: line, number: n + 1 })) : sideBySide ? pairRows(found) : inlineRows(found)),
    [found, sideBySide],
  );
  const unchanged = useMemo(() => (found.kind === "diff" ? regions(found.changes, found.original.length, found.modified.length) : []), [found]);
  // How much of each region shows, by where it is. Turning the switch on folds them all again, as in VS Code.
  const [opened, setOpened] = useState(new Map<string, Shown>());
  // On the web, the version a selection was last started in (see Side). A press in the other first clears the selection:
  // in the page it also holds the rows of this version between its ends, and a press on one of them would drag the
  // selection instead of starting a new one.
  const [side, setSide] = useState<Side | null>(null);
  const selecting: Selecting = {
    side,
    start: (next) => {
      if (platform !== "web" || next === side) return;
      clearTextSelection();
      setSide(next);
    },
  };
  // The box the list and the ruler share. The diff scrolls on past its last line until only that line is left in view,
  // as VS Code's editors do by default (editor.scrollBeyondLastLine; viewLayout.ts). A region's bottom edge can then move
  // its bar up however short the diff.
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [measured, setFont] = useState<Font | null>(null);
  const font = measured !== null && measured.size === fontSize ? measured : null; // measured afresh for a new size
  const unmeasured = font !== null && !fontUsable(font); // said, not drawn as nothing
  const rowHeight = font?.row ?? 0; // known before anything below is drawn
  const after = Math.max(0, frame.height - rowHeight);
  useEffect(() => setOpened(new Map()), [collapse]);
  const items: Item[] = useMemo(
    () =>
      collapse && found.kind === "diff"
        ? fold(
            rows as Row[],
            sameLine,
            unchanged,
            unchanged.map((region) => opened.get(regionKey(region)) ?? folded),
          )
        : rows,
    [rows, collapse, found.kind, unchanged, opened],
  );
  // A region's bottom edge brings lines back under its bar with the lines after the region kept in place, as VS Code's
  // does (_runWithLowerScrollAnchor): what is above moves up instead. `below` is how many showed there before.
  const anchor = useRef<{ region: Region; below: number } | null>(null);
  const open = (index: number, change: (region: Region, shown: Shown) => Shown, anchored = false) => {
    const region = unchanged[index];
    if (anchored) anchor.current ??= { region, below: (opened.get(regionKey(region)) ?? folded).bottom };
    setOpened((before) => {
      const was = before.get(regionKey(region)) ?? folded;
      const next = change(region, was);
      return next.top === was.top && next.bottom === was.bottom ? before : new Map(before).set(regionKey(region), next);
    });
  };
  const first = items.findIndex(changedRow);
  // Once, when the diff first shows (it is read again every few seconds, and the reader may have scrolled since), it
  // opens at the first change.
  const [start] = useState(() => Math.max(0, first - 3));
  const lines = found.kind === "file" ? found.lines.length : Math.max(found.original.length, found.modified.length);
  const digits = numberWidth(fontSize, lines); // a column wide enough for the last line's number
  const indicator = metrics.indicator;
  // VS Code draws the ruler beside every diff; a phone has no room for it.
  const ruler = found.kind === "diff" && !compact;

  const tokens = found.kind === "diff" ? found.tokens : undefined;
  const fileTokens = found.kind === "file" ? found.tokens : undefined;

  // Where every line wraps, worked out before any is drawn, as VS Code works it out: every row's height is then known,
  // so the list opens at the first change at once and the ruler is to scale. Worked out for each line, not again as
  // regions open and fold; a folded region's row is the one row not among them. Unwrapped, every line is one row, and
  // the rows are as wide as the longest line needs.
  const shapes = useMemo(() => {
    if (!font || unmeasured || !frame.width) return null;
    const { widths } = font;
    const width = frame.width - (ruler ? WIDTH : 0);
    const half = (width - 1) / 2 - digits - indicator;
    const cut = (text: string, room: number): Cut => cutLine(text, room, widths, wrap);
    const none = emptyCut(widths);
    let longest = 0;
    const shaped = new Map<string, { cuts: Cut[]; height: number }>(
      rows.map((row): [string, { cuts: Cut[]; height: number }] => {
        if (!wrap) {
          const texts = "file" in row ? [row.file] : "kind" in row ? [row.text] : [row.left?.text ?? "", row.right?.text ?? ""];
          for (const text of texts) longest = Math.max(longest, lineColumns(text, widths));
        }
        const cuts =
          "file" in row
            ? [cut(row.file, width - digits)]
            : "kind" in row
              ? [cut(row.text, width - digits * 2 - indicator)]
              : [row.left ? cut(row.left.text, half) : none, row.right ? cut(row.right.text, half) : none];
        return [keyOf(row), { cuts, height: font.row * Math.max(...cuts.map((each) => each.breaks.length + 1)) }];
      }),
    );
    // How wide the rows are drawn: the view's width, or, unwrapped, as wide as the longest line needs.
    const text = longest * widths.half + 4;
    const needed = found.kind === "file" ? digits + text : sideBySide ? 2 * (digits + indicator + text) + 1 : digits * 2 + indicator + text;
    const across = wrap ? width : Math.min(MAX_UNWRAPPED_WIDTH, Math.max(width, needed));
    return { shaped, across };
  }, [rows, font, frame.width, ruler, digits, indicator, wrap, sideBySide, found.kind]);
  const height = (item: Item) => shapes?.shaped.get(keyOf(item))?.height ?? metrics.bar;
  // Where each row starts, and, last, where the last ends: told to the list and to the ruler.
  const starts = useMemo(() => {
    const starts = new Float64Array(items.length + 1);
    items.forEach((item, index) => (starts[index + 1] = starts[index] + height(item)));
    return starts;
  }, [items, shapes, metrics.bar]);
  const spans = useMemo(() => changeSpans(items, removedRow, addedRow), [items]);
  // The first row of each change: where stepping from change to change goes.
  const changeStarts = useMemo(() => {
    const firsts: number[] = [];
    items.forEach((item, index) => {
      if (changedRow(item) && (index === 0 || !changedRow(items[index - 1]))) firsts.push(index);
    });
    return firsts;
  }, [items]);
  const measures = useRef<Measures>({ view: 0, scrolled: 0 }).current;
  // The list is scrolled to the first change before it is first drawn: on its own it scrolls to its initial row only once
  // laid out, a frame later. The ruler, drawn with it, is told at once.
  const ready = shapes !== null;
  const placed = useRef(false);
  if (ready && !placed.current) {
    placed.current = true;
    measures.scrolled = starts[start];
  }
  useLayoutEffect(() => {
    if (ready) list.current?.scrollToOffset({ offset: starts[start], animated: false });
  }, [ready]);
  const scrollTo = useCallback((offset: number) => {
    const target = Math.max(0, offset);
    measures.scrolled = target;
    list.current?.scrollToOffset({ offset: target, animated: false });
  }, []);
  const scrollBy = (delta: number) => {
    measures.scrolled += delta; // at once: the next move may come before the scroll is told
    list.current?.scrollToOffset({ offset: measures.scrolled, animated: false });
  };

  // Stepping from change to change: a change counts as reached once its first row is within three rows of the top, and
  // is brought there with those three rows of context above it.
  const context = rowHeight * 3;
  const live = useRef({ starts, changeStarts, context, onPosition });
  live.current = { starts, changeStarts, context, onPosition };
  const report = useCallback(() => {
    const { starts: at, changeStarts: changes, context: room, onPosition: tell } = live.current;
    if (!tell) return;
    let current = 0;
    while (current < changes.length && at[changes[current]] <= measures.scrolled + room + 1) current++;
    tell(current, changes.length);
  }, []);
  useEffect(() => {
    if (ready) report();
  }, [ready, changeStarts, report]);
  useEffect(() => {
    if (!navigator) return;
    navigator.current = {
      go: (delta) => {
        const { starts: at, changeStarts: changes, context: room } = live.current;
        const top = measures.scrolled + room;
        const target = delta > 0 ? changes.find((index) => at[index] > top + 1) : [...changes].reverse().find((index) => at[index] < top - 1);
        if (target === undefined) return;
        scrollTo(at[target] - room);
        report();
      },
    };
    return () => {
      navigator.current = null;
    };
  }, [navigator, scrollTo, report]);

  // How tall a region's line is drawn, under keyOf's key for a row the same in both versions.
  const lineKey = (region: Region, line: number) => `${sideBySide ? "" : "same"}${region.original + line}:${region.modified + line}`;
  const lineHeight = (region: Region) => (line: number) => shapes?.shaped.get(lineKey(region, line))?.height ?? rowHeight;
  useLayoutEffect(() => {
    if (!anchor.current) return;
    const { region, below } = anchor.current;
    anchor.current = null;
    const now = (opened.get(regionKey(region)) ?? folded).bottom;
    let delta = 0;
    for (let n = Math.min(below, now); n < Math.max(below, now); n++) delta += lineHeight(region)(region.length - 1 - n);
    scrollBy(now > below ? delta : -delta);
  }, [opened]);

  const draw = (item: Item) => {
    if ("hidden" in item) {
      const region = unchanged[item.hidden];
      const shown = opened.get(regionKey(region)) ?? folded;
      return (
        <HiddenLines
          lines={item.lines}
          region={region}
          shown={shown}
          height={lineHeight(region)}
          bar={metrics.bar}
          gutter={sideBySide ? digits + indicator : digits * 2 + indicator}
          halves={sideBySide ? 2 : 1}
          open={(change, anchored) => open(item.hidden, change, anchored)}
        />
      );
    }
    const { cuts } = shapes!.shaped.get(keyOf(item))!;
    const common = { width: digits, indicator, code };
    if ("file" in item) return <FileLine {...common} number={item.number} text={item.file} tokens={tokensOf(fileTokens, item.number)} cut={cuts[0]} />;
    const revealed = "region" in item;
    const onFold = revealed && item.first ? () => open(item.region, () => folded) : undefined;
    return "kind" in item ? (
      <InlineLine {...common} row={item} tokens={tokens} revealed={revealed} onFold={onFold} selecting={selecting} cut={cuts[0]} />
    ) : (
      <PairLine {...common} row={item} tokens={tokens} revealed={revealed} onFold={onFold} selecting={selecting} cuts={cuts} />
    );
  };
  const listed = shapes && (
    <FlatList
      ref={list}
      style={{ flex: 1 }}
      data={items}
      keyExtractor={keyOf}
      getItemLayout={(_, index) => ({ length: starts[index + 1] - starts[index], offset: starts[index], index })}
      initialScrollIndex={Math.min(start, Math.max(0, items.length - 1))}
      initialNumToRender={Math.max(1, Math.ceil(frame.height / Math.max(1, rowHeight)))} // enough to fill the view, however short the rows
      // Beside the ruler, its slider is the diff's scrollbar, and the text has the list's whole width to wrap in.
      showsVerticalScrollIndicator={!ruler}
      // The room past the last line, which the ruler adds to the rows.
      ListFooterComponent={<View style={{ height: after }} />}
      scrollEventThrottle={16}
      onScroll={(event) => {
        measures.scrolled = event.nativeEvent.contentOffset.y;
        measures.changed?.();
        report();
      }}
      CellRendererComponent={CellBox}
      renderItem={({ item, index }) => <View style={{ height: starts[index + 1] - starts[index] }}>{draw(item)}</View>}
      testID={testID ? `${testID}-lines` : undefined}
    />
  );
  return (
    <>
      {unmeasured && (
        <T tone="danger" size={th.small + 1} style={{ padding: th.space.md }}>
          {t("diff.fontUnmeasured", { detail: JSON.stringify(font) })}
        </T>
      )}
      <View
        testID={testID}
        style={{ flex: 1, minHeight: 0, flexDirection: "row" }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (!width) return; // hidden with its tab: the diff keeps the size it had, and its place in it
          measures.view = height;
          setFrame({ width, height });
          measures.changed?.();
        }}
      >
        {!font && <MeasureFont key={fontSize} code={code} size={fontSize} onMeasured={setFont} />}
        {shapes &&
          (wrap || shapes.across <= frame.width - (ruler ? WIDTH : 0) ? (
            listed
          ) : (
            <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width: shapes.across }} showsHorizontalScrollIndicator>
              <View style={{ width: shapes.across, height: frame.height }}>{listed}</View>
            </ScrollView>
          ))}
        {shapes && ruler && (
          <OverviewRuler
            starts={starts}
            after={after}
            spans={spans}
            measures={measures}
            colours={colours.ruler}
            scrollTo={scrollTo}
            label={t("diff.ruler")}
            testID={testID ? `${testID}-ruler` : undefined}
          />
        )}
      </View>
    </>
  );
}

/** A row of the list; a folded region's is drawn over the row below, which the region's bottom edge reaches into. */
function CellBox({ item, style, ...props }: CellRendererProps<Item>) {
  return <View {...props} style={[style, "hidden" in item && { zIndex: 1 }]} />;
}

/**
 * An icon drawn again only when what it shows changes. Inline SVG drawn again is a new element, and a press that ends on
 * another element than it began on is no click: a button whose icon is drawn again as it is pressed would not work.
 */
const StableGlyph = memo(Glyph);

/**
 * A folded region, drawn as VS Code draws it across each version: an icon that opens it all, how many lines it hides,
 * which a double click also opens, and edges that, clicked, bring back 20 lines next to them, or, dragged, as many as
 * the pointer passes (hideUnchangedRegionsFeature.ts: CollapsedCodeOverlayWidget).
 */
function HiddenLines({
  lines,
  region,
  shown,
  height,
  bar,
  gutter,
  halves,
  open,
}: {
  lines: number;
  region: Region;
  shown: Shown;
  height: (line: number) => number;
  bar: number;
  gutter: number;
  halves: number;
  open: (change: (region: Region, shown: Shown) => Shown, anchored?: boolean) => void;
}) {
  const th = useTheme();
  const { t } = useT();
  const { c } = th;
  const all = () => open(reveal.all);
  const half = (index: number) => (
    <View
      key={index}
      style={
        {
          flex: 1,
          height: bar,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: c.surface1,
          boxShadow: `inset 0 -5px 5px -7px ${th.diff.shadow}, inset 0 5px 5px -7px ${th.diff.shadow}`,
        } as ViewStyle
      }
    >
      <View style={{ width: gutter, alignItems: "center" }}>
        <BarButton hint={t("diff.showUnchanged")} onPress={all} testID={index === 0 ? "ag-diff-unfold" : undefined}>
          {(hovered) => (
            // In the link colour under the pointer (style.css). Both colours stay drawn, the one shown changes: an icon
            // drawn again as the pointer comes onto it could be a new element by the time it is pressed.
            <View>
              <StableGlyph icon={codicon.unfold} size={16} color={c.foreground} />
              <View style={{ position: "absolute", top: 0, left: 0, opacity: hovered ? 1 : 0 }}>
                <StableGlyph icon={codicon.unfold} size={16} color={c.accent} />
              </View>
            </View>
          )}
        </BarButton>
      </View>
      <DoublePress hint={t("diff.doubleClickToUnfold")} onDouble={all}>
        <T size={th.text} color={c.foreground} lines={1}>
          {t("diff.hiddenLines", { count: lines })}
        </T>
      </DoublePress>
      <Edge edge="top" region={region} shown={shown} height={height} open={open} />
      <Edge edge="bottom" region={region} shown={shown} height={height} open={open} />
    </View>
  );
  return (
    <View style={{ flexDirection: "row" }}>
      {half(0)}
      {halves === 2 && <View style={{ width: 1, backgroundColor: c.border }} />}
      {halves === 2 && half(1)}
    </View>
  );
}

function BarButton({ hint, onPress, children, testID }: { hint: string; onPress: () => void; children: (hovered: boolean) => ReactNode; testID?: string }) {
  return (
    <Pressable {...useHint(hint)} accessibilityRole="button" accessibilityLabel={hint} onPress={onPress} testID={testID}>
      {(state: PressableStateCallbackType) => children(!!(state as { hovered?: boolean }).hovered)}
    </Pressable>
  );
}

/** Text that does something when pressed twice in a row, as VS Code's double click. */
function DoublePress({ hint, onDouble, children }: { hint: string; onDouble: () => void; children: ReactNode }) {
  const last = useRef(0);
  const press = () => {
    const now = Date.now();
    if (now - last.current < 500) onDouble();
    last.current = now;
  };
  return (
    <Pressable {...useHint(hint)} accessibilityRole="button" accessibilityLabel={hint} onPress={press} style={{ flexShrink: 1, minWidth: 0 }}>
      {children}
    </Pressable>
  );
}

/**
 * A folded region's top or bottom edge, as VS Code's (style.css): 10 pixels to grab across the bar's border, 6 of them
 * on the side the lines come from, lit 4 pixels across it under the pointer and while dragged, its cursor saying which
 * ways it can go. The top edge brings lines back above the bar, which moves down with the pointer; the bottom edge
 * brings them back below it, and the diff scrolls so that the bar moves up with the pointer.
 */
function Edge({
  edge,
  region,
  shown,
  height,
  open,
}: {
  edge: "top" | "bottom";
  region: Region;
  shown: Shown;
  height: (line: number) => number;
  open: (change: (region: Region, shown: Shown) => Shown, anchored?: boolean) => void;
}) {
  const th = useTheme();
  const { t } = useT();
  const words = edge === "top" ? t("diff.showMoreAbove") : t("diff.showMoreBelow");
  const hint = useHint(words);
  const [lit, setLit] = useState(false);
  const [dragging, setDragging] = useState(false);
  const live = useRef({ region, shown, height, open });
  live.current = { region, shown, height, open };
  const responder = useMemo(() => {
    let from = 0;
    let moved = false;
    const change = (next: (region: Region, shown: Shown) => Shown) => live.current.open(next, edge === "bottom");
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        hint.onPressIn();
        from = live.current.shown[edge];
        moved = false;
        setDragging(true);
      },
      onPanResponderMove: (_, gesture) => {
        moved ||= Math.abs(gesture.dy) > 2;
        const count = dragged(live.current.region, edge, from, gesture.dy, live.current.height);
        change((region, shown) => reveal.to(region, shown, edge, count));
      },
      onPanResponderRelease: () => {
        setDragging(false);
        if (!moved) change(edge === "top" ? reveal.above : reveal.below);
      },
      onPanResponderTerminate: () => setDragging(false),
    });
  }, [edge]);
  const back = shown[edge] > 0;
  const cursor = edge === "top" ? (back ? "ns-resize" : "s-resize") : back ? "ns-resize" : "n-resize";
  return (
    <View
      ref={hint.ref}
      accessibilityRole="adjustable"
      accessibilityLabel={words}
      {...responder.panHandlers}
      {...({ onPointerEnter: () => (setLit(true), hint.onHoverIn()), onPointerLeave: () => (setLit(false), hint.onHoverOut()) } as object)}
      style={[{ position: "absolute", left: 0, right: 0, height: 10 }, edge === "top" ? { top: -6 } : { bottom: -4 }, webStyle({ cursor })]}
    >
      <View style={{ marginTop: 4, height: 4, backgroundColor: lit || dragging ? th.c.accent : undefined }} />
    </View>
  );
}

/**
 * VS Code's + and − beside a changed line (diffEditor.renderIndicators). Beside the first line of a region opened in
 * full, the icon that folds it again, as VS Code puts it in the margin.
 */
function Indicator({ kind, onFold, width, code }: { kind: "same" | "remove" | "add"; onFold?: () => void; width: number; code: TextStyle }) {
  const th = useTheme();
  const { t } = useT();
  if (onFold)
    return (
      <View style={{ width, height: code.lineHeight, justifyContent: "center" }}>
        <BarButton hint={t("diff.foldUnchanged")} onPress={onFold}>
          {() => <StableGlyph icon={codicon.fold} size={Math.min(16, width)} color={th.c.foregroundMuted} />}
        </BarButton>
      </View>
    );
  const sign = kind === "add" ? PLUS : kind === "remove" ? MINUS : SPACE;
  return (
    <T selectable={false} color={th.c.foregroundMuted} style={[code, { width }]}>
      {sign}
    </T>
  );
}

const PLUS = "+";
const MINUS = "−";
const SPACE = " ";

interface Common {
  /** The width of a line-number column, and of the + / − indicator. */
  width: number;
  indicator: number;
  code: TextStyle;
}

function FileLine({ number, text, tokens, width, code, cut }: Common & { number: number; text: string; tokens?: TokenLine; cut: Cut }) {
  return (
    <View style={{ flexDirection: "row" }}>
      <LineNumber value={number} width={width} code={code} />
      <Marked text={text} tokens={tokens} marks={NO_MARKS} colour="" cut={cut} code={code} />
    </View>
  );
}

const NO_MARKS: [number, number][] = [];

/**
 * A version of the file, as a selection keeps to it. VS Code shows each version in an editor of its own side by side
 * (diffEditorEditors.ts: `original` and `modified`), and inline draws the removed lines apart from the modified's, in a
 * view zone of their own (diffEditorViewZones.ts: `line-delete-selectable`), so a selection begun in one version leaves
 * the other out. Here the lines of the other version cannot be selected until a press starts a selection in it.
 */
type Side = "original" | "modified";

/** The version a selection was last started in, null before any; `start` is called by a press in a version. */
interface Selecting {
  side: Side | null;
  start: (side: Side) => void;
}

interface LineProps extends Common {
  tokens: { original: Tokens; modified: Tokens } | undefined;
  revealed: boolean; // shown from a folded region
  onFold?: () => void;
  selecting: Selecting;
}

/** A line of the inline view, numbered in the original and in the modified version, as VS Code numbers them. */
function InlineLine({ row, tokens, width, indicator, code, revealed, onFold, selecting, cut }: LineProps & { row: InlineRow; cut: Cut }) {
  const th = useTheme();
  const colours = th.diff;
  const removed = row.kind === "remove";
  const side: Side = removed ? "original" : "modified";
  const syntax = removed ? tokensOf(tokens?.original, row.original) : tokensOf(tokens?.modified, row.modified);
  return (
    <View
      style={{ flexDirection: "row", backgroundColor: row.kind === "add" ? colours.insertedLine : removed ? colours.removedLine : revealed ? colours.unchanged : undefined }}
      {...({ onPointerDown: () => selecting.start(side) } as object)}
    >
      <LineNumber value={row.original} width={width} code={code} />
      <LineNumber value={row.modified} width={width} code={code} />
      <Indicator kind={row.kind} onFold={onFold} width={indicator} code={code} />
      <Marked
        text={row.text}
        tokens={syntax}
        marks={row.marks}
        colour={removed ? colours.removedText : colours.insertedText}
        cut={cut}
        code={code}
        selectable={selecting.side === null || selecting.side === side}
      />
    </View>
  );
}

/**
 * A row of the side-by-side view: the original on the left, the modified on the right. In a change, a side with no
 * line, or with a line that wraps onto fewer rows than the other's, is filled out below it.
 */
function PairLine({ row, tokens, width, indicator, code, revealed, onFold, selecting, cuts }: LineProps & { row: PairRow; cuts: Cut[] }) {
  const th = useTheme();
  const colours = th.diff;
  const half = (cell: Cell | null, side: Side, cut: Cut) => {
    const kind = side === "original" ? "remove" : "add";
    const syntax = cell ? tokensOf(side === "original" ? tokens?.original : tokens?.modified, cell.number) : undefined;
    return (
      <View style={{ flex: 1 }} {...({ onPointerDown: () => selecting.start(side) } as object)}>
        {cell && (
          <View style={{ flexDirection: "row", backgroundColor: row.changed ? (kind === "add" ? colours.insertedLine : colours.removedLine) : revealed ? colours.unchanged : undefined }}>
            <LineNumber value={cell.number} width={width} code={code} />
            <Indicator kind={row.changed ? kind : "same"} onFold={onFold} width={indicator} code={code} />
            <Marked
              text={cell.text}
              tokens={syntax}
              marks={cell.marks}
              colour={kind === "add" ? colours.insertedText : colours.removedText}
              cut={cut}
              code={code}
              selectable={selecting.side === null || selecting.side === side}
            />
          </View>
        )}
        {row.changed && <Filler gutter={width + indicator} />}
      </View>
    );
  };
  return (
    <View style={{ flexDirection: "row" }}>
      {half(row.left, "original", cuts[0])}
      <View style={{ width: 1, backgroundColor: th.c.border }} />
      {half(row.right, "modified", cuts[1])}
    </View>
  );
}

/**
 * Where a side of a change has nothing to show: VS Code's diagonal fill (style.css: `.diagonal-fill`, in the colour
 * diffEditor.diagonalFill), across the text but not the gutter, as VS Code draws it in a view zone beside the lines.
 * React Native draws no repeating background, so it is flat off the web.
 */
function Filler({ gutter }: { gutter: number }) {
  const th = useTheme();
  const { filler } = th.diff;
  const stripes = `linear-gradient(-45deg, ${filler} 12.5%, #0000 12.5%, #0000 50%, ${filler} 50%, ${filler} 62.5%, #0000 62.5%, #0000 100%)`;
  return <View style={[{ flex: 1, marginLeft: gutter }, th.platform === "web" ? ({ backgroundImage: stripes, backgroundSize: "8px 8px" } as object as ViewStyle) : { backgroundColor: filler }]} />;
}
