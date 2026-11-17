// A file's history in the detail column (`setDetail({ kind: "fileHistory", path })`): git.history.file, following
// renames, paged. Each commit's row shows what it did to the file, its subject, author, time and short hash, and the
// file's path at that commit where a rename makes it differ; pressing one shows that commit's change to the file below.

import { useState } from "react";
import { Pressable, View } from "react-native";
import type { PressableStateCallbackType, View as NativeView } from "react-native";
import { LOG_PAGE, LOG_PAGE_MAX } from "../../../../shared/limits.ts";
import { historyFileRpc } from "../../../../shared/rpc/history.ts";
import type { FileCommit } from "../../../../shared/rpc/history.ts";
import { useT } from "../../../i18n/messages.ts";
import { useFormatTime } from "../../../state/format.ts";
import { useGitQuery } from "../../../state/rpc.ts";
import { useDetail } from "../../../state/selection.ts";
import { Badge } from "../../../ui/Badge.tsx";
import * as codicon from "../../../ui/codicons.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import type { MenuItem } from "../../../ui/floating/context.ts";
import { MoreButton, useContextMenu } from "../../../ui/floating/Menu.tsx";
import { List } from "../../../ui/List.tsx";
import { SplitPane } from "../../../ui/SplitPane.tsx";
import { T } from "../../../ui/Text.tsx";
import { useTheme } from "../../../ui/theme.ts";
import { useCopy } from "../../graph/commitActions.ts";
import { shortHash } from "../../graph/model.ts";
import { useSplitSize } from "../commit/split.ts";
import { FileDiffView } from "../diff/FileDiffView.tsx";

export function FileHistoryView({ cwd, path }: { cwd: string; path: string }) {
  const th = useTheme();
  const { t } = useT();
  const [limit, setLimit] = useState(LOG_PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [size, setSize] = useSplitSize("detail.historyList");
  const history = useGitQuery(historyFileRpc, { cwd, path, limit, skip: 0, follow: true }, { keepPrevious: true });
  const commits = history.data?.commits ?? [];
  const more = history.data?.more ?? false;
  const shown = commits.find((commit) => commit.hash === selected) ?? null;

  const list = (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: th.space.sm, minHeight: th.row, paddingHorizontal: th.space.md, borderBottomWidth: 1, borderColor: th.c.border }}>
        <T mono size={th.small + 1} lines={1} selectable style={{ flex: 1, minWidth: 0 }} testID="ag-file-history-path">
          {path}
        </T>
      </View>
      <List<FileCommit>
        data={commits}
        keyOf={(commit) => commit.hash}
        selectedKey={selected}
        renderRow={(commit, info) => <HistoryRow path={path} commit={commit} selected={info.selected} onPress={() => setSelected(commit.hash)} />}
        loading={history.isPending}
        error={history.error ?? undefined}
        onRetry={() => void history.refetch()}
        empty={t("history.file.empty")}
        hasMore={more && limit < LOG_PAGE_MAX}
        loadingMore={history.isFetching}
        onLoadMore={() => setLimit((current) => Math.min(current + LOG_PAGE, LOG_PAGE_MAX))}
        footer={
          more && limit >= LOG_PAGE_MAX ? (
            <T size={th.small} tone="muted" style={{ padding: th.space.md }}>
              {t("history.file.capped", { count: LOG_PAGE_MAX })}
            </T>
          ) : undefined
        }
        accessibilityLabel={t("history.title")}
        testID="ag-file-history-list"
      />
    </View>
  );
  return (
    <View testID="ag-file-history" style={{ flex: 1, minHeight: 0 }}>
      <SplitPane
        direction="vertical"
        first={list}
        second={
          shown ? (
            <FileDiffView key={shown.hash} embedded cwd={cwd} source={{ kind: "commit", hash: shown.hash }} file={{ path: shown.path, status: shown.status }} />
          ) : (
            <EmptyState compact title={t("history.file.selectCommit")} />
          )
        }
        size={size}
        onSize={setSize}
        defaultRatio={0.4}
        min={th.row * 4}
        minOther={th.row * 4}
        label={t("history.file.resize")}
        hint={t("shell.resetSize")}
        testID="ag-file-history-split"
      />
    </View>
  );
}

function HistoryRow({ path, commit, selected, onPress }: { path: string; commit: FileCommit; selected: boolean; onPress: () => void }) {
  const th = useTheme();
  const { t } = useT();
  const formatTime = useFormatTime();
  const [, setDetail] = useDetail();
  const copy = useCopy();
  const [hovered, setHovered] = useState(false);
  const items = (): MenuItem[] => [
    { id: "open", label: t("history.file.openCommit"), icon: codicon.gitCommit, onPress: () => setDetail({ kind: "commit", hash: commit.hash }) },
    {
      id: "blame",
      label: t("detail.commitPane.blameAt"),
      disabled: commit.status === "D",
      reason: commit.status === "D" ? t("detail.commitPane.deleted") : null,
      onPress: () => setDetail({ kind: "blame", path: commit.path, rev: commit.hash }),
    },
    { id: "copy-hash", label: t("graph.menu.copyHash"), icon: codicon.copy, onPress: () => copy(commit.hash, t("graph.copiedHash")) },
  ];
  const menu = useContextMenu(items);
  const time = formatTime(commit.time);
  return (
    <Pressable
      ref={(node: NativeView | null) => {
        menu.rowProps.ref.current = node;
      }}
      onLongPress={menu.rowProps.onLongPress}
      delayLongPress={menu.rowProps.delayLongPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={t("graph.row", { subject: commit.subject, author: commit.author, time })}
      accessibilityState={{ selected }}
      aria-selected={selected}
      testID={`ag-file-history-row-${commit.hash}`}
      onPress={onPress}
      style={({ pressed }: PressableStateCallbackType) => ({
        height: th.row,
        flexDirection: "row",
        alignItems: "center",
        gap: th.space.sm,
        paddingLeft: th.space.md,
        paddingRight: th.space.sm,
        backgroundColor: selected ? th.selected : pressed || hovered ? th.hover : undefined,
      })}
    >
      <Badge status={commit.status} />
      <T lines={1} style={{ flex: 1, minWidth: 0 }}>
        {commit.subject}
      </T>
      {commit.path !== path && (
        <T size={th.small} tone="muted" mono lines={1} style={{ maxWidth: 160, flexShrink: 1 }}>
          {t("history.file.wasPath", { path: commit.path })}
        </T>
      )}
      <T size={th.small} tone="muted" lines={1} style={{ maxWidth: 120, flexShrink: 1000 }}>
        {commit.author}
      </T>
      <T size={th.small} tone="muted" lines={1} style={{ flexShrink: 0 }}>
        {time}
      </T>
      <T size={th.small} tone="muted" mono style={{ flexShrink: 0 }}>
        {shortHash(commit.hash)}
      </T>
      <MoreButton items={items} testID={`ag-file-history-more-${commit.hash}`} />
    </Pressable>
  );
}
