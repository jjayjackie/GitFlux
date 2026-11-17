// The repository's safety snapshots (architecture §5): what the daemon recorded before an operation that could discard
// tracked changes, newest first, each with Restore (`git.safety.restore`, which applies its changes to the work tree
// and keeps the snapshot). Opened from the graph's "⋯" menu.
//
// Usage: dialogs.open(SnapshotsDialog, { cwd });

import { useToast } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { safetyRestoreRpc, safetySnapshotsRpc } from "../../../shared/rpc/safety.ts";
import type { SnapshotEntry } from "../../../shared/schemas.ts";
import { useT } from "../../i18n/messages.ts";
import { useFormatTime } from "../../state/format.ts";
import { usePolicy } from "../../state/policy.ts";
import { useGitMutation, useGitQuery } from "../../state/rpc.ts";
import { Button } from "../../ui/Button.tsx";
import { DialogFrame } from "../../ui/Dialog.tsx";
import type { DialogProps } from "../../ui/Dialog.tsx";
import { List } from "../../ui/List.tsx";
import { T } from "../../ui/Text.tsx";
import { useTheme } from "../../ui/theme.ts";

/** Rows shown before the list scrolls. */
const VISIBLE_ROWS = 10;

export function SnapshotsDialog({ open, onClose, cwd }: DialogProps & { cwd: string }) {
  const th = useTheme();
  const { t } = useT();
  const toast = useToast();
  const formatTime = useFormatTime();
  const { policy } = usePolicy();
  const query = useGitQuery(safetySnapshotsRpc, { cwd });
  const restore = useGitMutation(safetyRestoreRpc, {
    cwd,
    label: "restoring",
    successMessage: (output) => (output.conflicted ? null : t("safety.snapshots.restored")),
    onSuccess: (output) => {
      if (output.conflicted) toast.show(t("safety.snapshots.restoredConflicts"), { variant: "warning" });
    },
  });
  const snapshots = query.data?.snapshots ?? [];
  const rowHeight = th.row * 2 + th.space.sm;
  const height = Math.max(1, Math.min(Math.max(snapshots.length, 1), VISIBLE_ROWS)) * rowHeight + th.space.lg;
  return (
    <DialogFrame
      open={open}
      onClose={onClose}
      title={t("safety.snapshots.title")}
      icon="Archive"
      scrollable={false}
      testID="ag-snapshots"
      footer={<Button label={t("common.close")} onPress={onClose} testID="ag-snapshots-close" />}
    >
      <T size={th.small + 1} tone="muted">
        {t("safety.snapshots.intro")}
      </T>
      {query.data !== undefined && !policy.safetySnapshots && (
        <T size={th.small + 1} tone="warning">
          {t("safety.snapshots.off")}
        </T>
      )}
      <View style={{ height }}>
        <List<SnapshotEntry>
          data={snapshots}
          keyOf={(snapshot) => snapshot.ref}
          rowHeight={rowHeight}
          renderRow={(snapshot) => (
            <View
              style={{ height: rowHeight, flexDirection: "row", alignItems: "center", gap: th.space.md, paddingHorizontal: th.space.sm, borderBottomWidth: 1, borderColor: th.c.border }}
              testID={`ag-snapshot-${snapshot.hash}`}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <T lines={1} weight="500">
                  {formatTime(snapshot.time)}
                </T>
                <T size={th.small} tone="muted" lines={1}>
                  {t("safety.snapshots.detail", { reason: snapshot.reason, branch: snapshot.branch ?? t("safety.snapshots.detached") })}
                </T>
              </View>
              <Button
                small
                label={t("safety.snapshots.restore")}
                hint={t("safety.snapshots.restoreHint")}
                disabled={restore.disabled}
                reason={restore.reason}
                busy={restore.pending}
                onPress={() => void restore.run({ ref: snapshot.ref })}
                testID={`ag-snapshot-restore-${snapshot.hash}`}
              />
            </View>
          )}
          loading={query.isPending}
          error={query.error ?? undefined}
          onRetry={() => void query.refetch()}
          empty={t("safety.snapshots.empty")}
          accessibilityLabel={t("safety.snapshots.title")}
          testID="ag-snapshots-list"
        />
      </View>
    </DialogFrame>
  );
}
