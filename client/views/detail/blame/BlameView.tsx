// A file's blame in the detail column (`setDetail({ kind: "blame", path, rev? })`): git.history.blame, one row per
// line in a virtualised monospaced list. A gutter names the commit that last changed the line (short hash, author,
// date) on the first line of each run of the same commit (./runs.ts), shaded by the commit's age; pressing it opens the
// commit, hovering shows its subject, and its menu (or the button on the run's first line) blames the file as it was
// before that change. Lines not committed yet are labelled as such.

import { useMemo } from "react";
import { Pressable, View } from "react-native";
import type { View as NativeView } from "react-native";
import { BLAME_MAX_LINES } from "../../../../shared/limits.ts";
import { historyBlameRpc } from "../../../../shared/rpc/history.ts";
import type { BlameCommit } from "../../../../shared/rpc/history.ts";
import { useT } from "../../../i18n/messages.ts";
import { useLayoutMode } from "../../../layout/pane.ts";
import { useFormatTime } from "../../../state/format.ts";
import { usePrefs } from "../../../state/prefs.ts";
import { useGitQuery } from "../../../state/rpc.ts";
import { useDetail } from "../../../state/selection.ts";
import * as codicon from "../../../ui/codicons.ts";
import type { MenuItem } from "../../../ui/floating/context.ts";
import { CardArea, useHoverCard } from "../../../ui/floating/HoverCard.tsx";
import { useContextMenu } from "../../../ui/floating/Menu.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { List } from "../../../ui/List.tsx";
import { T } from "../../../ui/Text.tsx";
import { useTheme } from "../../../ui/theme.ts";
import { useCopy } from "../../graph/commitActions.ts";
import { isZeroHash, shortHash } from "../../graph/model.ts";
import { ageLevels, blameRuns, runIndexes } from "./runs.ts";
import type { BlameLine } from "./runs.ts";

/** Shades of a commit's age, oldest to newest. */
const AGE_LEVELS = 5;

interface LineRow {
  line: BlameLine;
  text: string;
  /** The first line of its run: the gutter names the commit. */
  first: boolean;
  /** The run's position, for alternating the gutter's edge. */
  run: number;
}

export function BlameView({ cwd, path, rev }: { cwd: string; path: string; rev?: string }) {
  const th = useTheme();
  const { t } = useT();
  const { prefs } = usePrefs();
  const narrow = useLayoutMode() === "narrow";
  const blame = useGitQuery(historyBlameRpc, rev === undefined ? { cwd, path } : { cwd, path, rev }, { staleTime: rev === undefined ? undefined : Infinity });
  const data = blame.data;
  const code = th.code(prefs.codeFontSize);
  const rowHeight = Math.max(typeof code.lineHeight === "number" ? code.lineHeight : prefs.codeFontSize + 6, th.compact ? th.row : 18);

  const rows = useMemo<LineRow[]>(() => {
    if (!data) return [];
    const runs = blameRuns(data.lines);
    const indexes = runIndexes(runs, data.lines.length);
    return data.lines.map((line, index) => ({ line, text: data.text[line.line - 1] ?? "", first: index === 0 || indexes[index] !== indexes[index - 1], run: indexes[index] }));
  }, [data]);
  const levels = useMemo(() => {
    const times = new Map<string, number | null>();
    if (data) for (const line of data.lines) if (!times.has(line.hash)) times.set(line.hash, isZeroHash(line.hash) ? null : (data.commits[line.hash]?.time ?? null));
    return ageLevels(times, AGE_LEVELS);
  }, [data]);
  const digits = String(rows.length).length;

  return (
    <View testID="ag-blame" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: th.space.sm, minHeight: th.row, paddingHorizontal: th.space.md, borderBottomWidth: 1, borderColor: th.c.border }}>
        <T mono size={th.small + 1} lines={1} selectable style={{ flex: 1, minWidth: 0 }} testID="ag-blame-path">
          {path}
        </T>
        <T size={th.small} tone="muted" testID="ag-blame-rev">
          {rev === undefined ? t("blame.workTree") : t("blame.at", { rev: shortHash(rev) })}
        </T>
      </View>
      {data?.truncated && (
        <T size={th.small} tone="warning" style={{ paddingHorizontal: th.space.md, paddingVertical: th.space.xs }} testID="ag-blame-truncated">
          {t("blame.truncated", { count: BLAME_MAX_LINES })}
        </T>
      )}
      <CardArea style={{ flex: 1, minHeight: 0 }}>
        <List<LineRow>
          data={rows}
          keyOf={(row) => String(row.line.line)}
          rowHeight={rowHeight}
          renderRow={(row) => (
            <BlameRow
              row={row}
              commit={data?.commits[row.line.hash] ?? null}
              level={levels.get(row.line.hash) ?? 0}
              height={rowHeight}
              gutter={narrow ? 120 : 240}
              digits={digits}
              path={path}
            />
          )}
          extraData={[levels, narrow, rowHeight]}
          loading={blame.isPending}
          error={blame.error ?? undefined}
          onRetry={() => void blame.refetch()}
          empty={t("blame.empty")}
          accessibilityLabel={t("blame.title")}
          testID="ag-blame-list"
        />
      </CardArea>
    </View>
  );
}

interface BlameRowProps {
  row: LineRow;
  commit: BlameCommit | null;
  level: number;
  height: number;
  gutter: number;
  digits: number;
  path: string;
}

function BlameRow({ row, commit, level, height, gutter, digits, path }: BlameRowProps) {
  const th = useTheme();
  const { t } = useT();
  const { prefs } = usePrefs();
  const formatTime = useFormatTime();
  const [, setDetail] = useDetail();
  const copy = useCopy();
  const hash = row.line.hash;
  const uncommitted = isZeroHash(hash);
  const before = () => setDetail({ kind: "blame", path: commit?.path ?? path, rev: `${hash}^` });
  const items = (): MenuItem[] =>
    uncommitted
      ? []
      : [
          { id: "open", label: t("blame.openCommit"), icon: codicon.gitCommit, onPress: () => setDetail({ kind: "commit", hash }) },
          { id: "before", label: t("blame.before"), icon: codicon.history, onPress: before },
          { id: "copy-hash", label: t("graph.menu.copyHash"), icon: codicon.copy, onPress: () => copy(hash, t("graph.copiedHash")) },
        ];
  const menu = useContextMenu(items, { disabled: uncommitted });
  const card = useHoverCard(() => <BlameCard commit={commit} uncommitted={uncommitted} hash={hash} when={commit ? formatTime(commit.time, "absolute") : ""} />);
  const label = uncommitted
    ? t("blame.uncommittedLine", { line: row.line.line })
    : t("blame.lineLabel", { line: row.line.line, hash: shortHash(hash), author: commit?.author ?? "" });
  const summary = uncommitted ? t("blame.uncommitted") : t("blame.gutter", { hash: shortHash(hash), author: commit?.author ?? "", time: commit ? formatTime(commit.time) : "" });
  return (
    <View style={{ height, flexDirection: "row", alignItems: "center" }} testID={`ag-blame-line-${row.line.line}`}>
      <Pressable
        ref={(node: NativeView | null) => {
          menu.rowProps.ref.current = node;
          card.ref.current = node;
        }}
        onLongPress={menu.rowProps.onLongPress}
        delayLongPress={menu.rowProps.delayLongPress}
        onHoverIn={card.onHoverIn}
        onHoverOut={card.onHoverOut}
        onPressIn={card.onPressIn}
        onPress={uncommitted ? undefined : () => setDetail({ kind: "commit", hash })}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={row.first ? `ag-blame-gutter-${row.line.line}` : undefined}
        style={{
          width: gutter,
          height,
          flexDirection: "row",
          alignItems: "center",
          gap: th.space.xs,
          paddingHorizontal: th.space.sm,
          borderTopWidth: row.first && row.line.line > 1 ? 1 : 0,
          borderColor: th.c.border,
          borderRightWidth: 1,
          borderRightColor: th.c.border,
        }}
      >
        <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: th.c.accent, opacity: 0.03 + level * 0.045, pointerEvents: "none" }} />
        {row.first && (
          <T size={th.small} tone={uncommitted ? "warning" : "muted"} lines={1} style={{ flex: 1, minWidth: 0 }}>
            {summary}
          </T>
        )}
        {row.first && !uncommitted && <IconButton icon={codicon.history} label={t("blame.before")} size={th.small + 2} onPress={before} testID={`ag-blame-before-${row.line.line}`} />}
      </Pressable>
      <T mono size={th.small} tone="muted" align="right" style={{ width: digits * 8 + 16, paddingRight: th.space.sm }}>
        {String(row.line.line)}
      </T>
      <T selectable lines={1} style={[th.code(prefs.codeFontSize), { flex: 1, minWidth: 0, color: th.c.foreground }]}>
        {row.text}
      </T>
    </View>
  );
}

/** The commit behind a line, on hover. Drawn by the floating layer: theme and words only. */
function BlameCard({ commit, uncommitted, hash, when }: { commit: BlameCommit | null; uncommitted: boolean; hash: string; when: string }) {
  const th = useTheme();
  const { t } = useT();
  if (uncommitted) return <T>{t("blame.uncommitted")}</T>;
  return (
    <View style={{ gap: th.space.xs, maxWidth: 480 }} testID="ag-blame-card">
      <T weight="600" selectable>
        {commit?.subject ?? ""}
      </T>
      <T size={th.small + 1} tone="muted">
        {t("blame.card", { author: commit?.author ?? "", email: commit?.email ?? "", when })}
      </T>
      <T size={th.small} mono tone="muted">
        {shortHash(hash)}
      </T>
    </View>
  );
}
