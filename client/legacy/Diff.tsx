// The diff tab: one file before and after, as VS Code's diff editor shows it. Lines removed and added are coloured,
// and within them the words that changed; the two versions face each other where the tab is wide enough.

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FlatList, PanResponder, Pressable, Text, View } from "react-native";
import type { CellRendererProps, PressableStateCallbackType, TextStyle, ViewStyle } from "react-native";
import { diffRpc } from "../../shared/git";
import type { DiffSource, FileChange, FileDiff } from "../../shared/git";
import * as codicon from "../ui/codicons";
import { inlineRows, pairRows } from "./diffRows";
import type { Cell, InlineRow, Marks, PairRow } from "./diffRows";
import { useDiffRequest } from "./diffTab";
import type { DiffRequest } from "./diffTab";
import { key } from "./git";
import { changeSpans, WIDTH } from "./overview";
import { OverviewRuler } from "./OverviewRuler";
import type { Measures } from "./OverviewRuler";
import { fileName } from "./tree";
import { HostProvider, IconButton, isDark, Notice, PanelRoot, T, useHint, useHost } from "./ui";
import { dragged, fold, folded, regions, reveal } from "./unchanged";
import type { Hidden, Region, Revealed, Shown } from "./unchanged";
import { tabColumns, wrap, wrapColumn } from "./wrap";
import type { CharWidths } from "./wrap";

export function DiffPanel({ theme, layout, workspaceId, tab }: PluginWorkspacePanelProps) {
  const request = useDiffRequest(workspaceId);
  const host = useMemo(() => ({ theme, layout }), [theme, layout]);
  // VS Code keeps "Collapse Unchanged Regions" as a setting; the tab keeps it here, off at first as VS Code has it.
  const [collapse, setCollapse] = useState(() => (tab.state as { collapse?: unknown } | null | undefined)?.collapse === true);
  const toggle = () => {
    setCollapse(!collapse);
    tab.setState({ collapse: !collapse });
  };
  return (
    <HostProvider value={host}>
      <PanelRoot>{request ? <Diff request={request} collapse={collapse} onCollapse={toggle} /> : <Notice>Choose a file in Source Control to see its diff.</Notice>}</PanelRoot>
    </HostProvider>
  );
}

/** How tall a folded region's row is drawn. */
const BAR = 24;

/** VS Code's widths: below this the diff is drawn inline (diffEditor.renderSideBySideInlineBreakpoint). */
const SIDE_BY_SIDE = 900;

function Diff({ request, collapse, onCollapse }: { request: DiffRequest; collapse: boolean; onCollapse: () => void }) {
  const { cwd, source, file } = request;
  const { c, small } = useHost();
  const read = useRpc(diffRpc);
  const fixed = source.kind !== "staged" && source.kind !== "changes"; // commits never change; the working tree keeps changing
  const result = useQuery({
    queryKey: key("diff", cwd, source, file),
    queryFn: () => read({ cwd, source, file }),
    staleTime: fixed ? Infinity : 0,
    refetchInterval: fixed ? false : 3000,
  });
  const [width, setWidth] = useState(0);
  return (
    // Paseo hides a tab in the background (display: none), and it measures nothing then. The diff keeps the size it had,
    // and so its lines and its place in them, as VS Code's diff editor is back where it was when its tab is shown again
    // (textDiffEditor.ts: restoreTextDiffEditorViewState).
    <View style={{ flex: 1 }} onLayout={(event) => event.nativeEvent.layout.width && setWidth(event.nativeEvent.layout.width)}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: c.border }}>
        <T weight="600" lines={1} style={{ flexShrink: 1, minWidth: 0 }}>
          {`${fileName(file)} (${compared(source, file)})`}
        </T>
        <T size={small} color={c.foregroundMuted} lines={1} style={{ flexShrink: 1000, minWidth: 0 }}>
          {file.from ? `${file.from} → ${file.path}` : file.path}
        </T>
        {result.data?.kind === "diff" && (
          <View style={{ marginLeft: "auto" }}>
            <IconButton icon={codicon.map} label="Toggle Collapse Unchanged Regions" toggled={collapse} onPress={onCollapse} />
          </View>
        )}
      </View>
      {result.error ? (
        <Notice failed>{result.error.message}</Notice>
      ) : !result.data || !width ? (
        <Loading />
      ) : result.data.kind === "binary" ? (
        <Notice>The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.</Notice>
      ) : (
        <Lines key={JSON.stringify(request)} found={result.data} sideBySide={width >= SIDE_BY_SIDE} collapse={collapse} />
      )}
    </View>
  );
}

/**
 * The diff colours of VS Code 1.142's default themes, Dark 2026 and Light 2026: the host's theme has none of its own.
 * Light 2026 sets only the colours of changed text; its lines take the colours VS Code registers. Changed text is drawn
 * over its line's colour. Lines shown from a folded region are tinted (diffEditor.unchangedCodeBackground), and a folded
 * region is shaded at its edges (diffEditor.unchangedRegionShadow). The overview ruler marks changes in the colours of
 * changed text twice as opaque (overviewRulerFeature.ts), over a faint background (style.css: .diffOverview), under a
 * slider in the scrollbar's colours.
 */
function useColours() {
  const { c } = useHost();
  return isDark(c.surface0)
    ? {
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
          slider: ["#A8A9AA85", "#A8A9AA90", "#A8A9AA9C"] as [string, string, string],
        },
      }
    : {
        insertedLine: "rgba(155, 185, 85, 0.2)",
        insertedText: "#587c0c26",
        removedLine: "rgba(255, 0, 0, 0.2)",
        removedText: "#ad070726",
        filler: "#22222233",
        unchanged: "#b8b8b829",
        shadow: "#737373BF",
        ruler: { background: "rgba(0, 0, 0, 0.03)", removed: "rgba(173, 7, 7, 0.298)", added: "rgba(88, 124, 12, 0.298)", slider: ["#646464C0", "#646464D0", "#646464E0"] as [string, string, string] },
      };
}

type Found = Exclude<FileDiff, { kind: "binary" }>;
type Row = InlineRow | PairRow;
type FileRow = { file: string; number: number };
type Item = FileRow | Row | Revealed<Row> | Hidden;

/** The modified version's line of a row the same in both versions; null for a changed one. */
const sameLine = (row: Row) => ("kind" in row ? (row.kind === "same" ? row.modified : null) : row.changed ? null : row.right!.number);
const removedRow = (item: Item) => ("kind" in item ? item.kind === "remove" : "changed" in item && item.changed && item.left !== null);
const addedRow = (item: Item) => ("kind" in item ? item.kind === "add" : "changed" in item && item.changed && item.right !== null);
const keyOf = (item: Item) =>
  "file" in item ? `f${item.number}` : "hidden" in item ? `h${item.hidden}` : "kind" in item ? `${item.kind}${item.original}:${item.modified}` : `${item.left?.number}:${item.right?.number}`;
const regionKey = ({ original, modified, length }: Region) => `${original}:${modified}:${length}`;

/**
 * The code font as it is drawn: how wide its characters are, and how tall a row of it is. Both are measured: off the
 * web the system's text size scales them (allowFontScaling).
 */
interface Font {
  widths: CharWidths;
  row: number;
}

/**
 * A line as it is drawn: where each row after the first starts, how many columns those rows are set in, how many
 * columns each tab takes by where it is, and how wide a column is.
 */
interface Cut {
  breaks: number[];
  indent: number;
  tabs: Map<number, number>;
  column: number;
}

const noTabs = new Map<number, number>();

/** The lines, opened at the first change; unchanged ones folded while `collapse` is on; the overview ruler beside them. */
function Lines({ found, sideBySide, collapse }: { found: Found; sideBySide: boolean; collapse: boolean }) {
  const { code, compact, platform } = useHost();
  const colours = useColours();
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
      (globalThis as unknown as { getSelection(): { removeAllRanges(): void } }).getSelection().removeAllRanges(); // the client is typed without the DOM
      setSide(next);
    },
  };
  // The box the list and the ruler share. The diff scrolls on past its last line until only that line is left in view,
  // as VS Code's editors do by default (editor.scrollBeyondLastLine; viewLayout.ts). A region's bottom edge can then move
  // its bar up however short the diff.
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [font, setFont] = useState<Font | null>(null);
  const unmeasured = font !== null && !(font.row > 0 && font.widths.half > 0 && font.widths.full > 0); // said, not drawn as nothing
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
  const first = items.findIndex((item) => ("kind" in item ? item.kind !== "same" : "changed" in item && item.changed));
  // Once, when the diff first shows (it is read again every few seconds, and the reader may have scrolled since), it
  // opens at the first change.
  const [start] = useState(() => Math.max(0, first - 3));
  const lines = found.kind === "file" ? found.lines.length : Math.max(found.original.length, found.modified.length);
  const digits = code.fontSize * 0.6 * String(lines).length + 12; // a column wide enough for the last line's number
  // VS Code draws the ruler beside every diff; a phone has no room for it.
  const ruler = found.kind === "diff" && !compact;

  // Where every line wraps, worked out before any is drawn, as VS Code works it out: every row's height is then known,
  // so the list opens at the first change at once and the ruler is to scale. Worked out for each line, not again as
  // regions open and fold; a folded region's row is the one row not among them.
  const shapes = useMemo(() => {
    if (!font || unmeasured || !frame.width) return null;
    const { widths } = font;
    const width = frame.width - (ruler ? WIDTH : 0);
    const half = (width - 1) / 2 - digits - 16;
    const cut = (text: string, room: number): Cut => ({
      ...wrap(text, wrapColumn(room, widths), widths),
      tabs: text.includes("\t") ? tabColumns(text, widths) : noTabs,
      column: widths.half,
    });
    const none = { breaks: [], indent: 0, tabs: noTabs, column: widths.half };
    return new Map(
      rows.map((row) => {
        const cuts =
          "file" in row
            ? [cut(row.file, width - digits)]
            : "kind" in row
              ? [cut(row.text, width - digits * 2 - 16)]
              : [row.left ? cut(row.left.text, half) : none, row.right ? cut(row.right.text, half) : none];
        return [keyOf(row), { cuts, height: font.row * Math.max(...cuts.map((cut) => cut.breaks.length + 1)) }];
      }),
    );
  }, [rows, font, frame.width, ruler, digits]);
  const height = (item: Item) => shapes?.get(keyOf(item))?.height ?? BAR;
  // Where each row starts, and, last, where the last ends: told to the list and to the ruler.
  const starts = useMemo(() => {
    const starts = new Float64Array(items.length + 1);
    items.forEach((item, index) => (starts[index + 1] = starts[index] + height(item)));
    return starts;
  }, [items, shapes]);
  const spans = useMemo(() => changeSpans(items, removedRow, addedRow), [items]);
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
  const scrollTo = useCallback((offset: number) => list.current?.scrollToOffset({ offset: Math.max(0, offset), animated: false }), []);
  const scrollBy = (delta: number) => {
    measures.scrolled += delta; // at once: the next move may come before the scroll is told
    list.current?.scrollToOffset({ offset: measures.scrolled, animated: false });
  };

  // How tall a region's line is drawn, under keyOf's key for a row the same in both versions.
  const lineKey = (region: Region, line: number) => `${sideBySide ? "" : "same"}${region.original + line}:${region.modified + line}`;
  const lineHeight = (region: Region) => (line: number) => shapes!.get(lineKey(region, line))!.height;
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
          gutter={sideBySide ? digits + 16 : digits * 2 + 16}
          halves={sideBySide ? 2 : 1}
          open={(change, anchored) => open(item.hidden, change, anchored)}
        />
      );
    }
    const { cuts } = shapes!.get(keyOf(item))!;
    if ("file" in item) return <FileLine number={item.number} text={item.file} width={digits} cut={cuts[0]} />;
    const revealed = "region" in item;
    const onFold = revealed && item.first ? () => open(item.region, () => folded) : undefined;
    return "kind" in item ? (
      <InlineLine row={item} width={digits} revealed={revealed} onFold={onFold} selecting={selecting} cut={cuts[0]} />
    ) : (
      <PairLine row={item} width={digits} revealed={revealed} onFold={onFold} selecting={selecting} cuts={cuts} />
    );
  };
  return (
    <>
      {unmeasured && <Notice failed>{`The code font could not be measured: ${JSON.stringify(font)}`}</Notice>}
      {found.kind === "diff" && found.hitTimeout && <Notice>The diff stopped after five seconds, as VS Code's does: more may be marked as changed than was.</Notice>}
      <View
        style={{ flex: 1, flexDirection: "row" }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (!width) return; // hidden with its tab (see Diff)
          measures.view = height;
          setFrame({ width, height });
          measures.changed?.();
        }}
      >
        {!font && <MeasureFont onMeasured={setFont} />}
        {shapes && (
          <FlatList
            ref={list}
            style={{ flex: 1 }}
            data={items}
            keyExtractor={keyOf}
            getItemLayout={(_, index) => ({ length: starts[index + 1] - starts[index], offset: starts[index], index })}
            initialScrollIndex={start}
            initialNumToRender={Math.ceil(frame.height / rowHeight)} // enough to fill the view, however short the rows
            // Beside the ruler, its slider is the diff's scrollbar, and the text has the list's whole width to wrap in.
            showsVerticalScrollIndicator={!ruler}
            // The room past the last line, which the ruler adds to the rows.
            ListFooterComponent={<View style={{ height: after }} />}
            scrollEventThrottle={16}
            onScroll={(event) => {
              measures.scrolled = event.nativeEvent.contentOffset.y;
              measures.changed?.();
            }}
            CellRendererComponent={Cell}
            renderItem={({ item, index }) => <View style={{ height: starts[index + 1] - starts[index] }}>{draw(item)}</View>}
          />
        )}
        {shapes && ruler && <OverviewRuler starts={starts} after={after} spans={spans} measures={measures} colours={colours.ruler} scrollTo={scrollTo} />}
      </View>
    </>
  );
}

/**
 * Measures the code font, out of sight. How wide it draws its characters, as VS Code measures them (fontMeasurements.ts):
 * 'n', a typical character, and 'ｍ', a full-width one, from a thousand of each in a row; and how tall the row is.
 */
function MeasureFont({ onMeasured }: { onMeasured: (font: Font) => void }) {
  const { code } = useHost();
  const read = useRef<Partial<CharWidths> & { row?: number }>({}).current;
  const sample = (character: string, kind: keyof CharWidths) => (
    <Text
      style={[code, { alignSelf: "flex-start" }]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        read[kind] = width / 1000;
        read.row = Math.max(read.row ?? 0, height);
        if (read.half && read.full) onMeasured({ widths: { half: read.half, full: read.full }, row: read.row });
      }}
    >
      {character.repeat(1000)}
    </Text>
  );
  return (
    <View pointerEvents="none" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      {/* Sized itself: off the web, a box sized by the empty one around it gives its texts no height. */}
      <View style={{ width: 100000, height: 1000 }}>
        {sample("n", "half")}
        {sample("\uff4d", "full")}
      </View>
    </View>
  );
}

/** A row of the list; a folded region's is drawn over the row below, which the region's bottom edge reaches into. */
function Cell({ item, style, ...props }: CellRendererProps<Item>) {
  return <View {...props} style={[style, "hidden" in item && { zIndex: 1 }]} />;
}

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
  gutter,
  halves,
  open,
}: {
  lines: number;
  region: Region;
  shown: Shown;
  height: (line: number) => number;
  gutter: number;
  halves: number;
  open: (change: (region: Region, shown: Shown) => Shown, anchored?: boolean) => void;
}) {
  const { c } = useHost();
  const colours = useColours();
  const all = () => open(reveal.all);
  const bar = (half: number) => (
    <View
      key={half}
      style={
        {
          flex: 1,
          height: BAR,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: c.surface1,
          boxShadow: `inset 0 -5px 5px -7px ${colours.shadow}, inset 0 5px 5px -7px ${colours.shadow}`,
        } as ViewStyle
      }
    >
      <View style={{ width: gutter, alignItems: "center" }}>
        <BarButton hint="Show Unchanged Region" onPress={all}>
          {(hovered) => (
            // In the link colour under the pointer (style.css). Both colours stay drawn, the one shown changes: an icon
            // drawn again as the pointer comes onto it could be a new element by the time it is pressed.
            <View>
              <Glyph icon={codicon.unfold} size={16} color={c.foreground} />
              <View style={{ position: "absolute", top: 0, left: 0, opacity: hovered ? 1 : 0 }}>
                <Glyph icon={codicon.unfold} size={16} color={c.accent} />
              </View>
            </View>
          )}
        </BarButton>
      </View>
      <DoublePress hint="Double click to unfold" onDouble={all}>
        <T size={13} color={c.foreground} lines={1}>{`${lines} hidden lines`}</T>
      </DoublePress>
      <Edge edge="top" region={region} shown={shown} height={height} open={open} />
      <Edge edge="bottom" region={region} shown={shown} height={height} open={open} />
    </View>
  );
  return (
    <View style={{ flexDirection: "row" }}>
      {bar(0)}
      {halves === 2 && <View style={{ width: 1, backgroundColor: c.border }} />}
      {halves === 2 && bar(1)}
    </View>
  );
}

/**
 * An icon drawn again only when what it shows changes. Inline SVG drawn again is a new element, and a press that ends on
 * another element than it began on is no click: a button whose icon is drawn again as it is pressed would not work.
 */
const Glyph = memo(Icon);

function BarButton({ hint, onPress, children }: { hint: string; onPress: () => void; children: (hovered: boolean) => ReactNode }) {
  return (
    <Pressable {...useHint(hint)} accessibilityRole="button" accessibilityLabel={hint} onPress={onPress}>
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
    <Pressable {...useHint(hint)} onPress={press} style={{ flexShrink: 1, minWidth: 0 }}>
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
  const { c, platform } = useHost();
  const hint = useHint(edge === "top" ? "Click or drag to show more above" : "Click or drag to show more below");
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
      {...responder.panHandlers}
      {...({ onPointerEnter: () => (setLit(true), hint.onHoverIn()), onPointerLeave: () => (setLit(false), hint.onHoverOut()) } as object)}
      style={[{ position: "absolute", left: 0, right: 0, height: 10 }, edge === "top" ? { top: -6 } : { bottom: -4 }, platform === "web" ? ({ cursor } as object as ViewStyle) : null]}
    >
      <View style={{ marginTop: 4, height: 4, backgroundColor: lit || dragging ? c.accent : undefined }} />
    </View>
  );
}

/**
 * A line's text in the rows it wraps onto, its changed stretches drawn in `colour`. VS Code colours a changed stretch
 * the full height of its line (decorations.css: `.cdr` is `height: 100%`); a stretch of text is coloured only as tall
 * as its font, about 1.17 times its size for Menlo, so it is padded out to the line. A stretch names the code font again: once an interface font is
 * set, Paseo gives every element outside its own code views that font (apply-root-font.web.ts), and the stretch would
 * take it instead of the line's.
 */
function Marked({ text, marks, colour, cut, selectable = true }: { text: string; marks: Marks; colour: string; cut: Cut; selectable?: boolean }) {
  const { code, platform } = useHost();
  const web = platform === "web";
  const fill = (code.lineHeight - code.fontSize * 1.17) / 2;
  // A tab is drawn as wide as the line was wrapped with it: to the next tab stop from the start of the line, not of its
  // row. On the web it stays a tab, in a box that wide, so that it is copied as one; off the web it is spaces.
  const tabbed = (from: number, to: number) => {
    const parts: ReactNode[] = [];
    let at = from;
    for (let tab = text.indexOf("\t", from); tab !== -1 && tab < to; tab = text.indexOf("\t", tab + 1)) {
      if (tab > at) parts.push(text.slice(at, tab));
      const columns = cut.tabs.get(tab)!;
      parts.push(
        web ? (
          <Text key={`tab${tab}`} style={[WEB_TAB, { width: columns * cut.column }]}>
            {"\t"}
          </Text>
        ) : (
          " ".repeat(Math.round(columns))
        ),
      );
      at = tab + 1;
    }
    if (at < to) parts.push(text.slice(at, to));
    return parts;
  };
  const marked = (from: number, to: number) => {
    const parts: ReactNode[] = [];
    let at = from;
    for (const [start, end] of marks) {
      const [left, right] = [Math.max(start, from), Math.min(end, to)];
      if (left >= right) continue;
      if (left > at) parts.push(...tabbed(at, left));
      parts.push(
        <Text key={left} style={{ fontFamily: code.fontFamily, backgroundColor: colour, paddingVertical: fill }}>
          {tabbed(left, right)}
        </Text>,
      );
      at = right;
    }
    if (at < to) parts.push(...tabbed(at, to));
    return parts.length ? parts : " ";
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
            {marked(from, to)}
          </Text>
        ))}
      </T>
    );
  return (
    <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
      {rows.map(([from, to], n) => (
        <T key={from} selectable={selectable} lines={1} style={[code, n > 0 && { paddingLeft: pad }]}>
          {marked(from, to)}
        </T>
      ))}
    </View>
  );
}

/**
 * A row of a wrapped line on the web. It names the code font, as a changed stretch does, and sits at the top of its
 * line, so that the line is as tall as one row.
 */
const WEB_ROW = { display: "inline-block", width: "100%", whiteSpace: "pre", verticalAlign: "top" } as object as TextStyle;
/** A tab on the web, in a box as wide as it is drawn. */
const WEB_TAB = { display: "inline-block", overflow: "hidden", verticalAlign: "top" } as object as TextStyle;

/** A line's number. Like the rest of the gutter, it is not selected or copied with the text, as VS Code's margin is not. */
function LineNumber({ value, width }: { value: number | null; width: number }) {
  const { c, code } = useHost();
  return (
    <T selectable={false} color={c.foregroundMuted} style={[code, { width, paddingRight: 8, textAlign: "right" }]}>
      {value === null ? "" : String(value)}
    </T>
  );
}

/**
 * VS Code's + and − beside a changed line (diffEditor.renderIndicators). Beside the first line of a region opened in
 * full, the icon that folds it again, as VS Code puts it in the margin.
 */
function Indicator({ kind, onFold }: { kind: "same" | "remove" | "add"; onFold?: () => void }) {
  const { c, code } = useHost();
  if (onFold)
    return (
      <View style={{ width: 16, height: code.lineHeight, justifyContent: "center" }}>
        <BarButton hint="Fold Unchanged Region" onPress={onFold}>
          {() => <Glyph icon={codicon.fold} size={16} color={c.foregroundMuted} />}
        </BarButton>
      </View>
    );
  return (
    <T selectable={false} color={c.foregroundMuted} style={[code, { width: 16 }]}>
      {kind === "add" ? "+" : kind === "remove" ? "−" : " "}
    </T>
  );
}

function FileLine({ number, text, width, cut }: { number: number; text: string; width: number; cut: Cut }) {
  return (
    <View style={{ flexDirection: "row" }}>
      <LineNumber value={number} width={width} />
      <Marked text={text} marks={[]} colour="" cut={cut} />
    </View>
  );
}

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

interface LineProps {
  width: number;
  revealed: boolean; // shown from a folded region
  onFold?: () => void;
  selecting: Selecting;
}

/** A line of the inline view, numbered in the original and in the modified version, as VS Code numbers them. */
function InlineLine({ row, width, revealed, onFold, selecting, cut }: LineProps & { row: InlineRow; cut: Cut }) {
  const colours = useColours();
  const removed = row.kind === "remove";
  const side: Side = removed ? "original" : "modified";
  return (
    <View
      style={{ flexDirection: "row", backgroundColor: row.kind === "add" ? colours.insertedLine : removed ? colours.removedLine : revealed ? colours.unchanged : undefined }}
      onPointerDown={() => selecting.start(side)}
    >
      <LineNumber value={row.original} width={width} />
      <LineNumber value={row.modified} width={width} />
      <Indicator kind={row.kind} onFold={onFold} />
      <Marked text={row.text} marks={row.marks} colour={removed ? colours.removedText : colours.insertedText} cut={cut} selectable={selecting.side === null || selecting.side === side} />
    </View>
  );
}

/**
 * A row of the side-by-side view: the original on the left, the modified on the right. In a change, a side with no
 * line, or with a line that wraps onto fewer rows than the other's, is filled out below it.
 */
function PairLine({ row, width, revealed, onFold, selecting, cuts }: LineProps & { row: PairRow; cuts: Cut[] }) {
  const { c } = useHost();
  const colours = useColours();
  const half = (cell: Cell | null, side: Side, cut: Cut) => {
    const kind = side === "original" ? "remove" : "add";
    return (
      <View style={{ flex: 1 }} onPointerDown={() => selecting.start(side)}>
        {cell && (
          <View style={{ flexDirection: "row", backgroundColor: row.changed ? (kind === "add" ? colours.insertedLine : colours.removedLine) : revealed ? colours.unchanged : undefined }}>
            <LineNumber value={cell.number} width={width} />
            <Indicator kind={row.changed ? kind : "same"} onFold={onFold} />
            <Marked
              text={cell.text}
              marks={cell.marks}
              colour={kind === "add" ? colours.insertedText : colours.removedText}
              cut={cut}
              selectable={selecting.side === null || selecting.side === side}
            />
          </View>
        )}
        {row.changed && <Filler gutter={width + 16} />}
      </View>
    );
  };
  return (
    <View style={{ flexDirection: "row" }}>
      {half(row.left, "original", cuts[0])}
      <View style={{ width: 1, backgroundColor: c.border }} />
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
  const { platform } = useHost();
  const { filler } = useColours();
  const stripes = `linear-gradient(-45deg, ${filler} 12.5%, #0000 12.5%, #0000 50%, ${filler} 50%, ${filler} 62.5%, #0000 62.5%, #0000 100%)`;
  return <View style={[{ flex: 1, marginLeft: gutter }, platform === "web" ? ({ backgroundImage: stripes, backgroundSize: "8px 8px" } as object as ViewStyle) : { backgroundColor: filler }]} />;
}

/** What VS Code writes after a file's name in the title of its diff: the version shown, or the commit. */
function compared(source: DiffSource, file: FileChange) {
  if (source.kind === "commit") return source.hash.slice(0, 7);
  if (source.kind === "incoming") return "Incoming Changes";
  if (source.kind === "outgoing") return "Outgoing Changes";
  if (file.status === "D") return "Deleted";
  if (source.kind === "staged") return "Index";
  return file.status === "?" ? "Untracked" : "Working Tree";
}
