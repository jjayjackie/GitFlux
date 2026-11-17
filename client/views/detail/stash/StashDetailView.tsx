// A stash in the detail column (the detail kind `stash`, client-seams): its message, the branch it was made on and when,
// Apply / Pop / Drop…, then the files it changed over the selected file's diff, in a vertical SplitPane. The first file
// is selected at first. A stash that is no longer listed (popped or dropped elsewhere) says so.

import { useToast } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { View } from "react-native";
import { stashApplyRpc, stashListRpc, stashPopRpc, stashShowRpc } from "../../../../shared/rpc/stash.ts";
import type { FileChange, StashEntry } from "../../../../shared/schemas.ts";
import { DropStashDialog } from "../../../dialogs/refs/DropStashDialog.tsx";
import type { DropStashDialogProps } from "../../../dialogs/refs/DropStashDialog.tsx";
import { useT } from "../../../i18n/messages.ts";
import { useFormatTime } from "../../../state/format.ts";
import { useGitMutation, useGitQuery } from "../../../state/rpc.ts";
import { NO_DETAIL, useDetail } from "../../../state/selection.ts";
import { Button } from "../../../ui/Button.tsx";
import { useDialogs } from "../../../ui/Dialog.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { ErrorNotice } from "../../../ui/ErrorNotice.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { SplitPane } from "../../../ui/SplitPane.tsx";
import { T } from "../../../ui/Text.tsx";
import { useTheme } from "../../../ui/theme.ts";
import { FileTree } from "../../files/FileTree.tsx";
import { FileDiffView } from "../diff/FileDiffView.tsx";

export interface StashDetailViewProps {
  cwd: string;
  /** The stash commit. */
  hash: string;
}

const FILL = { flex: 1, minHeight: 0, minWidth: 0 } as const;

export function StashDetailView({ cwd, hash }: StashDetailViewProps) {
  const { t } = useT();
  const list = useGitQuery(stashListRpc, { cwd });
  const stash = list.data?.stashes.find((entry) => entry.hash === hash);
  if (list.error && !list.data) return <ErrorNotice error={list.error} onRetry={() => void list.refetch()} testID="ag-stash-detail-error" />;
  if (!list.data) return <Spinner />;
  if (!stash) return <EmptyState icon="Archive" title={t("stash.detail.gone")} testID="ag-stash-detail-gone" />;
  return <StashDetail cwd={cwd} stash={stash} />;
}

function StashDetail({ cwd, stash }: { cwd: string; stash: StashEntry }) {
  const th = useTheme();
  const { t } = useT();
  const toast = useToast();
  const dialogs = useDialogs();
  const formatTime = useFormatTime();
  const [, setDetail] = useDetail();
  const [chosen, setChosen] = useState<string | null>(null);
  const [split, setSplit] = useState<number | null>(null);
  const show = useGitQuery(stashShowRpc, { cwd, hash: stash.hash }, { staleTime: 60_000 });
  const files = show.data?.files ?? [];
  const selected: FileChange | undefined = files.find((file) => file.path === chosen) ?? files[0];

  const apply = useGitMutation(stashApplyRpc, { cwd, label: "stashing" });
  const pop = useGitMutation(stashPopRpc, { cwd, label: "stashing" });
  const reported = (conflicted: boolean, message: string) => {
    if (conflicted) toast.show(t("stash.conflicted", { ref: stash.ref }), { variant: "warning" });
    else toast.show(message, { variant: "success" });
  };
  const busy = apply.pending || pop.pending;
  const where = stash.branch === null ? t("stash.detachedHead") : t("stash.onBranch", { branch: stash.branch });
  const facts = [stash.ref, where, formatTime(stash.time)].join(" · ");

  const header = (
    <View style={{ paddingHorizontal: th.space.md, paddingVertical: th.space.sm, gap: th.space.xs, borderBottomWidth: 1, borderColor: th.c.border }}>
      <T weight="600" selectable lines={2}>
        {stash.message}
      </T>
      <T size={th.small} tone="muted" lines={1}>
        {facts}
      </T>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: th.space.sm }}>
        <Button
          small
          icon="ArchiveRestore"
          label={t("stash.apply")}
          hint={t("stash.applyHint")}
          disabled={apply.disabled}
          reason={apply.reason}
          busy={apply.pending}
          onPress={() =>
            void apply.run({ hash: stash.hash }).then((result) => {
              if (result.status === "ok") reported(result.output.conflicted, t("stash.applied", { ref: stash.ref }));
            })
          }
          testID="ag-stash-detail-apply"
        />
        <Button
          small
          icon="ArrowUpFromLine"
          label={t("stash.pop")}
          hint={t("stash.popHint")}
          disabled={pop.disabled}
          reason={pop.reason}
          busy={pop.pending}
          onPress={() =>
            void pop.run({ hash: stash.hash }).then((result) => {
              if (result.status !== "ok") return;
              reported(result.output.conflicted, t("stash.popped", { ref: stash.ref }));
              if (!result.output.conflicted) setDetail(NO_DETAIL);
            })
          }
          testID="ag-stash-detail-pop"
        />
        <Button
          small
          variant="danger"
          icon="Trash2"
          label={t("stash.drop")}
          disabled={busy}
          onPress={() => dialogs.open<DropStashDialogProps>(DropStashDialog, { cwd, stash, onDropped: () => setDetail(NO_DETAIL) })}
          testID="ag-stash-detail-drop"
        />
      </View>
    </View>
  );

  let body;
  if (show.error && !show.data) body = <ErrorNotice error={show.error} onRetry={() => void show.refetch()} testID="ag-stash-detail-files-error" />;
  else if (!show.data) body = <Spinner />;
  else if (files.length === 0) body = <EmptyState title={t("stash.detail.noFiles")} testID="ag-stash-detail-empty" />;
  else
    body = (
      <SplitPane
        direction="vertical"
        size={split}
        onSize={setSplit}
        defaultRatio={0.35}
        min={th.row * 3}
        minOther={th.row * 4}
        label={t("stash.detail.resize")}
        hint={t("shell.resetSize")}
        testID="ag-stash-detail-split"
        first={
          <View style={FILL}>
            <View style={{ flexDirection: "row", paddingHorizontal: th.space.md, height: th.row, alignItems: "center" }}>
              <T size={th.small} tone="muted" lines={1}>
                {show.data.truncated ? t("stash.detail.truncated", { count: files.length }) : t("stash.detail.files", { count: files.length })}
              </T>
            </View>
            <FileTree treeId={`stash-${stash.hash}`} files={files} selectedPath={selected?.path ?? null} onOpen={(file) => setChosen(file.path)} testID="ag-stash-files" />
          </View>
        }
        second={
          <View style={FILL}>
            {selected ? (
              <FileDiffView key={selected.path} embedded cwd={cwd} source={{ kind: "stash", hash: stash.hash }} file={selected} />
            ) : (
              <EmptyState title={t("stash.detail.selectFile")} />
            )}
          </View>
        }
      />
    );

  return (
    <View testID="ag-stash-detail" style={FILL}>
      {header}
      <View style={FILL}>{body}</View>
    </View>
  );
}
