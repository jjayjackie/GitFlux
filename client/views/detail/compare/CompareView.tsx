// Two revisions compared in the detail column (`setDetail({ kind: "compare", from, to })`): git.history.compare's
// header — `from` ↔ `to` with a swap, and how many commits each has that the other lacks — then the files that differ
// over the selected file's diff (`{ kind: "compare", from, to }`). Opened from the graph (two commits selected,
// "Compare with HEAD", the rows of changes to pull or push) and from the navigation.

import { useState } from "react";
import { View } from "react-native";
import { COMMIT_FILES_MAX } from "../../../../shared/limits.ts";
import { historyCompareRpc } from "../../../../shared/rpc/history.ts";
import type { FileChange } from "../../../../shared/schemas.ts";
import { useT } from "../../../i18n/messages.ts";
import { useGitQuery } from "../../../state/rpc.ts";
import { useDetail } from "../../../state/selection.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { ErrorNotice } from "../../../ui/ErrorNotice.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { SplitPane } from "../../../ui/SplitPane.tsx";
import { T } from "../../../ui/Text.tsx";
import { useTheme } from "../../../ui/theme.ts";
import { FileTree } from "../../files/FileTree.tsx";
import { shortHash } from "../../graph/model.ts";
import { useFileMenu } from "../commit/fileMenu.ts";
import { useSplitSize } from "../commit/split.ts";
import { FileDiffView } from "../diff/FileDiffView.tsx";

export function CompareView({ cwd, from, to }: { cwd: string; from: string; to: string }) {
  const th = useTheme();
  const { t } = useT();
  const [, setDetail] = useDetail();
  const comparison = useGitQuery(historyCompareRpc, { cwd, from, to });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filesSize, setFilesSize] = useSplitSize("detail.compareFiles");
  const data = comparison.data;
  const fileMenu = useFileMenu(cwd, data?.to ?? to);

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: th.space.sm, paddingHorizontal: th.space.md, paddingVertical: th.space.xs, borderBottomWidth: 1, borderColor: th.c.border }}>
      <T mono size={th.small + 1} selectable testID="ag-compare-from">
        {shortHash(from)}
      </T>
      <IconButton icon="ArrowLeftRight" label={t("detail.comparePane.swap")} onPress={() => setDetail({ kind: "compare", from: to, to: from })} testID="ag-compare-swap" />
      <T mono size={th.small + 1} selectable testID="ag-compare-to">
        {shortHash(to)}
      </T>
      {data && (
        <T size={th.small} tone="muted" style={{ flex: 1, minWidth: 120 }} testID="ag-compare-counts">
          {t("detail.comparePane.counts", { ahead: t("detail.comparePane.ahead", { count: data.ahead, name: shortHash(to) }), behind: t("detail.comparePane.behind", { count: data.behind, name: shortHash(from) }) })}
        </T>
      )}
    </View>
  );

  if (comparison.error && !data)
    return (
      <View testID="ag-compare" style={{ flex: 1, minHeight: 0 }}>
        {header}
        <ErrorNotice error={comparison.error} onRetry={() => void comparison.refetch()} testID="ag-compare-error" />
      </View>
    );
  if (!data)
    return (
      <View testID="ag-compare" style={{ flex: 1, minHeight: 0 }}>
        {header}
        <Spinner label={t("common.loading")} />
      </View>
    );

  const selected = data.files.find((file) => file.path === selectedPath) ?? data.files[0] ?? null;
  const list = (
    <View style={{ flex: 1, minHeight: 0 }}>
      {data.truncated && (
        <T size={th.small} tone="warning" style={{ paddingHorizontal: th.space.md, paddingVertical: th.space.xs }}>
          {t("detail.comparePane.truncated", { count: COMMIT_FILES_MAX })}
        </T>
      )}
      <FileTree
        treeId={`compare-${data.from}-${data.to}`}
        files={data.files}
        selectedPath={selected?.path ?? null}
        onOpen={(file: FileChange) => setSelectedPath(file.path)}
        fileMenu={fileMenu}
        empty={<EmptyState compact title={t("detail.comparePane.noDifference")} />}
        testID="ag-compare-files"
      />
    </View>
  );
  return (
    <View testID="ag-compare" style={{ flex: 1, minHeight: 0 }}>
      {header}
      <SplitPane
        direction="vertical"
        first={list}
        second={
          selected ? (
            <FileDiffView key={selected.path} embedded cwd={cwd} source={{ kind: "compare", from: data.from, to: data.to }} file={selected} />
          ) : (
            <EmptyState compact title={t("detail.comparePane.selectFile")} />
          )
        }
        size={filesSize}
        onSize={setFilesSize}
        defaultRatio={0.35}
        min={th.row * 3}
        minOther={th.row * 4}
        label={t("detail.commitPane.resizeFiles")}
        hint={t("shell.resetSize")}
        testID="ag-compare-split"
      />
    </View>
  );
}
