// A working file's changes as git's hunks, to stage, unstage or discard whole or line by line (VS Code's "Stage
// Selected Ranges", line by line). Each hunk has a header row with its `@@` line and its buttons; under it its lines,
// of which the added and deleted ones can be chosen: press a line or its box, Shift-press on the web for a range. The
// bar above the hunks acts on the chosen lines. Lines wrap as the diff's do (./code.tsx) and only the rows in view are
// drawn.
//
// A hunk is named by the id git.changes.hunks gave it; when the file changed since, git.changes.apply-hunks answers
// STALE_STATE: the hunks are read again and the reader is told.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import type { GestureResponderEvent, TextStyle } from "react-native";
import { gitErrorFrom } from "../../../../shared/errors.ts";
import { changesApplyHunksRpc, changesHunksRpc } from "../../../../shared/rpc/changes.ts";
import type { HunkSelection } from "../../../../shared/rpc/changes.ts";
import type { FileChange, Hunk, HunkLine } from "../../../../shared/schemas.ts";
import { useT } from "../../../i18n/messages.ts";
import { useGitMutation, useGitQuery } from "../../../state/rpc.ts";
import { Banner, Button, codicon, EmptyState, ErrorNotice, Glyph, IconButton, Loading, T, useDialogs, useErrorToast, useTheme, useToast } from "../../../ui/index.ts";
import { cutLine, fontUsable, LineNumber, Marked, MeasureFont } from "./code.tsx";
import type { Cut, Font } from "./code.tsx";
import type { DiffNavigator } from "./DiffBody.tsx";
import {
  countSelected,
  describeHunk,
  describeSelected,
  isChange,
  isSelected,
  isWholeHunk,
  NO_SELECTION,
  prune,
  selectRange,
  toggleHunk,
  toggleLine,
  toRequest,
} from "./hunkSelection.ts";
import type { LinePoint, LineSelection } from "./hunkSelection.ts";
import { codeMetrics, lineColumns, numberWidth } from "./wrap.ts";

export interface HunkViewProps {
  cwd: string;
  file: FileChange;
  /** The index's hunks against HEAD (to unstage); otherwise the work tree's against the index (to stage or discard). */
  staged: boolean;
  fontSize: number;
  wrap: boolean;
  navigator?: MutableRefObject<DiffNavigator | null>;
  onPosition?: (current: number, total: number) => void;
}

const REFRESH_MS = 3000;
const MAX_UNWRAPPED_WIDTH = 200_000;
const NO_MARKS: [number, number][] = [];

type Item = { kind: "header"; hunk: Hunk; number: number } | { kind: "line"; hunk: Hunk; number: number; index: number; line: HunkLine };
const keyOf = (item: Item) => (item.kind === "header" ? `h${item.hunk.id}` : `l${item.hunk.id}:${item.index}`);

type Action = "stage" | "unstage" | "discard";

export function HunkView({ cwd, file, staged, fontSize, wrap, navigator, onPosition }: HunkViewProps) {
  const th = useTheme();
  const { t } = useT();
  const toast = useToast();
  const toastError = useErrorToast();
  const dialogs = useDialogs();
  const query = useGitQuery(changesHunksRpc, { cwd, file, staged }, { refetchInterval: REFRESH_MS });
  const hunks = useMemo(() => query.data?.hunks ?? [], [query.data]);
  const [chosen, setChosen] = useState<LineSelection>(NO_SELECTION);
  const selection = useMemo(() => prune(chosen, hunks), [chosen, hunks]);
  const anchor = useRef<LinePoint | null>(null);

  const stale = useCallback(() => {
    setChosen(NO_SELECTION);
    anchor.current = null;
    void query.refetch();
    toast.show(t("diff.hunks.stale"), { variant: "warning" });
  }, [query, toast, t]);
  const onError = (error: unknown) => (gitErrorFrom(error).code === "STALE_STATE" ? stale() : toastError(error));
  const stage = useGitMutation(changesApplyHunksRpc, { cwd, label: "staging", onError });
  const unstage = useGitMutation(changesApplyHunksRpc, { cwd, label: "unstaging", onError });
  const discard = useGitMutation(changesApplyHunksRpc, { cwd, label: "discarding" });
  const busy = staged ? unstage : stage;

  const base = { path: file.path, from: file.from };
  const apply = (action: Action, request: HunkSelection[], lost: string[]) => {
    if (request.length === 0) return;
    const done = () => {
      setChosen(NO_SELECTION);
      anchor.current = null;
    };
    if (action === "stage") void stage.run({ ...base, hunks: request, action: "stage" }).then((result) => result.status === "ok" && done());
    else if (action === "unstage") void unstage.run({ ...base, hunks: request, action: "unstage" }).then((result) => result.status === "ok" && done());
    else
      void dialogs.confirm({
        title: t("diff.hunks.discardTitle", { name: file.path }),
        body: t("diff.hunks.discardBody", { count: lost.length }),
        lost,
        confirmLabel: t("diff.hunks.discardConfirm"),
        danger: true,
        testID: "ag-hunks-discard-confirm",
        onConfirm: async () => {
          try {
            await discard.runAsync({ ...base, hunks: request, action: "discard", confirm: true });
            done();
          } catch (error) {
            if (gitErrorFrom(error).code === "STALE_STATE") {
              setChosen(NO_SELECTION);
              void query.refetch();
            }
            throw error;
          }
        },
      });
  };

  // Rows: each hunk's header, then its lines.
  const items = useMemo(() => {
    const list: Item[] = [];
    hunks.forEach((hunk, number) => {
      list.push({ kind: "header", hunk, number });
      hunk.lines.forEach((line, index) => list.push({ kind: "line", hunk, number, index, line }));
    });
    return list;
  }, [hunks]);

  const press = (hunk: Hunk, index: number, event?: GestureResponderEvent) => {
    if (!isChange(hunk.lines[index])) return;
    const shift = (event?.nativeEvent as unknown as { shiftKey?: boolean } | undefined)?.shiftKey === true;
    const point = { id: hunk.id, index };
    setChosen((current) => (shift && anchor.current ? selectRange(prune(current, hunks), hunks, anchor.current, point) : toggleLine(prune(current, hunks), hunk, index)));
    anchor.current = point;
  };

  if (query.error) return <ErrorNotice error={query.error} onRetry={() => void query.refetch()} testID="ag-hunks-error" />;
  if (!query.data) return <Loading />;
  if (query.data.binary) return <EmptyState icon={codicon.file} title={t("diff.hunks.binary")} testID="ag-hunks-binary" />;
  if (hunks.length === 0) return <EmptyState icon={codicon.check} title={t("diff.hunks.none")} testID="ag-hunks-empty" />;

  const count = countSelected(selection);
  const request = toRequest(selection, hunks);
  return (
    <View style={{ flex: 1, minHeight: 0 }} testID="ag-hunks">
      {query.data.truncated && <Banner tone="warning" text={t("diff.hunks.truncated", { count: hunks.length })} testID="ag-hunks-truncated" />}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: th.space.sm,
          paddingHorizontal: th.space.md,
          paddingVertical: th.space.xs,
          borderBottomWidth: 1,
          borderColor: th.c.border,
          backgroundColor: th.c.surface1,
        }}
      >
        <T size={th.small + 1} tone="muted" style={{ flex: 1, minWidth: 120 }} testID="ag-hunks-count">
          {count === 0 ? t("diff.hunks.selectHint") : t("diff.hunks.selected", { count })}
        </T>
        {count > 0 && <Button small variant="ghost" label={t("diff.hunks.clear")} onPress={() => setChosen(NO_SELECTION)} testID="ag-hunks-clear" />}
        {!staged && (
          <Button
            small
            variant="danger"
            icon={codicon.discard}
            label={t("diff.hunks.discardLines")}
            disabled={count === 0 || discard.disabled}
            reason={count === 0 ? t("diff.hunks.selectFirst") : discard.reason}
            onPress={() => apply("discard", request, describeSelected(selection, hunks))}
            testID="ag-hunks-discard-lines"
          />
        )}
        <Button
          small
          variant="primary"
          icon={staged ? codicon.remove : codicon.add}
          label={staged ? t("diff.hunks.unstageLines") : t("diff.hunks.stageLines")}
          disabled={count === 0 || busy.disabled}
          reason={count === 0 ? t("diff.hunks.selectFirst") : busy.reason}
          busy={busy.pending}
          onPress={() => apply(staged ? "unstage" : "stage", request, [])}
          testID={staged ? "ag-hunks-unstage-lines" : "ag-hunks-stage-lines"}
        />
      </View>
      <HunkLines
        items={items}
        hunks={hunks}
        selection={selection}
        staged={staged}
        fontSize={fontSize}
        wrap={wrap}
        navigator={navigator}
        onPosition={onPosition}
        onPress={press}
        onToggleHunk={(hunk) => setChosen((current) => toggleHunk(prune(current, hunks), hunk))}
        onHunk={(action, hunk) => apply(action, [{ id: hunk.id }], describeHunk(hunk))}
        disabled={{ stage: stage.disabled, unstage: unstage.disabled, discard: discard.disabled }}
        reason={stage.reason ?? unstage.reason ?? discard.reason}
      />
    </View>
  );
}

interface HunkLinesProps {
  items: Item[];
  hunks: Hunk[];
  selection: LineSelection;
  staged: boolean;
  fontSize: number;
  wrap: boolean;
  navigator?: MutableRefObject<DiffNavigator | null>;
  onPosition?: (current: number, total: number) => void;
  onPress: (hunk: Hunk, index: number, event?: GestureResponderEvent) => void;
  onToggleHunk: (hunk: Hunk) => void;
  onHunk: (action: Action, hunk: Hunk) => void;
  disabled: Record<Action, boolean>;
  reason: string | null;
}

/** The rows, virtualised: their heights are worked out from where each line wraps before any is drawn. */
function HunkLines({ items, hunks, selection, staged, fontSize, wrap, navigator, onPosition, onPress, onToggleHunk, onHunk, disabled, reason }: HunkLinesProps) {
  const th = useTheme();
  const code = useMemo(() => th.code(fontSize), [th, fontSize]);
  const metrics = codeMetrics(fontSize);
  const list = useRef<FlatList<Item>>(null);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [measured, setFont] = useState<Font | null>(null);
  const font = measured !== null && measured.size === fontSize ? measured : null;
  const box = th.compact ? 28 : 22; // the gutter with the line's box
  const header = th.row + 8;
  const lines = Math.max(1, ...hunks.map((hunk) => Math.max(hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines)));
  const digits = numberWidth(fontSize, lines);
  const gutter = box + digits * 2 + metrics.indicator;

  const shapes = useMemo(() => {
    if (!font || !fontUsable(font) || !frame.width) return null;
    const room = frame.width - gutter;
    let longest = 0;
    const cuts = new Map<string, Cut>();
    const heights: number[] = [];
    for (const item of items) {
      if (item.kind === "header") {
        heights.push(header);
        continue;
      }
      if (!wrap) longest = Math.max(longest, lineColumns(item.line.text, font.widths));
      const cut = cutLine(item.line.text, room, font.widths, wrap);
      cuts.set(keyOf(item), cut);
      heights.push(font.row * (cut.breaks.length + 1));
    }
    const across = wrap ? frame.width : Math.min(MAX_UNWRAPPED_WIDTH, Math.max(frame.width, gutter + longest * font.widths.half + 4));
    return { cuts, heights, across };
  }, [font, frame.width, items, wrap, gutter, header]);
  const starts = useMemo(() => {
    const at = new Float64Array(items.length + 1);
    if (shapes) shapes.heights.forEach((height, index) => (at[index + 1] = at[index] + height));
    return at;
  }, [shapes, items.length]);
  const headers = useMemo(() => items.flatMap((item, index) => (item.kind === "header" ? [index] : [])), [items]);

  // Stepping from hunk to hunk, as the diff steps from change to change.
  const scrolled = useRef(0);
  const live = useRef({ starts, headers, onPosition });
  live.current = { starts, headers, onPosition };
  const report = useCallback(() => {
    const { starts: at, headers: firsts, onPosition: tell } = live.current;
    if (!tell) return;
    let current = 0;
    while (current < firsts.length && at[firsts[current]] <= scrolled.current + 1) current++;
    tell(current, firsts.length);
  }, []);
  useEffect(() => {
    if (shapes) report();
  }, [shapes, headers, report]);
  useEffect(() => {
    if (!navigator) return;
    navigator.current = {
      go: (delta) => {
        const { starts: at, headers: firsts } = live.current;
        const top = scrolled.current;
        const target = delta > 0 ? firsts.find((index) => at[index] > top + 1) : [...firsts].reverse().find((index) => at[index] < top - 1);
        if (target === undefined) return;
        scrolled.current = at[target];
        list.current?.scrollToOffset({ offset: at[target], animated: false });
        report();
      },
    };
    return () => {
      navigator.current = null;
    };
  }, [navigator, report]);

  const draw = (item: Item) => {
    if (item.kind === "header")
      return (
        <HunkHeader
          hunk={item.hunk}
          number={item.number}
          staged={staged}
          whole={isWholeHunk(selection, item.hunk)}
          some={selection.has(item.hunk.id)}
          box={box}
          onToggle={() => onToggleHunk(item.hunk)}
          onHunk={(action) => onHunk(action, item.hunk)}
          disabled={disabled}
          reason={reason}
        />
      );
    return (
      <HunkLineRow
        line={item.line}
        selected={isSelected(selection, item.hunk.id, item.index)}
        cut={shapes!.cuts.get(keyOf(item))!}
        code={code}
        box={box}
        digits={digits}
        indicator={metrics.indicator}
        onPress={(event) => onPress(item.hunk, item.index, event)}
        testID={`ag-hunk-${item.number}-line-${item.index}`}
      />
    );
  };
  const listed = shapes && (
    <FlatList
      ref={list}
      style={{ flex: 1 }}
      data={items}
      keyExtractor={keyOf}
      extraData={selection}
      getItemLayout={(_, index) => ({ length: starts[index + 1] - starts[index], offset: starts[index], index })}
      initialNumToRender={Math.max(1, Math.ceil(frame.height / Math.max(1, font?.row ?? 1)))}
      scrollEventThrottle={16}
      onScroll={(event) => {
        scrolled.current = event.nativeEvent.contentOffset.y;
        report();
      }}
      renderItem={({ item, index }) => <View style={{ height: starts[index + 1] - starts[index] }}>{draw(item)}</View>}
      testID="ag-hunks-list"
    />
  );
  return (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width) setFrame({ width, height });
      }}
    >
      {!font && <MeasureFont key={fontSize} code={code} size={fontSize} onMeasured={setFont} />}
      {shapes &&
        (shapes.across <= frame.width ? (
          listed
        ) : (
          <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width: shapes.across }}>
            <View style={{ width: shapes.across, height: frame.height }}>{listed}</View>
          </ScrollView>
        ))}
    </View>
  );
}

/** A hunk's `@@` line, the box that chooses all its lines, and its buttons. */
function HunkHeader({
  hunk,
  number,
  staged,
  whole,
  some,
  box,
  onToggle,
  onHunk,
  disabled,
  reason,
}: {
  hunk: Hunk;
  number: number;
  staged: boolean;
  whole: boolean;
  some: boolean;
  box: number;
  onToggle: () => void;
  onHunk: (action: Action) => void;
  disabled: Record<Action, boolean>;
  reason: string | null;
}) {
  const th = useTheme();
  const { t } = useT();
  const id = `ag-hunk-${number}`;
  return (
    <View
      testID={id}
      style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: th.space.sm, paddingRight: th.space.sm, backgroundColor: th.c.surface1, borderTopWidth: 1, borderColor: th.c.border }}
    >
      <View style={{ width: box, alignItems: "center" }}>
        <SelectBox checked={whole} mixed={some && !whole} label={t("diff.hunks.selectHunk")} onPress={onToggle} testID={`${id}-select`} />
      </View>
      <T mono size={th.small + 1} tone="muted" lines={1} selectable style={{ flex: 1, minWidth: 0 }}>
        {hunk.header}
      </T>
      {staged ? (
        <IconButton icon={codicon.remove} label={t("diff.hunks.unstageHunk")} disabled={disabled.unstage} reason={reason} onPress={() => onHunk("unstage")} testID={`${id}-unstage`} />
      ) : (
        <>
          <IconButton icon={codicon.discard} label={t("diff.hunks.discardHunk")} disabled={disabled.discard} reason={reason} onPress={() => onHunk("discard")} testID={`${id}-discard`} />
          <IconButton icon={codicon.add} label={t("diff.hunks.stageHunk")} disabled={disabled.stage} reason={reason} onPress={() => onHunk("stage")} testID={`${id}-stage`} />
        </>
      )}
    </View>
  );
}

/** A line's box: chosen, partly chosen (a hunk with some of its lines chosen), or not. */
function SelectBox({ checked, mixed = false, label, onPress, testID }: { checked: boolean; mixed?: boolean; label: string; onPress?: () => void; testID?: string }) {
  const th = useTheme();
  const size = th.compact ? 18 : 14;
  const inner = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: checked || mixed ? th.c.accent : th.c.border,
        backgroundColor: checked ? th.c.accent : th.c.surface2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {checked && <Glyph icon={codicon.check} size={size - 2} color={th.c.accentForeground} />}
      {mixed && <View style={{ width: size - 6, height: 2, backgroundColor: th.c.accent }} />}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: mixed ? "mixed" : checked }}
      onPress={onPress}
      hitSlop={4}
      testID={testID}
    >
      {inner}
    </Pressable>
  );
}

const PLUS = "+";
const MINUS = "−";
const SPACE = " ";

/** A line of a hunk: its box when it is a change, its numbers, its sign and its text. Pressing it chooses it. */
function HunkLineRow({
  line,
  selected,
  cut,
  code,
  box,
  digits,
  indicator,
  onPress,
  testID,
}: {
  line: HunkLine;
  selected: boolean;
  cut: Cut;
  code: TextStyle;
  box: number;
  digits: number;
  indicator: number;
  onPress: (event: GestureResponderEvent) => void;
  testID: string;
}) {
  const th = useTheme();
  const { t } = useT();
  const change = isChange(line);
  const added = line.kind === "add";
  const background = added ? th.diff.insertedLine : line.kind === "delete" ? th.diff.removedLine : undefined;
  const sign = added ? PLUS : line.kind === "delete" ? MINUS : SPACE;
  const row = (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: background, borderLeftWidth: 2, borderLeftColor: selected ? th.c.accent : "transparent" }}>
      <View style={{ width: box - 2, alignItems: "center", paddingTop: Math.max(0, ((typeof code.lineHeight === "number" ? code.lineHeight : 18) - (th.compact ? 18 : 14)) / 2) }}>
        {change && <SelectBox checked={selected} label={t("diff.hunks.selectLine")} />}
      </View>
      <LineNumber value={line.oldLine} width={digits} code={code} />
      <LineNumber value={line.newLine} width={digits} code={code} />
      <T selectable={false} color={th.c.foregroundMuted} style={[code, { width: indicator }]}>
        {sign}
      </T>
      <Marked text={line.text} marks={NO_MARKS} colour="" cut={cut} code={code} selectable={!change} />
    </View>
  );
  if (!change) return row;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={t("diff.hunks.lineLabel", { sign: added ? PLUS : MINUS, text: line.text.slice(0, 200) })}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      testID={testID}
      style={{ flex: 1, flexDirection: "row" }}
    >
      {row}
    </Pressable>
  );
}
